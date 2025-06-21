// src/DocumentManager.ts
import Ritor from './Ritor'; // Still needed for this.ritor.emit()
import { Document, Delta, Op, OpAttributes as OpAttributesType, ParagraphBreakMarker } from './Document'; // Ensure ParagraphBreakMarker is imported
import { DocSelection } from './types'; // Import from types.ts

// Helper classes OpUtils, DeltaIterator, OpAttributeComposer remain here for now,
// as they are specific to Delta manipulation within DocumentManager.
// These are assumed to be part of the same file scope for DocumentManager.

class OpUtils {
  static getOpLength(op: Op): number {
    if (typeof op.delete === 'number') return op.delete;
    if (typeof op.retain === 'number') return op.retain;
    if (typeof op.insert === 'string') {
      return op.insert.length;
    }
    // Check if op.insert is our ParagraphBreakMarker object
    if (typeof op.insert === 'object' && op.insert !== null && (op.insert as ParagraphBreakMarker).paragraphBreak === true) {
      return 1; // ParagraphBreakMarker has a conceptual length of 1
    }

    if (op.insert === undefined && op.delete === undefined && op.retain === undefined) {
        return 0;
    }
    return 0;
  }
}

class DeltaIterator {
  ops: Op[];
  index: number;
  offset: number;

  constructor(ops: Op[]) {
    this.ops = ops;
    this.index = 0;
    this.offset = 0;
  }

  hasNext(): boolean {
    if (this.index < this.ops.length) {
      const currentOp = this.ops[this.index];
      if (currentOp) {
        const len = OpUtils.getOpLength(currentOp);
        if (this.offset < len) {
          return true;
        }
        return this.index < this.ops.length - 1;
      }
    }
    return false;
  }

  peek(): Op | null {
    if (!this.hasNext()) return null;

    const currentOp = this.ops[this.index];
    if (!currentOp) return null;

    if (this.offset > 0) {
      if (typeof currentOp.insert === 'string') {
        return { insert: currentOp.insert.substring(this.offset), attributes: currentOp.attributes };
      } else if (currentOp.insert && typeof currentOp.insert === 'object' && (currentOp.insert as ParagraphBreakMarker).paragraphBreak === true) {
        return null;
      } else if (currentOp.retain !== undefined) {
        return { retain: currentOp.retain - this.offset, attributes: currentOp.attributes };
      } else if (currentOp.delete !== undefined) {
        return { delete: currentOp.delete - this.offset };
      }
      return null;
    }
    return currentOp;
  }

  peekType(): string | null {
    const op = this.peek();
    if (!op) return null;
    if (op.hasOwnProperty('insert')) return 'insert';
    if (op.hasOwnProperty('delete')) return 'delete';
    if (op.hasOwnProperty('retain')) return 'retain';
    return null;
  }

  next(length?: number): Op {
    if (!this.hasNext()) return {};

    const currentOp = this.ops[this.index];
    if (!currentOp) {
        this.index++;
        return {};
    }

    const currentOpFullLength = OpUtils.getOpLength(currentOp);
    const currentOpEffectiveRemainingLength = currentOpFullLength - this.offset;

    let opToReturn: Op;
    const consumeLength = length == null ? currentOpEffectiveRemainingLength : Math.min(length, currentOpEffectiveRemainingLength);

    if (consumeLength < 0) { this.index++; this.offset = 0; return {}; }

    if (consumeLength === 0) {
        if (currentOpFullLength === 0 && this.offset === 0) {
             opToReturn = { ...currentOp };
             this.index++;
             this.offset = 0;
             return opToReturn;
        }
        return {};
    }

    if (typeof currentOp.insert === 'string') {
      opToReturn = {
        insert: currentOp.insert.substring(this.offset, this.offset + consumeLength),
        attributes: currentOp.attributes
      };
    } else if (currentOp.insert && typeof currentOp.insert === 'object' && (currentOp.insert as ParagraphBreakMarker).paragraphBreak === true) {
      opToReturn = {
        insert: { paragraphBreak: true } as ParagraphBreakMarker,
        attributes: currentOp.attributes
      };
    } else if (currentOp.retain !== undefined) {
      opToReturn = {
        retain: consumeLength,
        attributes: currentOp.attributes
      };
    } else if (currentOp.delete !== undefined) {
      opToReturn = { delete: consumeLength };
    } else {
      opToReturn = {};
      console.warn("DeltaIterator: Unknown op type in next()", currentOp);
    }

    this.offset += consumeLength;
    if (this.offset >= currentOpFullLength) {
      this.index++;
      this.offset = 0;
    }
    return opToReturn;
  }
}

