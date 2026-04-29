// src/DocumentManager.ts
import Ritor from './Ritor'; // Still needed for this.ritor.emit()
import { Document, Delta, Op, OpAttributes as OpAttributesType, ParagraphBreakMarker } from './Document'; // Ensure ParagraphBreakMarker is imported
import { DocSelection } from './types'; // Import from types.ts
import AttributeComposer from './model/delta/AttributeComposer';
import DeltaIterator from './model/delta/DeltaIterator';
import OpUtils from './model/delta/OpUtils';

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
      attributesForNewText = AttributeComposer.compose(formatAtCursor, currentTypingAttrs);
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
    if (selection.index > 0) {
      ops.push({ retain: selection.index });
    }
    if (selection.length > 0) {
      ops.push({ retain: selection.length, attributes: attributes });
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

  public deleteText(selection: DocSelection) {
    const currentDoc = this.getDocument();
    const ops: Op[] = [];
    let newCursorIndex = selection.index;
    if (selection.index > 0) {
      ops.push({ retain: selection.index });
    }
    if (selection.length > 0) {
      ops.push({ delete: selection.length });
    }
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
    if (selection.index > 0) {
      ops.push({ retain: selection.index });
    }
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
      if (
        (newOp.retain && newOp.retain <= 0 && !newOp.attributes) ||
        (newOp.delete && newOp.delete <= 0) ||
        (newOp.insert === '' && !newOp.attributes)
      ) {
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
      } else if (
        newOp.insert !== undefined &&
        lastOp.insert !== undefined &&
        areAttributesSemanticallyEqual(newOp.attributes, lastOp.attributes)
      ) {
        const newIsPBM = isParagraphBreakMarker(newOp.insert);
        const lastIsPBM = isParagraphBreakMarker(lastOp.insert);

        if (newIsPBM || lastIsPBM) {
          resultOps.push(newOp);
        } else {
          const newInsertStr = newOp.insert as string; // Both are strings if not PBM
          const lastInsertStr = lastOp.insert as string;

          if (newInsertStr === '\n' && !lastInsertStr.endsWith('\n')) {
            resultOps.push(newOp);
          } else if (lastInsertStr.endsWith('\n') && newInsertStr !== '\n' && newInsertStr !== '') {
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
              if (typeA === 'delete') {
                pushOp(iterA.next());
              } else {
                if (nextALength > 0) iterA.next(consumeLength);
                else iterA.next();
              }
            }
            length -= consumeLength;
          }
        }
      } else if (typeA === 'retain' && typeB === 'retain') {
        if (!opA || !opB || typeof opA.retain !== 'number' || typeof opB.retain !== 'number') {
          if (iterA.hasNext()) iterA.next();
          else if (iterB.hasNext()) iterB.next();
          else break;
          continue;
        }
        const attributes = AttributeComposer.compose(opA.attributes, opB.attributes, true);
        const length = Math.min(opA.retain, opB.retain);
        if (length > 0) pushOp({ retain: length, attributes });
        iterA.next(length);
        iterB.next(length);
      } else if (typeA === 'insert' && typeB === 'retain') {
        if (!opA || !opB || opA.insert === undefined || typeof opB.retain !== 'number') {
          if (iterA.hasNext()) iterA.next();
          else if (iterB.hasNext()) iterB.next();
          else break;
          continue;
        }

        const currentAttributesA = opA.attributes;
        const attributesToApplyB = opB.attributes;
        const newAttributes = AttributeComposer.compose(currentAttributesA, attributesToApplyB, true);

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
    resultOps.forEach((op) => {
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
      if (processedOp.insert === '' && !processedOp.attributes) {
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
        } else if (
          currentOp.insert !== undefined &&
          lastMergedOp.insert !== undefined &&
          areAttributesSemanticallyEqual(currentOp.attributes, lastMergedOp.attributes)
        ) {
          const currentIsString = typeof currentOp.insert === 'string';
          const lastMergedIsString = typeof lastMergedOp.insert === 'string';
          const currentIsPBM = isParagraphBreakMarker(currentOp.insert);
          const lastMergedIsPBM = isParagraphBreakMarker(lastMergedOp.insert);

          if (currentIsPBM || lastMergedIsPBM) {
            mergedFinalOps.push(currentOp);
          } else {
            // Both are strings
            const currentInsertStr = currentOp.insert as string;
            const lastMergedInsertStr = lastMergedOp.insert as string;

            if (currentInsertStr === '\n' && !lastMergedInsertStr.endsWith('\n')) {
              mergedFinalOps.push(currentOp);
            } else if (lastMergedInsertStr.endsWith('\n') && currentInsertStr !== '\n' && currentInsertStr !== '') {
              mergedFinalOps.push(currentOp);
            } else {
              (lastMergedOp.insert as string) += currentInsertStr;
            }
          }
        } else if (
          currentOp.retain &&
          lastMergedOp.retain &&
          areAttributesSemanticallyEqual(currentOp.attributes, lastMergedOp.attributes)
        ) {
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
