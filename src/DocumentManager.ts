// src/DocumentManager.ts
import Ritor from './Ritor'; // Still needed for this.ritor.emit()
import { Document, Delta, Op, OpAttributes as OpAttributesType } from './Document';
import { DocSelection } from './types'; // Import from types.ts

// Helper classes OpUtils, DeltaIterator, OpAttributeComposer remain here for now,
// as they are specific to Delta manipulation within DocumentManager.
// These are assumed to be part of the same file scope for DocumentManager.

class OpUtils {
  static getOpLength(op: Op): number {
    if (typeof op.delete === 'number') return op.delete;
    if (typeof op.retain === 'number') return op.retain;
    if (typeof op.insert === 'string') return op.insert.length;
    // For ops that aren't insert/delete/retain or are invalid
    if (op.insert === undefined && op.delete === undefined && op.retain === undefined) return 0;
    // If it's an op like { attributes: { bold: true } } (retain 0 implicitly)
    // This case should ideally not happen with well-formed Deltas where retains specify length.
    // For safety in getOpLength, if it's not a known op type with length, return 0.
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
    // Corrected: Ensure current op exists before trying to get its length
    if (this.index < this.ops.length) {
        const currentOp = this.ops[this.index];
        // Check if current op is valid and has length before using OpUtils.getOpLength
        if (currentOp && (currentOp.insert !== undefined || currentOp.retain !== undefined || currentOp.delete !== undefined)) {
             // If current op has an actual length, check offset against it
            const len = OpUtils.getOpLength(currentOp);
            if (len > 0) return this.offset < len;
            // If current op has zero length (e.g. insert:""), but we are at it (offset 0), it's "consumable" by next()
            // then hasNext should be true if there are more ops *after* this one.
            // Or, if it's the last op and zero-length, hasNext should be false.
            if (this.offset === 0 && len === 0) { // At a zero-length op
                return true; // It can be "consumed" by next()
            }
        }
        // If current op is invalid or zero-length and fully "consumed" (offset > 0 or offset === 0 and len === 0)
        // then check if there's a next op in the array.
        if (this.index < this.ops.length -1) {
            return true;
        }
    }
    return false; // Default if all conditions fail
  }


  peek(): Op | null {
    if (!this.hasNext()) return null; // Use hasNext to determine if peeking is valid
    const currentOp = this.ops[this.index];

    // If hasNext is true, currentOp should be valid.
    // Handle offset for partial peeking
    if (this.offset > 0) {
      if (currentOp.insert !== undefined) {
        return { insert: currentOp.insert.substring(this.offset), attributes: currentOp.attributes };
      } else if (currentOp.retain !== undefined) {
        return { retain: currentOp.retain - this.offset, attributes: currentOp.attributes };
      } else if (currentOp.delete !== undefined) {
        return { delete: currentOp.delete - this.offset };
      }
    }
    return currentOp; // Return full current op if offset is 0
  }

  peekType(): string | null {
    const op = this.peek();
    if (!op) return null;
    if (op.insert !== undefined) return 'insert';
    if (op.delete !== undefined) return 'delete';
    if (op.retain !== undefined) return 'retain';
    return null;
  }