class OpAttributeComposer {
  static compose(a?: OpAttributesType, b?: OpAttributesType, keepNull: boolean = false): OpAttributesType | undefined {
    if (typeof a !== 'object' && a !== undefined) a = {};
    if (typeof b !== 'object' && b !== undefined) b = {};

    a = a || {};
    b = b || {};

    let attributes: OpAttributesType = { ...a };
    for (const key in b) {
      if (b.hasOwnProperty(key)) {
        attributes[key] = b[key];
      }
    }
    if (!keepNull) {
      for (const key in attributes) {
        if (attributes.hasOwnProperty(key) && attributes[key] === null) {
          delete attributes[key];
        }
      }
    }
    return Object.keys(attributes).length > 0 ? attributes : undefined;
  }
}

class DocumentManager {
  public ritor: Ritor;
  private currentDocument: Document;
  public commandState: Map<string, boolean> = new Map();
  private typingAttributes: OpAttributesType = {};

  constructor(ritor: Ritor, initialDelta?: Delta) {
    this.ritor = ritor;
    const defaultInitialOps: Op[] = [{ insert: { paragraphBreak: true } as ParagraphBreakMarker }];
    this.currentDocument = new Document(initialDelta || new Delta(defaultInitialOps));
  }

  public getDocument(): Document {
    return this.currentDocument;
  }

  public insertText(text: string, selection: DocSelection) {
    const currentDoc = this.getDocument();
    const ops: Op[] = [];
    let newCursorIndex = selection.index;
    let attributesForNewText: OpAttributesType | undefined = undefined;

    if (selection.length === 0) {
      const formatAtCursor = this.getFormatAt(selection);
      const currentTypingAttrs = this.getTypingAttributes();
      attributesForNewText = OpAttributeComposer.compose(formatAtCursor, currentTypingAttrs);
    }

    if (selection.index > 0) {
      ops.push({ retain: selection.index });
    }
    if (selection.length > 0) {
      ops.push({ delete: selection.length });
    }

    const insertOp: Op = { insert: text };
    if (attributesForNewText) {
      insertOp.attributes = attributesForNewText;
    }
    ops.push(insertOp);

    newCursorIndex = selection.index + text.length;

    const docLength = currentDoc.getDelta().length();
    const originalSegmentEndIndex = selection.index + selection.length;
    if (docLength > originalSegmentEndIndex) {
      ops.push({ retain: docLength - originalSegmentEndIndex });
    }
    const change = new Delta(ops);
    const composedDelta = this.compose(currentDoc.getDelta(), change);
    this.currentDocument = new Document(composedDelta);
    const newSelection: DocSelection = { index: newCursorIndex, length: 0 };
    this.ritor.emit('document:change', this.currentDocument, newSelection);
  }

  public formatText(attributes: OpAttributesType, selection: DocSelection) {
    const currentDoc = this.getDocument();
    const ops: Op[] = [];
    if (selection.index > 0) { ops.push({ retain: selection.index }); }
    if (selection.length > 0) { ops.push({ retain: selection.length, attributes: attributes }); }
    const docLength = currentDoc.getDelta().length();
    const originalSegmentEndIndex = selection.index + selection.length;
    if (docLength > originalSegmentEndIndex) {
      ops.push({ retain: docLength - originalSegmentEndIndex });
    }
    const change = new Delta(ops);
    const composedDelta = this.compose(currentDoc.getDelta(), change);
    this.currentDocument = new Document(composedDelta);
    const newSelection: DocSelection = { index: selection.index, length: selection.length };
    this.ritor.emit('document:change', this.currentDocument, newSelection);
  }

  public deleteText(selection: DocSelection) {
    const currentDoc = this.getDocument();
    const ops: Op[] = [];
    let newCursorIndex = selection.index;
    if (selection.index > 0) { ops.push({ retain: selection.index }); }
    if (selection.length > 0) { ops.push({ delete: selection.length }); }
    const docLength = currentDoc.getDelta().length();
    const originalSegmentEndIndex = selection.index + selection.length;
    if (docLength > originalSegmentEndIndex) {
      ops.push({ retain: docLength - originalSegmentEndIndex });
    }
    const change = new Delta(ops);
    const composedDelta = this.compose(currentDoc.getDelta(), change);
    this.currentDocument = new Document(composedDelta);
    const newSelection: DocSelection = { index: newCursorIndex, length: 0 };
    this.ritor.emit('document:change', this.currentDocument, newSelection);
  }

  public getFormatAt(selection: DocSelection): OpAttributesType {
    const docDelta = this.currentDocument.getDelta();
    if (!docDelta || !docDelta.ops) return {};
    let index = selection.index;
    if (selection.length === 0 && index > 0) {
      index -= 1;
    } else if (selection.length > 0) {
    }
    let currentPosition = 0;
    for (const op of docDelta.ops) {
      let opLength = OpUtils.getOpLength(op);

      if (index >= currentPosition && index < currentPosition + opLength) {
        return op.attributes || {};
      }
      if (opLength > 0) currentPosition += opLength;
    }
    return {};
  }

  public clearFormat(selection: DocSelection): void {
    const currentDoc = this.getDocument();
    const ops: Op[] = [];
    if (selection.index > 0) { ops.push({ retain: selection.index }); }
    if (selection.length > 0) {
      const resetAttributes: OpAttributesType = { bold: null, italic: null, underline: null };
      ops.push({ retain: selection.length, attributes: resetAttributes });
    }
    const docLength = currentDoc.getDelta().length();
    const originalSegmentEndIndex = selection.index + selection.length;
    if (docLength > originalSegmentEndIndex) {
      ops.push({ retain: docLength - originalSegmentEndIndex });
    }
    const change = new Delta(ops);
    const composedDelta = this.compose(currentDoc.getDelta(), change);
    this.currentDocument = new Document(composedDelta);
    const newSelection: DocSelection = { index: selection.index, length: selection.length };
    this.ritor.emit('document:change', this.currentDocument, newSelection);
  }