  next(length?: number): Op {
    if (!this.hasNext()) return {};

    const currentOp = this.ops[this.index];
    const currentOpFullLength = OpUtils.getOpLength(currentOp);
    const currentOpEffectiveLength = currentOpFullLength - this.offset;

    let opToReturn: Op;
    const consumeLength = length == null ? currentOpEffectiveLength : Math.min(length, currentOpEffectiveLength);

    if (consumeLength < 0) { // Should not happen with positive lengths and correct logic
        this.index++; this.offset = 0; return {}; // Error or skip
    }
    // If current op is zero-length (e.g. insert:"") and consumeLength is also 0
    if (consumeLength === 0 && currentOpEffectiveLength === 0) {
        opToReturn = { ...currentOp }; // Return the zero-length op (e.g. insert:"", attributes:{...})
        this.index++;
        this.offset = 0;
        return opToReturn;
    }


    if (currentOp.insert !== undefined) {
      opToReturn = {
        insert: currentOp.insert.substring(this.offset, this.offset + consumeLength),
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
    }

    this.offset += consumeLength;
    if (this.offset >= currentOpFullLength) { // Use full length for advancing index
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
  public ritor: Ritor; // Keep for emit
  private currentDocument: Document;
  public commandState: Map<string, boolean> = new Map(); // Keep for now, may be replaced by typingAttributes for some things
  private typingAttributes: OpAttributesType = {}; // New state for typing attributes

  constructor(ritor: Ritor, initialDelta?: Delta) {
    this.ritor = ritor;
    this.currentDocument = new Document(initialDelta || new Delta().push({ insert: '\n' }));
  }

  public getDocument(): Document {
    return this.currentDocument;
  }

  // Methods like insertText, formatText, deleteText, getFormatAt, clearFormat, compose
  // remain, but no longer call any local cursor or selection mapping methods.
  // They operate purely on DocSelection objects passed to them.
  public insertText(text: string, selection: DocSelection) {
    const currentDoc = this.getDocument();
    const ops: Op[] = [];
    let newCursorIndex = selection.index;
    let attributesForNewText: OpAttributesType | undefined = undefined;

    if (selection.length === 0) { // Collapsed selection: apply typing attributes
      const formatAtCursor = this.getFormatAt(selection); // Attributes of char before cursor
      const currentTypingAttrs = this.getTypingAttributes(); // Explicitly set typing attributes

      // Compose them: typing attributes should override/augment format at cursor.
      // Example: cursor in bold text (formatAtCursor={bold:true}). User clicks italic (typingAttrs={italic:true}). New text bold & italic.
      // Example: cursor in bold text. User toggles bold typing off (typingAttrs={bold:null}). New text not bold.
      attributesForNewText = OpAttributeComposer.compose(formatAtCursor, currentTypingAttrs);
      // OpAttributeComposer.compose already handles nulls to remove attributes.
      // It also returns undefined if the result is an empty attribute object.

    }
    // If selection.length > 0 (replacing text), attributesForNewText remains undefined.
    // The new text will be inserted "plain" and its final format will depend on
    // compose merging with surrounding content if attributes were undefined.
    // This is standard behavior for replacing text.

    if (selection.index > 0) {
      ops.push({ retain: selection.index });
    }
    if (selection.length > 0) {
      ops.push({ delete: selection.length });
    }

    // Create the insert op with the determined attributes
    const insertOp: Op = { insert: text };
    if (attributesForNewText) { // Only add attributes object if it's defined (not empty)
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
    if (selection.length === 0 && index > 0) { // For collapsed selection, look at char before
      index -= 1;
    } else if (selection.length > 0) {
      // For a range, typically get attributes at the start of the range.
      // Or, could be more complex to find common attributes. For now, start.
    }
    let currentPosition = 0;
    for (const op of docDelta.ops) {
      let opLength = OpUtils.getOpLength(op); // Use OpUtils.getOpLength

      if (index >= currentPosition && index < currentPosition + opLength) {
        return op.attributes || {};
      }
      if (opLength > 0) currentPosition += opLength; // Only advance if op has length
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
      // Skip ops that do nothing (retain 0, delete 0, or insert "" with no attributes)
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
      } else if (newOp.insert && lastOp.insert &&
                 typeof newOp.insert === 'string' && typeof lastOp.insert === 'string' &&
                 areAttributesSemanticallyEqual(newOp.attributes, lastOp.attributes)) {

        const newIsPureBlockBreak = (newOp.insert === '\n' && (!newOp.attributes || Object.keys(newOp.attributes).length === 0));
        const lastOpEndsWithNewline = (typeof lastOp.insert === 'string' && lastOp.insert.endsWith('\n'));

        if (newIsPureBlockBreak) {
          // If newOp is a pure newline (e.g. from Enter), always push it as a new op.
          resultOps.push(newOp);
        } else if (lastOpEndsWithNewline && newOp.insert !== "") {
          // If lastOp ended with a newline, and newOp is text content,
          // newOp should start a new operation (new paragraph's content).
          resultOps.push(newOp);
        } else {
          // Both are text content (neither is a pure block break immediately following text,
          // or lastOp didn't end with a newline). Attributes match. Merge them.
          // This also handles merging multiple pure newlines if that case were to pass the above.
          lastOp.insert += newOp.insert;
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
                if (nextA.retain && consumeLength > 0) { // Only delete if it's a retain op from A
                    iterA.next(consumeLength);
                } else if (nextA.insert && consumeLength > 0) { // Or if it's an insert op from A
                    iterA.next(consumeLength);
                } else if (consumeLength === 0 && nextALength === 0) { // Skip zero-length ops in A
                    iterA.next();
                    continue;
                } else {
                    // Cannot delete from this op type, or consumeLength is 0 but op has length
                    // This implies iterA should not be consumed here by a delete from B.
                    // This path should ideally not be taken if deltaB is well-formed against deltaA.
                    // If iterA.peek() is not retain or insert, a delete op from B can't apply to it.
                    // However, the `length` of delete op from B still needs to be satisfied.
                    // This usually means deltaB is malformed or deltaA is not what B expects.
                    // For robustness, we might skip consuming A here if it's not consumable by delete.
                    // But the delete length from B still needs to be "accounted for".
                    // This is where true op transformation logic gets complex.
                    // For now, if A's op is not insert/retain, the delete from B effectively skips it.
                    // This means `length` doesn't decrease, and we might infinite loop if iterA doesn't advance.
                    // Let's assume for this simplified compose that deletes in B only apply to retain/insert in A.
                    // If iterA.peek() is a delete, this delete op from B is relative to A *after* A's delete.
                    // So we must advance A.
                    if(typeA === 'delete') { // A also has a delete, let A's delete go first
                        pushOp(iterA.next());
                        // length for B's delete is not reduced here, it will be processed against next op of A
                    } else {
                        // If A's op is not retain or insert, B's delete op can't apply to it.
                        // This is a mismatch. For this simplified compose, we'll assume B's delete
                        // is "lost" against this non-deletable op from A. Or, advance A.
                        // To be safe and avoid infinite loops if B's delete length never reduces:
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
        if (!opA || !opB || typeof opA.insert !== 'string' || typeof opB.retain !== 'number') {
          if (iterA.hasNext()) iterA.next(); else if (iterB.hasNext()) iterB.next(); else break; continue;
        }
        const attributes = OpAttributeComposer.compose(opA.attributes, opB.attributes, true);
        const length = Math.min(OpUtils.getOpLength(opA), opB.retain);
        if (length > 0) {
          const opAWithValue = iterA.next(length);
          if (opAWithValue && opAWithValue.insert !== undefined) {
            pushOp({ insert: opAWithValue.insert, attributes });
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
      // Skip empty inserts that have no attributes
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
        } else if (currentOp.insert && lastMergedOp.insert &&
                   typeof currentOp.insert === 'string' && typeof lastMergedOp.insert === 'string' &&
                   areAttributesSemanticallyEqual(currentOp.attributes, lastMergedOp.attributes)) {

           const currentIsPureNewline = (currentOp.insert === '\n' && (!currentOp.attributes || Object.keys(currentOp.attributes).length === 0));
           const lastMergedIsPureNewline = (lastMergedOp.insert === '\n' && (!lastMergedOp.attributes || Object.keys(lastMergedOp.attributes).length === 0));

           if (currentIsPureNewline && !lastMergedIsPureNewline) {
               mergedFinalOps.push(currentOp);
           } else if (!currentIsPureNewline && lastMergedIsPureNewline) {
               mergedFinalOps.push(currentOp);
           } else {
               // Both are text with same attributes, or both are pure newlines with same attributes.
               lastMergedOp.insert += currentOp.insert;
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

    // Retain content before the selection
    if (selection.index > 0) {
      ops.push({ retain: selection.index });
    }

    // Delete content if selection is not collapsed
    if (selection.length > 0) {
      ops.push({ delete: selection.length });
    }

    // Insert the newline character that signifies a block break (paragraph)
    // For now, it's a simple newline. Later, this op could carry block attributes.
    ops.push({ insert: '\n' });
    newCursorIndex = selection.index + 1; // Cursor after the inserted newline

    // Retain content after the original selection
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

  // --- New Typing Attributes Methods ---
  public getTypingAttributes(): OpAttributesType {
    // Return a clone to prevent external modification
    return { ...this.typingAttributes };
  }

  public setTypingAttributes(attrs: OpAttributesType): void {
    this.typingAttributes = attrs ? { ...attrs } : {}; // Ensure attrs is not null/undefined before spread
    // Emit an event so UI can update (e.g., toolbar buttons)
    this.ritor.emit('typingattributes:change', this.getTypingAttributes());
  }

  public toggleTypingAttribute(formatKey: string, explicitValue?: boolean | null): void {
    const newAttrs = { ...this.typingAttributes };

    if (explicitValue === null || explicitValue === false) { // Explicitly turn off or set to null
        delete newAttrs[formatKey];
    } else if (explicitValue === true) { // Explicitly turn on
        newAttrs[formatKey] = true;
    } else { // Toggle boolean state (if explicitValue is undefined)
      if (newAttrs[formatKey]) {
        delete newAttrs[formatKey];
      } else {
        newAttrs[formatKey] = true;
      }
    }
    this.typingAttributes = newAttrs;
    // Emit even if newAttrs is empty, so UI can clear active states
    this.ritor.emit('typingattributes:change', this.getTypingAttributes());
  }
}
export default DocumentManager;