  public compose(deltaA: Delta, deltaB: Delta): Delta {
    const iterA = new DeltaIterator(deltaA.ops);
    const iterB = new DeltaIterator(deltaB.ops);
    const resultOps: Op[] = [];

    function isParagraphBreakMarker(insertVal: any): insertVal is ParagraphBreakMarker {
      return typeof insertVal === 'object' && insertVal !== null && insertVal.paragraphBreak === true;
    }

    function areAttributesSemanticallyEqual(attrs1?: OpAttributesType, attrs2?: OpAttributesType): boolean {
      const normalize = (attrs?: OpAttributesType): OpAttributesType | undefined => {
        if (!attrs) return undefined;
        const keys = Object.keys(attrs);
        if (keys.length === 0) return undefined;
        const normalized: OpAttributesType = {};
        let effectiveKeys = 0;
        for (const key of keys) {
          if (attrs[key] !== undefined && attrs[key] !== null) {
            normalized[key] = attrs[key];
            effectiveKeys++;
          }
        }
        return effectiveKeys > 0 ? normalized : undefined;
      };
      const normalizedAttrs1 = normalize(attrs1);
      const normalizedAttrs2 = normalize(attrs2);
      if (normalizedAttrs1 === undefined && normalizedAttrs2 === undefined) return true;
      if (normalizedAttrs1 === undefined || normalizedAttrs2 === undefined) return false;
      const keys1 = Object.keys(normalizedAttrs1);
      const keys2 = Object.keys(normalizedAttrs2);
      if (keys1.length !== keys2.length) return false;
      for (const key of keys1) {
        if (normalizedAttrs1[key] !== normalizedAttrs2[key]) return false;
      }
      return true;
    }

    const pushOp = (newOp: Op) => {
      if ( (newOp.retain && newOp.retain <= 0 && !newOp.attributes) ||
           (newOp.delete && newOp.delete <= 0) ||
           (newOp.insert === "" && !newOp.attributes) ) {
        return;
      }

      if (resultOps.length === 0) {
        resultOps.push(newOp);
        return;
      }
      const lastOp = resultOps[resultOps.length - 1];
      if (newOp.delete && lastOp.delete) {
        lastOp.delete += newOp.delete;
      } else if (newOp.retain && lastOp.retain && areAttributesSemanticallyEqual(newOp.attributes, lastOp.attributes)) {
        lastOp.retain += newOp.retain;
      } else if (newOp.insert !== undefined && lastOp.insert !== undefined &&
                 areAttributesSemanticallyEqual(newOp.attributes, lastOp.attributes)) {

        const newIsPBM = isParagraphBreakMarker(newOp.insert);
        const lastIsPBM = isParagraphBreakMarker(lastOp.insert);

        if (newIsPBM || lastIsPBM) {
          resultOps.push(newOp);
        } else {
          const newInsertStr = newOp.insert as string; // Both are strings if not PBM
          const lastInsertStr = lastOp.insert as string;

          if (newInsertStr === '\n' && !lastInsertStr.endsWith('\n')) {
            resultOps.push(newOp);
          } else if (lastInsertStr.endsWith('\n') && newInsertStr !== '\n' && newInsertStr !== "") {
            resultOps.push(newOp);
          } else {
            (lastOp.insert as string) += newInsertStr;
          }
        }
      } else {
        resultOps.push(newOp);
      }
    };

    while (iterA.hasNext() || iterB.hasNext()) {
      const opA = iterA.peek();
      const opB = iterB.peek();
      const typeA = iterA.peekType();
      const typeB = iterB.peekType();

      if (typeB === 'insert') {
        pushOp(iterB.next());
      } else if (typeA === 'delete') {
        pushOp(iterA.next());
      } else if (typeB === 'delete') {
        const bOpDelete = iterB.next();
        if (bOpDelete && bOpDelete.delete) {
            let length = bOpDelete.delete;
            while (length > 0 && iterA.hasNext()) {
                const nextA = iterA.peek();
                if (!nextA) break;
                const nextALength = OpUtils.getOpLength(nextA);
                const consumeLength = Math.min(length, nextALength);
                if (nextA.retain && consumeLength > 0) {
                    iterA.next(consumeLength);
                } else if (nextA.insert && consumeLength > 0) {
                    iterA.next(consumeLength);
                } else if (consumeLength === 0 && nextALength === 0) {
                    iterA.next();
                    continue;
                } else {
                    if(typeA === 'delete') {
                        pushOp(iterA.next());
                    } else {
                        if (nextALength > 0) iterA.next(consumeLength); else iterA.next();
                    }
                }
                length -= consumeLength;
            }
        }
      } else if (typeA === 'retain' && typeB === 'retain') {
        if (!opA || !opB || typeof opA.retain !== 'number' || typeof opB.retain !== 'number') {
          if (iterA.hasNext()) iterA.next(); else if (iterB.hasNext()) iterB.next(); else break; continue;
        }
        const attributes = OpAttributeComposer.compose(opA.attributes, opB.attributes, true);
        const length = Math.min(opA.retain, opB.retain);
        if (length > 0) pushOp({ retain: length, attributes });
        iterA.next(length);
        iterB.next(length);
      } else if (typeA === 'insert' && typeB === 'retain') {
        if (!opA || !opB || opA.insert === undefined || typeof opB.retain !== 'number') {
            if (iterA.hasNext()) iterA.next(); else if (iterB.hasNext()) iterB.next(); else break; continue;
        }

        const currentAttributesA = opA.attributes;
        const attributesToApplyB = opB.attributes;
        const newAttributes = OpAttributeComposer.compose(currentAttributesA, attributesToApplyB, true);

        const length = Math.min(OpUtils.getOpLength(opA), opB.retain);

        if (length > 0) {
          const opAWithValue = iterA.next(length);

          if (opAWithValue && opAWithValue.insert !== undefined) {
            pushOp({ insert: opAWithValue.insert, attributes: newAttributes });
          }
        }
        iterB.next(length);
      } else if (opA) {
        pushOp(iterA.next());
      } else if (opB) {
        pushOp(iterB.next());
      } else {
        break;
      }
    }

    const finalOpsProcessing: Op[] = [];
    resultOps.forEach(op => {
      let processedOp = { ...op };
      if (processedOp.attributes) {
        for (const key in processedOp.attributes) {
          if (processedOp.attributes[key] === null) {
            delete processedOp.attributes[key];
          }
        }
        if (Object.keys(processedOp.attributes).length === 0) {
          delete processedOp.attributes;
        }
      }
      if (processedOp.delete && processedOp.delete <= 0) return;
      if (processedOp.retain && processedOp.retain <= 0 && !processedOp.attributes) return;
      if (processedOp.insert === "" && !processedOp.attributes) {
        return;
      }

      finalOpsProcessing.push(processedOp);
    });

    const mergedFinalOps: Op[] = [];
    if (finalOpsProcessing.length > 0) {
      mergedFinalOps.push({ ...finalOpsProcessing[0] });
      for (let i = 1; i < finalOpsProcessing.length; i++) {
        const currentOp = { ...finalOpsProcessing[i] };
        const lastMergedOp = mergedFinalOps[mergedFinalOps.length - 1];
        if (currentOp.delete && lastMergedOp.delete) {
          lastMergedOp.delete += currentOp.delete;
        } else if (currentOp.insert !== undefined && lastMergedOp.insert !== undefined &&
                   areAttributesSemanticallyEqual(currentOp.attributes, lastMergedOp.attributes)) {
            const currentIsString = typeof currentOp.insert === 'string';
            const lastMergedIsString = typeof lastMergedOp.insert === 'string';
            const currentIsPBM = isParagraphBreakMarker(currentOp.insert);
            const lastMergedIsPBM = isParagraphBreakMarker(lastMergedOp.insert);

            if (currentIsPBM || lastMergedIsPBM) {
                mergedFinalOps.push(currentOp);
            } else { // Both are strings
                const currentInsertStr = currentOp.insert as string;
                const lastMergedInsertStr = lastMergedOp.insert as string;

                if (currentInsertStr === '\n' && !lastMergedInsertStr.endsWith('\n')) {
                     mergedFinalOps.push(currentOp);
                } else if (lastMergedInsertStr.endsWith('\n') && currentInsertStr !== '\n' && currentInsertStr !== "") {
                     mergedFinalOps.push(currentOp);
                } else {
                    (lastMergedOp.insert as string) += currentInsertStr;
                }
            }
        } else if (currentOp.retain && lastMergedOp.retain && areAttributesSemanticallyEqual(currentOp.attributes, lastMergedOp.attributes)) {
          lastMergedOp.retain += currentOp.retain;
        } else {
          mergedFinalOps.push(currentOp);
        }
      }
    }
    return new Delta(mergedFinalOps);
  }

  public insertBlockBreak(selection: DocSelection): void {
    const currentDoc = this.getDocument();
    const ops: Op[] = [];
    let newCursorIndex = selection.index;

    if (selection.index > 0) {
      ops.push({ retain: selection.index });
    }

    if (selection.length > 0) {
      ops.push({ delete: selection.length });
    }

    ops.push({ insert: { paragraphBreak: true } as ParagraphBreakMarker });

    newCursorIndex = selection.index + 1;

    const docLength = currentDoc.getDelta().length();
    const originalSegmentEndIndex = selection.index + selection.length;
    if (docLength > originalSegmentEndIndex) {
      ops.push({ retain: docLength - originalSegmentEndIndex });
    }

    const change = new Delta(ops);
    const composedDelta = this.compose(currentDoc.getDelta(), change);
    this.currentDocument = new Document(composedDelta);

    const newSelection: DocSelection = { index: newCursorIndex, length: 0 };
    this.ritor.emit('document:change', this.currentDocument, newSelection);
  }

  public getTypingAttributes(): OpAttributesType {
    return { ...this.typingAttributes };
  }

  public setTypingAttributes(attrs: OpAttributesType): void {
    this.typingAttributes = attrs ? { ...attrs } : {};
    this.ritor.emit('typingattributes:change', this.getTypingAttributes());
  }

  public toggleTypingAttribute(formatKey: string, explicitValue?: boolean | null): void {
    const newAttrs = { ...this.typingAttributes };

    if (explicitValue === null || explicitValue === false) {
        newAttrs[formatKey] = null;
    } else if (explicitValue === true) {
        newAttrs[formatKey] = true;
    } else {
        if (newAttrs[formatKey] === true) {
            newAttrs[formatKey] = null;
        } else {
            newAttrs[formatKey] = true;
        }
    }
    this.typingAttributes = newAttrs;
    this.ritor.emit('typingattributes:change', this.getTypingAttributes());
  }
}
export default DocumentManager;
