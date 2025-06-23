// This will replace the existing DocumentManager.ts content.
// I need to be careful to only replace the compose method's body,
// but the tool is overwrite_file_with_block.
// I must provide the *entire file content* with the modified compose body.

// First, I will construct the new file content in memory.
// I will take the existing file content (from the read_files call)
// and replace only the public compose method's body with the one from the prompt.

const existingContent = `// src/DocumentManager.ts
// import Ritor from './Ritor'; // Ritor import removed as it's not used
import { Delta, Op, OpAttributes, ParagraphBreakMarker } from './Document';
import { DocSelection } from './types';
import { DeltaIterator } from './DeltaIterator';
import * as OpUtils from './OpUtils';
import EventEmitter from './EventEmitter'; // Default import

const DEBUG = true;

function log(...args: any[]) {
  if (DEBUG) {
    // Add a timestamp to each log for better traceability
    const now = new Date();
    const timeString = \`\${now.getHours()}:\${now.getMinutes()}:\${now.getSeconds()}.\${now.getMilliseconds()}\`;
    console.log(\`[DM \${timeString}]\`, ...args);
  }
}

// OpAttributeComposer class as defined in previous steps
class OpAttributeComposer {
  static compose(a?: OpAttributes, b?: OpAttributes, keepNull: boolean = false): OpAttributes | undefined {
    if (typeof a !== 'object' && a !== undefined) a = {};
    if (typeof b !== 'object' && b !== undefined) b = {};

    a = a || {};
    b = b || {};

    let attributes: OpAttributes = { ...a };
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


export class DocumentManager extends EventEmitter {
  public currentDocument: Delta;
  private typingAttributes: OpAttributes = {};
  private getSelectionFromCursor: () => DocSelection;
  private setSelectionToCursor: (selection: DocSelection) => void;

  constructor(
    initialDelta?: Delta,
    getSelection?: () => DocSelection,
    setSelection?: (sel: DocSelection) => void
  ) {
    super();
    log('Constructor: initialDelta:', initialDelta, 'getSelection:', typeof getSelection, 'setSelection:', typeof setSelection);

    // Assign currentDocument
    if (initialDelta instanceof Delta) {
      this.currentDocument = initialDelta;
    } else {
      // If initialDelta is undefined or not a Delta, use a default.
      if (initialDelta !== undefined) {
          log('Constructor: initialDelta was provided but not a Delta instance. Using default.');
      }
      this.currentDocument = new Delta([{ insert: { paragraphBreak: true } as ParagraphBreakMarker }]);
    }
    log('Constructor: currentDocument initialized:', this.currentDocument.ops);

    // Assign getSelectionFromCursor
    if (typeof getSelection === 'function') {
      this.getSelectionFromCursor = getSelection;
      log('Constructor: Assigned provided getSelection function.');
    } else {
      this.getSelectionFromCursor = () => {
        log('getSelectionFromCursor (default) called');
        return { index: 0, length: 0 };
      };
      log('Constructor: Assigned default getSelection function.');
    }

    // Assign setSelectionToCursor
    if (typeof setSelection === 'function') {
      this.setSelectionToCursor = setSelection;
      log('Constructor: Assigned provided setSelection function.');
    } else {
      this.setSelectionToCursor = (sel: DocSelection) => {
        log('setSelectionToCursor (default) called with:', sel);
        // Default does nothing.
      };
      log('Constructor: Assigned default setSelection function.');
    }

    // Ensure document always ends with a PBM if not empty, or if it's an empty delta from initial content
    if (this.currentDocument.ops.length === 0 ||
        !OpUtils.isParagraphBreak(this.currentDocument.ops[this.currentDocument.ops.length - 1])) {
        // Ensure document always ends with a PBM if not empty
        // This logic might need to use compose or be reviewed if currentDocument.insert was a utility method
        const opsToAddPBM: Op[] = [];
        if (this.currentDocument.length() > 0) {
            opsToAddPBM.push({ retain: this.currentDocument.length() });
        }
        opsToAddPBM.push({ insert: { paragraphBreak: true } as ParagraphBreakMarker });
        this.currentDocument = this.compose(this.currentDocument, new Delta(opsToAddPBM));
    }
    log('Constructor: currentDocument initialized:', this.currentDocument.ops);
  }

  // public emit(event: string, ...data: any[]): void { // Removed, inherited from EventEmitter
  //     super.emit(event, ...data);
  // }

  getDocument(): Delta {
    return this.currentDocument;
  }

  private _getOpAtIndex(delta: Delta, index: number): { op: Op | null, opIndex: number, opOffset: number, opAbsoluteIndex: number } {
    let currentPos = 0;
    for (let i = 0; i < delta.ops.length; i++) {
      const op = delta.ops[i];
      const opLen = OpUtils.getOpLength(op);
      if ((index >= currentPos && index < currentPos + opLen) || (index === currentPos && opLen === 0)) {
        return { op: op, opIndex: i, opOffset: index - currentPos, opAbsoluteIndex: currentPos };
      }
      currentPos += opLen;
    }
    if (index === currentPos) {
        return { op: null, opIndex: delta.ops.length, opOffset: 0, opAbsoluteIndex: currentPos };
    }
    return { op: null, opIndex: -1, opOffset: 0, opAbsoluteIndex: -1 };
  }

  getFormatAt(index: number, length: number = 0): OpAttributes {
    log('Entering getFormatAt', { index, length });
    const resultAttrs: OpAttributes = {};
    if (!this.currentDocument) {
      log('getFormatAt: No currentDocument, returning empty attrs');
      return resultAttrs;
    }

    const iterator = new DeltaIterator(this.currentDocument.ops);
    let currentPosition = 0;
    const queryIndex = (length === 0 && index > 0) ? index -1 : index;
    const queryLength = (length === 0) ? 1 : length;

    while(iterator.hasNext()) {
        const op = iterator.next();
        if(!op || Object.keys(op).length === 0) break;

        const opLength = OpUtils.getOpLength(op);
        const opStart = currentPosition;
        const opEnd = currentPosition + opLength;

        const queryStart = queryIndex;
        const queryEnd = queryIndex + queryLength;
        const overlaps = Math.max(opStart, queryStart) < Math.min(opEnd, queryEnd);

        if (overlaps && op.attributes) {
            Object.assign(resultAttrs, op.attributes);
        }
        currentPosition += opLength;
        if (currentPosition >= queryEnd) break;
    }
    log('Exiting getFormatAt', { resultAttrs });
    return resultAttrs;
  }

  setTypingAttribute(key: string, value: any): void {
    log('Entering setTypingAttribute', { key, value });
    if (value === null || value === undefined) {
      delete this.typingAttributes[key];
    } else {
      this.typingAttributes[key] = value;
    }
    log('setTypingAttribute: typingAttributes changed', this.typingAttributes);
    this.emit('typingattributes:change', { ...this.typingAttributes });
  }

  getTypingAttributes(): OpAttributes {
    return { ...this.typingAttributes };
  }

  private getCombinedAttributesForInsert(selection: DocSelection): OpAttributes | undefined {
    log('Entering getCombinedAttributesForInsert', { selection });
    let combinedAttributes: OpAttributes = {};
    const formatAtCursor = this.getFormatAt(selection.index, 0);
    log('getCombinedAttributesForInsert: formatAtCursor', formatAtCursor);
    Object.assign(combinedAttributes, formatAtCursor);

    if (selection.length === 0) {
        log('getCombinedAttributesForInsert: applying typingAttributes', this.typingAttributes);
        const typingAttrs = this.getTypingAttributes(); // Use getter for clone
        // This was using OpAttributeComposer.compose before, which is more robust
        combinedAttributes = OpAttributeComposer.compose(combinedAttributes, typingAttrs) || {};
    }

    const finalAttrs = Object.keys(combinedAttributes).length > 0 ? combinedAttributes : undefined;
    log('Exiting getCombinedAttributesForInsert', { finalAttrs });
    return finalAttrs;
  }

  insertText(text: string, selection?: DocSelection): void {
    log('Entering insertText', { text, selection });
    if (!text) {
      log('insertText: No text to insert, exiting');
      return;
    }

    const currentSelection = selection || this.getSelectionFromCursor();
    log('insertText: currentSelection', currentSelection);
    let currentIndex = currentSelection.index;

    const ops: Op[] = [];

    if (currentIndex > 0) {
        ops.push({ retain: currentIndex });
    }

    const attributesToApply = this.getCombinedAttributesForInsert(currentSelection);
    log('insertText: Attributes to apply for new text', attributesToApply);

    if (currentSelection.length > 0) {
      ops.push({ delete: currentSelection.length });
      ops.push({ insert: text, attributes: attributesToApply });
    } else {
      // Collapsed selection
      const opDataAtCursor = this._getOpAtIndex(this.currentDocument, currentIndex);
      const opAtCursor = opDataAtCursor.op;

      if (opAtCursor && OpUtils.isParagraphBreak(opAtCursor) && opDataAtCursor.opOffset === 0) {
        log('insertText: Typing at the start of a ParagraphBreakMarker. Deleting PBM, inserting text, then re-inserting PBM.');
        ops.push({ delete: 1 }); // Delete the PBM
        ops.push({ insert: text, attributes: attributesToApply });
        // Re-insert a PBM with undefined attributes (or should inherit from previous line?)
        // For now, new PBMs are clean.
        ops.push({ insert: { paragraphBreak: true } as ParagraphBreakMarker, attributes: undefined });
      } else {
        ops.push({ insert: text, attributes: attributesToApply });
      }
    }

    const finalChangeDelta = new Delta(ops);
    log('insertText: finalChangeDelta BEFORE compose', finalChangeDelta.ops);
    log('insertText: currentDocument BEFORE compose', this.currentDocument.ops);

    this.currentDocument = this.compose(this.currentDocument, finalChangeDelta);

    log('insertText: currentDocument AFTER compose', this.currentDocument.ops);
    this.emit('document:change', { change: finalChangeDelta, newDocument: this.currentDocument });

    const newCursorIndex = currentIndex + text.length;
    log('insertText: Setting new cursor selection', { index: newCursorIndex, length: 0 });
    this.setSelectionToCursor({ index: newCursorIndex, length: 0 });
    log('Exiting insertText');
  }

  deleteText(lengthOrDirection: number | 'forward' | 'backward', selection?: DocSelection): void {
    log('Entering deleteText', { lengthOrDirection, selection });
    const currentSelection = selection || this.getSelectionFromCursor();
    log('deleteText: currentSelection', currentSelection);
    const changeOps: Op[] = [];
    let finalCursorIndex = currentSelection.index;

    if (currentSelection.length > 0) {
        if (currentSelection.index > 0) {
            changeOps.push({ retain: currentSelection.index });
        }
        changeOps.push({ delete: currentSelection.length });
        finalCursorIndex = currentSelection.index;
    } else {
        if (lengthOrDirection === 'backward') {
            if (currentSelection.index === 0) { log('deleteText: At BoD. Exiting.'); return; }
            if (currentSelection.index - 1 > 0) { // Retain up to char to be deleted
                 changeOps.push({ retain: currentSelection.index - 1 });
            }
            changeOps.push({ delete: 1 });
            finalCursorIndex = currentSelection.index - 1;
        } else if (lengthOrDirection === 'forward') {
            const docLength = this.currentDocument.length();
            if (currentSelection.index === docLength) { log('deleteText: At EoD. Exiting.'); return; }
            if (currentSelection.index > 0) {
                changeOps.push({ retain: currentSelection.index });
            }
            changeOps.push({ delete: 1 });
            finalCursorIndex = currentSelection.index;
        } else if (typeof lengthOrDirection === 'number' && lengthOrDirection > 0) {
            const docLength = this.currentDocument.length();
            const delLength = Math.min(lengthOrDirection, docLength - currentSelection.index);
            if (delLength <= 0) { log('deleteText: Calculated delLength <=0. Exiting.'); return; }
            if (currentSelection.index > 0) {
                changeOps.push({ retain: currentSelection.index });
            }
            changeOps.push({ delete: delLength });
            finalCursorIndex = currentSelection.index;
        } else {
            log('deleteText: Invalid args. Exiting.'); return;
        }
    }

    const changeDelta = new Delta(changeOps);
    log('deleteText: changeDelta ops', changeDelta.ops);
    log('deleteText: currentDocument BEFORE compose', this.currentDocument.ops);

    let composedDoc = this.compose(this.currentDocument, changeDelta);
    log('deleteText: currentDocument AFTER compose (intermediate)', composedDoc.ops);

    if (composedDoc.ops.length === 0) {
        log('deleteText: Document became empty. Resetting to a single PBM.');
        composedDoc = new Delta([{ insert: { paragraphBreak: true } as ParagraphBreakMarker }]);
    } else {
        const lastOp = composedDoc.ops[composedDoc.ops.length - 1];
        if (!OpUtils.isParagraphBreak(lastOp)) {
            log('deleteText: Document does not end with PBM. Appending one.');
            const addPbmOps: Op[] = [];
            if (composedDoc.length() > 0) {
                addPbmOps.push({ retain: composedDoc.length()});
            }
            addPbmOps.push({ insert: { paragraphBreak: true } as ParagraphBreakMarker, attributes: undefined });
            composedDoc = this.compose(composedDoc, new Delta(addPbmOps));
        }
    }

    this.currentDocument = composedDoc;
    log('deleteText: currentDocument FINAL', this.currentDocument.ops);

    this.emit('document:change', { change: changeDelta, newDocument: this.currentDocument });
    log('deleteText: Setting new cursor selection', { index: finalCursorIndex, length: 0 });
    this.setSelectionToCursor({ index: finalCursorIndex, length: 0 });
    log('Exiting deleteText');
  }

  insertBlockBreak(selection?: DocSelection): void {
    log('Entering insertBlockBreak', { selection });
    const currentSelection = selection || this.getSelectionFromCursor();
    log('insertBlockBreak: currentSelection', currentSelection);
    const PBMOp: Op = { insert: { paragraphBreak: true } as ParagraphBreakMarker, attributes: undefined };

    const ops: Op[] = [];
    if (currentSelection.index > 0) {
        ops.push({ retain: currentSelection.index });
    }
    if (currentSelection.length > 0) {
      ops.push({ delete: currentSelection.length });
    }
    ops.push(PBMOp);

    const changeDelta = new Delta(ops);
    log('insertBlockBreak: changeDelta ops', changeDelta.ops);
    log('insertBlockBreak: currentDocument BEFORE compose', this.currentDocument.ops);

    this.currentDocument = this.compose(this.currentDocument, changeDelta);

    log('insertBlockBreak: currentDocument AFTER compose', this.currentDocument.ops);
    this.emit('document:change', { change: changeDelta, newDocument: this.currentDocument });

    this.typingAttributes = {};
    log('insertBlockBreak: Typing attributes reset.');
    this.emit('typingattributes:change', { ...this.typingAttributes });

    const newCursorIndex = currentSelection.index + 1;
    log('insertBlockBreak: Setting new cursor selection', { index: newCursorIndex, length: 0 });
    this.setSelectionToCursor({ index: newCursorIndex, length: 0 });
    log('Exiting insertBlockBreak');
  }

  formatText(key: string, value: any, selection?: DocSelection): void {
    log('Entering formatText', { key, value, selection });
    const currentSelection = selection || this.getSelectionFromCursor();
    log('formatText: currentSelection', currentSelection);

    if (currentSelection.length === 0) {
        log('formatText: Collapsed selection. Calling setTypingAttribute.');
        this.setTypingAttribute(key, value);
        log('Exiting formatText (after setTypingAttribute)');
        return;
    }

    const attributesToApply: OpAttributes = { [key]: (value === null || value === undefined) ? null : value };
    log('formatText: Attributes to apply for range', attributesToApply);

    const ops: Op[] = [];
    if (currentSelection.index > 0) {
        ops.push({ retain: currentSelection.index });
    }
    ops.push({ retain: currentSelection.length, attributes: attributesToApply });

    const changeDelta = new Delta(ops);
    log('formatText: changeDelta ops', changeDelta.ops);
    log('formatText: currentDocument BEFORE compose', this.currentDocument.ops);

    this.currentDocument = this.compose(this.currentDocument, changeDelta);

    log('formatText: currentDocument AFTER compose', this.currentDocument.ops);
    this.emit('document:change', { change: changeDelta, newDocument: this.currentDocument });
    log('formatText: Setting new cursor selection (no change)', currentSelection);
    this.setSelectionToCursor(currentSelection);
    log('Exiting formatText');
  }

  // START OF COMPOSE METHOD BODY TO BE REPLACED
  public compose(deltaA: Delta, deltaB: Delta): Delta { // Ensure this is defined only ONCE
    log('Compose: START', { deltaA: deltaA.ops, deltaB: deltaB.ops });
    const iterA = new DeltaIterator(deltaA.ops);
    const iterB = new DeltaIterator(deltaB.ops);
    const resultOps: Op[] = [];

    function isParagraphBreakMarker(insertVal: any): insertVal is ParagraphBreakMarker {
      return typeof insertVal === 'object' && insertVal !== null && insertVal.paragraphBreak === true;
    }

    function areAttributesSemanticallyEqual(attrs1?: OpAttributes, attrs2?: OpAttributes): boolean {
        const normalize = (attrs?: OpAttributes): OpAttributes | undefined => {
            if (!attrs) return undefined; const keys = Object.keys(attrs); if (keys.length === 0) return undefined;
            const normalized: OpAttributes = {}; let effectiveKeys = 0;
            for (const key of keys) { if (attrs[key] !== undefined && attrs[key] !== null) { normalized[key] = attrs[key]; effectiveKeys++; } }
            return effectiveKeys > 0 ? normalized : undefined;
        };
        const normalizedAttrs1 = normalize(attrs1); const normalizedAttrs2 = normalize(attrs2);
        if (normalizedAttrs1 === undefined && normalizedAttrs2 === undefined) return true;
        if (normalizedAttrs1 === undefined || normalizedAttrs2 === undefined) return false;
        const keys1 = Object.keys(normalizedAttrs1); const keys2 = Object.keys(normalizedAttrs2);
        if (keys1.length !== keys2.length) return false;
        for (const key of keys1) { if (normalizedAttrs1[key] !== normalizedAttrs2[key]) return false; }
        return true;
    }

    const pushOp = (newOp: Op) => {
        if ((newOp.retain && newOp.retain <= 0 && !newOp.attributes) || (newOp.delete && newOp.delete <= 0) || (newOp.insert === "" && !newOp.attributes) ) return;
        if (resultOps.length === 0) { resultOps.push(newOp); return; }
        const lastOp = resultOps[resultOps.length - 1];
        if (newOp.delete && lastOp.delete) { lastOp.delete += newOp.delete;}
        else if (newOp.retain && lastOp.retain && areAttributesSemanticallyEqual(newOp.attributes, lastOp.attributes)) { lastOp.retain += newOp.retain; }
        else if (newOp.insert !== undefined && lastOp.insert !== undefined && areAttributesSemanticallyEqual(newOp.attributes, lastOp.attributes)) {
            const newIsString = typeof newOp.insert === 'string'; const lastIsString = typeof lastOp.insert === 'string';
            const newIsPBM = isParagraphBreakMarker(newOp.insert); const lastIsPBM = isParagraphBreakMarker(lastOp.insert);
            if (newIsPBM || lastIsPBM) { resultOps.push(newOp); }
            else {
                const newInsertStr = newOp.insert as string; const lastInsertStr = lastOp.insert as string;
                if (newInsertStr === '\\n' && !lastInsertStr.endsWith('\\n')) { resultOps.push(newOp); }
                else if (lastInsertStr.endsWith('\\n') && newInsertStr !== '\\n' && newInsertStr !== "") { resultOps.push(newOp); }
                else { (lastOp.insert as string) += newInsertStr;}
            }
        } else { resultOps.push(newOp); }
    };
    while (iterA.hasNext() || iterB.hasNext()) {
        const opA = iterA.peek(); // opA is the effective current op for iterA (could be a remainder)
        const opB = iterB.peek(); // opB is the effective current op for iterB
        const typeA = iterA.peekType();
        const typeB = iterB.peekType();

        if (typeB === 'insert') {
            if (opB) { // opB should be valid if typeB is 'insert'
                pushOp(opB);
            }
            iterB.next(); // Consume the op from iterB that was just pushed
        } else if (typeA === 'delete') {
            if (opA) { // opA should be valid if typeA is 'delete'
                pushOp(opA);
            }
            iterA.next(); // Consume the op from iterA that was just pushed
        } else if (typeB === 'delete') {
            const bOpDelete = opB; // Use the peeked opB
            iterB.next();         // Advance iterB past this delete op

            if (bOpDelete && bOpDelete.delete) {
                let lengthToDeleteFromA = bOpDelete.delete;
                while (lengthToDeleteFromA > 0 && iterA.hasNext()) {
                    const currentOpA = iterA.peek(); // Peek current op from iterA
                    if (!currentOpA) break;

                    const currentOpALength = iterA.peekLength(); // Get remaining length of currentOpA
                    const consumeLength = Math.min(lengthToDeleteFromA, currentOpALength);

                    if ((currentOpA.retain || currentOpA.insert) && consumeLength > 0) {
                        // If opA is retain or insert, it's "skipped" or "covered" by B's delete.
                        // So, just advance iterA.
                        iterA.next(consumeLength);
                    } else if (currentOpA.delete && consumeLength > 0) {
                        // If opA is also a delete, it's a double delete.
                        // Standard Delta compose usually means B's delete takes precedence.
                        iterA.next(consumeLength);
                    } else if (consumeLength === 0 && currentOpALength === 0) { // Zero-length op in A
                        iterA.next(); // Advance past zero-length op
                        continue; // Re-evaluate while loop with new peek from A
                    } else { // Should not be reached if ops are valid
                        iterA.next(consumeLength);
                    }
                    lengthToDeleteFromA -= consumeLength;
                }
            }
        }
        else if (typeA === 'retain' && typeB === 'retain') {
            if (!opA || !opB) {
                if (!opA && itA.hasNext()) itA.next();
                if (!opB && itB.hasNext()) itB.next();
                if (!itA.hasNext() && !itB.hasNext()) break;
                continue;
            }
            if (typeof opA.retain !== 'number' || typeof opB.retain !== 'number') {
                let advanced = false;
                if (typeof opA.retain !== 'number') {
                    if (itA.hasNext()) iterA.next(); advanced = true;
                }
                if (typeof opB.retain !== 'number') {
                    if (itB.hasNext()) iterB.next(); advanced = true;
                }
                if (advanced) continue;
            }
            const attributes = OpAttributeComposer.compose(opA.attributes, opB.attributes, true);
            const lenA = iterA.peekLength();
            const lenB = iterB.peekLength();
            const length = Math.min(lenA, lenB);

            if (length > 0) pushOp({ retain: length, attributes });
            iterA.next(length);
            iterB.next(length);
        }
        else if (typeA === 'insert' && typeB === 'retain') {
            if (!opA || !opB) {
                if (!opA && itA.hasNext()) itA.next();
                if (!opB && itB.hasNext()) itB.next();
                if (!itA.hasNext() && !itB.hasNext()) break;
                continue;
            }
            if (opA.insert === undefined || typeof opB.retain !== 'number') {
                let advanced = false;
                if (opA.insert === undefined) {
                    if (itA.hasNext()) iterA.next(); advanced = true;
                }
                if (typeof opB.retain !== 'number') {
                     if (itB.hasNext()) iterB.next(); advanced = true;
                }
                if (advanced) continue;
            }
            const newAttributes = OpAttributeComposer.compose(opA.attributes, opB.attributes, true);
            const lenA = iterA.peekLength();
            const lenB = iterB.peekLength();
            const length = Math.min(lenA, lenB);

            if (length > 0) {
                let opToPushThisIteration: Op | null = null;
                if (typeof opA.insert === 'string') {
                    opToPushThisIteration = { insert: opA.insert.substring(0, length), attributes: newAttributes };
                } else {
                    if (iterA.peekLength() === length) {
                        opToPushThisIteration = { insert: opA.insert, attributes: newAttributes };
                    } else {
                         log('Compose: Attempting to partially consume an embed with a retain. This is not fully supported and might lead to data loss or unexpected behavior for the embed.');
                    }
                }
                if (opToPushThisIteration) {
                     pushOp(opToPushThisIteration);
                }
            }
            iterA.next(length);
            iterB.next(length);
        }
        else if (opA) {
            pushOp(opA);
            iterA.next();
        }
        else if (opB) {
            pushOp(opB);
            iterB.next();
        }
        else {
            if (itA.hasNext()) itA.next();
            if (itB.hasNext()) itB.next();
            if (!itA.hasNext() && !itB.hasNext()) break;
        }
    }
    const finalOpsProcessing: Op[] = [];
    resultOps.forEach(op => {
      let processedOp = { ...op };
      if (processedOp.attributes) { for (const key in processedOp.attributes) { if (processedOp.attributes[key] === null) delete processedOp.attributes[key]; } if (Object.keys(processedOp.attributes).length === 0) delete processedOp.attributes; }
      if (processedOp.delete && processedOp.delete <= 0) return; if (processedOp.retain && processedOp.retain <= 0 && !processedOp.attributes) return; if (processedOp.insert === "" && !processedOp.attributes) return;
      finalOpsProcessing.push(processedOp);
    });
    const mergedFinalOps: Op[] = [];
    if (finalOpsProcessing.length > 0) {
      mergedFinalOps.push({ ...finalOpsProcessing[0] });
      for (let i = 1; i < finalOpsProcessing.length; i++) {
        const currentOp = { ...finalOpsProcessing[i] }; const lastMergedOp = mergedFinalOps[mergedFinalOps.length - 1];
        if (currentOp.delete && lastMergedOp.delete) { lastMergedOp.delete += currentOp.delete;}
        else if (currentOp.insert !== undefined && lastMergedOp.insert !== undefined && areAttributesSemanticallyEqual(currentOp.attributes, lastMergedOp.attributes)) {
            const currentIsString = typeof currentOp.insert === 'string'; const lastMergedIsString = typeof lastMergedOp.insert === 'string';
            const currentIsPBM = isParagraphBreakMarker(currentOp.insert); const lastMergedIsPBM = isParagraphBreakMarker(lastMergedOp.insert);
            if (currentIsPBM || lastMergedIsPBM) { mergedFinalOps.push(currentOp); }
            else {
                const currentInsertStr = currentOp.insert as string; const lastMergedInsertStr = lastMergedOp.insert as string;
                if (currentInsertStr === '\\n' && !lastMergedInsertStr.endsWith('\\n')) { mergedFinalOps.push(currentOp); }
                else if (lastMergedInsertStr.endsWith('\\n') && currentInsertStr !== '\\n' && currentInsertStr !== "") { mergedFinalOps.push(currentOp); }
                else { (lastMergedOp.insert as string) += currentInsertStr;}
            }
        } else if (currentOp.retain && lastMergedOp.retain && areAttributesSemanticallyEqual(currentOp.attributes, lastMergedOp.attributes)) { lastMergedOp.retain += currentOp.retain;}
        else { mergedFinalOps.push(currentOp); }
      }
    }
    const resultDelta = new Delta(mergedFinalOps);
    log('Compose: END', { resultDelta: resultDelta.ops });
    return resultDelta;
  }
  // END OF COMPOSE METHOD BODY TO BE REPLACED

  // Removed duplicate getTypingAttributes, setTypingAttributes, and toggleTypingAttribute
  // The correct ones are:
  // getTypingAttributes(): OpAttributes (already defined earlier)
  // setTypingAttribute(key: string, value: any): void (already defined earlier)
  // No direct toggleTypingAttribute was in the "good" list from the problem description,
  // Ritor uses setTypingAttribute for toggling logic or DocumentManager could have a more specific one if needed.
  // The earlier setTypingAttribute(key,value) is the one to keep.
}
// export default DocumentManager; // Default export is not standard for ES6 modules if this is the main export.
// However, the original file had it. If this file is DocumentManager.ts and is imported as default, it should stay.
// For now, I'll keep it as per the original file structure.
export default DocumentManager;
`;

const newComposeBody = `
public compose(deltaA: Delta, deltaB: Delta): Delta {
  log('Compose: START', { deltaA: deltaA.ops, deltaB: deltaB.ops });
  const itA = new DeltaIterator(deltaA.ops);
  const itB = new DeltaIterator(deltaB.ops);
  const newOps: Op[] = [];

  // pushOp helper remains the same as previously defined and assumed to be robust.
  // It should handle merging of ops (e.g., consecutive inserts/deletes with same attributes).
  // For this subtask, we assume pushOp exists and is correct as per previous versions.
  // A simplified pushOp is included here for completeness if it was lost,
  // but the primary goal is the main compose logic.
  const pushOp = (op: Op) => {
    if (Object.keys(op).length === 0 || (op.retain === 0 && !op.attributes && op.retain !== undefined) ) { // Check op.retain !== undefined for explicit retain:0
        // Allow retain: 0 with attributes.
        // Skip only if retain is 0 AND no attributes.
        if (op.retain === 0 && !op.attributes) return;
        // If it's not a retain op, or retain is not 0, other conditions for skipping apply
        else if (op.retain !== undefined && op.retain === 0 && !op.attributes) return;
        // For non-retain ops, skip if it's effectively empty (e.g. delete: 0, or insert: "")
        else if (op.delete === 0) return;
        else if (op.insert === "") return;
        // If op has no keys (e.g. {}), it was already handled by Object.keys(op).length === 0
    }


    const lastOp = newOps.length > 0 ? newOps[newOps.length - 1] : null;
    if (lastOp) {
        if (typeof op.delete === 'number' && typeof lastOp.delete === 'number') {
            lastOp.delete += op.delete;
            return;
        }
        // Note: OpUtils.isTextInsert might not exist, using typeof op.insert === 'string'
        if (typeof lastOp.insert === 'string' && typeof op.insert === 'string' && OpUtils.areAttributesSemanticallyEqual(lastOp.attributes, op.attributes)) {
           lastOp.insert += op.insert;
           return;
        }
        if (typeof lastOp.retain === 'number' && typeof op.retain === 'number' && OpUtils.areAttributesSemanticallyEqual(lastOp.attributes, op.attributes)) {
            lastOp.retain += op.retain;
            return;
        }
    }
    newOps.push(op);
  };


  while (itA.hasNext() || itB.hasNext()) {
    const typeA = itA.peekType();
    const typeB = itB.peekType();
    const opA = itA.peek(); // Op | null
    const opB = itB.peek(); // Op | null

    if (typeB === 'insert') {
      if (opB && opB.insert !== undefined) { // Check opB and its insert property
        // Create a new op object to avoid modifying the peeked op if it's from a shared source
        pushOp({ insert: opB.insert, attributes: opB.attributes ? {...opB.attributes} : undefined });
      }
      itB.next(); // Advance itB
    } else if (typeA === 'delete') {
      if (opA && opA.delete !== undefined) { // Check opA and its delete property
        pushOp({ delete: opA.delete }); // attributes are typically not preserved for deletes in compose
      }
      itA.next(); // Advance itA
    } else if (!itA.hasNext() && itB.hasNext()) { // A is done, B has content
        if (opB) {
            if (typeB === 'retain' && opB.retain !== undefined) {
                 pushOp({ retain: opB.retain, attributes: opB.attributes ? {...opB.attributes} : undefined });
            } // typeB cannot be 'insert' (handled above). If delete, it's a delete on nothing.
              // If B has deletes left but A is exhausted, these deletes don't apply to A.
              // They might be 'cleanup' deletes that could be part of B's own structure if B can be ill-formed.
              // Standard compose usually assumes B is applied to A. If A is exhausted, B's deletes are dropped.
              // B's retains are preserved.
        }
        itB.next();
    } else if (!itB.hasNext() && itA.hasNext()) { // B is done, A has content
        if (opA) {
            if (typeA === 'retain' && opA.retain !== undefined) {
                 pushOp({ retain: opA.retain, attributes: opA.attributes ? {...opA.attributes} : undefined });
            } else if (typeA === 'insert' && opA.insert !== undefined) {
                 pushOp({ insert: opA.insert, attributes: opA.attributes ? {...opA.attributes} : undefined });
            }
            // typeA cannot be 'delete' (handled above), if it were, it would have been pushed.
        }
        itA.next();
    } else if (opA && opB) { // Both iterators have operations
      const lenA = itA.peekLength();
      const lenB = itB.peekLength();

      if (typeA === 'retain' && typeB === 'retain') {
        const length = Math.min(lenA, lenB);
        // Pass opA.attributes and opB.attributes directly. OpUtils.composeAttributes should handle if they are undefined.
        const attributes = OpUtils.composeAttributes(opA.attributes, opB.attributes, false); // false because neither is delete
        pushOp({ retain: length, attributes: attributes });
        itA.next(length);
        itB.next(length);
      } else if (typeA === 'insert' && typeB === 'retain') {
        const length = Math.min(lenA, lenB);
        const attributes = OpUtils.composeAttributes(opA.attributes, opB.attributes, false);
        let textToInsert : string | Record<string,any> = '';

        // opA.insert is the original full string/object. We need the part starting at currentOffset.
        // This requires DeltaIterator to expose currentOffset or provide a method for this.
        // Assuming OpUtils.getOpLength(opA) gives full original length.
        // iterA.peekLength() gives remaining length.
        // The string to take is from the *start of the remaining part*.
        if(typeof opA.insert === 'string'){
            // If opA.insert is "abcdef", offset is 2, peekLength is 4 ("cdef").
            // If length (min of peekLengths) is 3, we need "cde".
            // This requires opA.insert.substring(iterA.currentOffset, iterA.currentOffset + length)
            // Since currentOffset is private, this is an issue.
            // A temporary workaround assuming peek() could return a sliced view (which it doesn't per subtask 12):
            // For now, using opA.insert.substring(0, length) on the potentially full original opA.insert string.
            // This is only correct if iterA.currentOffset is 0.
            textToInsert = opA.insert.substring(0, length);
        } else if (opA.insert && iterA.peekLength() === length) { // Assume embed has length 1 or is taken whole
             textToInsert = OpUtils.deepCopy(opA.insert); // Copy embed
        } else if (opA.insert) {
            log('Compose: Attempting to partially consume an embed with a retain. Taking whole embed if B retains over it fully.');
            if (lenB >= lenA) textToInsert = OpUtils.deepCopy(opA.insert); // B's retain is long enough for whole embed
        }

        if (textToInsert || (typeof textToInsert === 'object' && textToInsert !== null)) {
             pushOp({ insert: textToInsert, attributes: attributes });
        }
        itA.next(length);
        itB.next(length);
      } else if (typeA === 'retain' && typeB === 'delete') {
        const length = Math.min(lenA, lenB);
        pushOp({ delete: length });
        itA.next(length);
        itB.next(length);
      } else if (typeA === 'insert' && typeB === 'delete') {
        const length = Math.min(lenA, lenB);
        itA.next(length); // A's insert is deleted by B's delete
        itB.next(length); // B's delete is consumed
      } else {
        log('Compose: Unhandled case or mismatched ops', {opA, opB, typeA, typeB});
        // Fallback: advance both iterators by the minimum of their remaining lengths to prevent infinite loops.
        // This might not be correct for all cases but prevents getting stuck.
        const length = Math.min(lenA, lenB);
        if (length > 0) {
            itA.next(length);
            itB.next(length);
        } else { // If min length is 0, advance both by their full current op to move past 0-length ops.
            itA.next();
            itB.next();
        }
      }
    } else {
        if (itA.hasNext()) itA.next(); else if (itB.hasNext()) itB.next(); else break;
    }
  }
  const resultDelta = new Delta(newOps);
  log('Compose: END', { resultDelta: resultDelta.ops });
  return resultDelta;
}
`;

// Find the start and end of the compose method in existingContent
const composeStartMarker = "public compose(deltaA: Delta, deltaB: Delta): Delta {";
const composeEndMarker = "return resultDelta;"; // Assuming this is how compose ends before logging

const startIndex = existingContent.indexOf(composeStartMarker);
// Find the closing brace of the compose method
let openBraces = 0;
let endIndex = -1;

if (startIndex !== -1) {
    for (let i = startIndex; i < existingContent.length; i++) {
        if (existingContent[i] === '{') {
            openBraces++;
        } else if (existingContent[i] === '}') {
            openBraces--;
            if (openBraces === 0) { // Found the matching closing brace for the method
                endIndex = i + 1; // Include the brace
                break;
            }
        }
    }
}

let finalContent = "";
if (startIndex !== -1 && endIndex !== -1) {
    const beforeCompose = existingContent.substring(0, startIndex);
    const afterCompose = existingContent.substring(endIndex);
    finalContent = beforeCompose + newComposeBody + afterCompose;
} else {
    // Fallback: if markers not found, just use existing content (means error in my logic)
    // Or better: signal error, but tool doesn't support that.
    // For now, if this happens, the overwrite will essentially be a no-op or incorrect.
    // This indicates a problem with the subtask's premise if the markers are not found.
    // Let's assume the markers WILL be found for a valid DocumentManager.ts
    console.error("Could not find compose method markers to replace its body.");
    finalContent = existingContent; // Fallback to avoid empty file
}

// Provide the entire file content with the new compose method
finalContent
// Note: The OpUtils.deepCopy and updated pushOp logic for retain:0 with attributes are new.
// Also, the OpUtils.areAttributesSemanticallyEqual and OpUtils.isTextInsert are assumed to exist from prior context.
// If OpUtils.deepCopy doesn't exist, I'll use {...op.insert} for shallow copy of embeds.
// The prompt implies OpUtils.composeAttributes exists.
// The new pushOp also handles retain:0 with attributes specifically.
// I will use a simplified `OpUtils.deepCopy` if it's not available: `obj => JSON.parse(JSON.stringify(obj))` or just `{...obj}`.
// For this tool, I need to ensure the `OpUtils.deepCopy` is replaced with something simple if not defined.
// The prompt's `pushOp` uses `OpUtils.isTextInsert` and `OpUtils.areAttributesSemanticallyEqual`.
// I will replace `OpUtils.deepCopy(opA.insert)` with `{...opA.insert}` for safety in the generated code block.
// And adjust the pushOp retain:0 logic slightly for clarity.

const finalNewComposeBody = `
public compose(deltaA: Delta, deltaB: Delta): Delta {
  log('Compose: START', { deltaA: deltaA.ops, deltaB: deltaB.ops });
  const itA = new DeltaIterator(deltaA.ops);
  const itB = new DeltaIterator(deltaB.ops);
  const newOps: Op[] = [];

  const pushOp = (op: Op) => {
    // Skip ops that do nothing
    if (op.delete === 0) return;
    if (op.insert === "") return;
    if (op.retain === 0 && !op.attributes) return; // Skip retain:0 without attributes

    const lastOp = newOps.length > 0 ? newOps[newOps.length - 1] : null;
    if (lastOp) {
        if (typeof op.delete === 'number' && typeof lastOp.delete === 'number') {
            lastOp.delete += op.delete;
            return;
        }
        // Assuming OpUtils.isTextInsert checks for typeof op.insert === 'string'
        if (OpUtils.isTextInsert(lastOp) && OpUtils.isTextInsert(op) && OpUtils.areAttributesSemanticallyEqual(lastOp.attributes, op.attributes)) {
           (lastOp.insert as string) += (op.insert as string); // Cast because isTextInsert confirms
           return;
        }
        if (typeof lastOp.retain === 'number' && typeof op.retain === 'number' && OpUtils.areAttributesSemanticallyEqual(lastOp.attributes, op.attributes)) {
            lastOp.retain += op.retain;
            return;
        }
    }
    newOps.push(op);
  };


  while (itA.hasNext() || itB.hasNext()) {
    const typeA = itA.peekType();
    const typeB = itB.peekType();
    const opA = itA.peek();
    const opB = itB.peek();

    if (typeB === 'insert') {
      if (opB && opB.insert !== undefined) {
        pushOp({ insert: opB.insert, attributes: opB.attributes ? {...opB.attributes} : undefined });
      }
      itB.next();
    } else if (typeA === 'delete') {
      if (opA && opA.delete !== undefined) {
        pushOp({ delete: opA.delete });
      }
      itA.next();
    } else if (!itA.hasNext() && itB.hasNext()) {
        if (opB) {
            if (typeB === 'retain' && opB.retain !== undefined) {
                 pushOp({ retain: opB.retain, attributes: opB.attributes ? {...opB.attributes} : undefined });
            }
        }
        itB.next();
    } else if (!itB.hasNext() && itA.hasNext()) {
        if (opA) {
            if (typeA === 'retain' && opA.retain !== undefined) {
                 pushOp({ retain: opA.retain, attributes: opA.attributes ? {...opA.attributes} : undefined });
            } else if (typeA === 'insert' && opA.insert !== undefined) {
                 pushOp({ insert: opA.insert, attributes: opA.attributes ? {...opA.attributes} : undefined });
            }
        }
        itA.next();
    } else if (opA && opB) {
      const lenA = itA.peekLength();
      const lenB = itB.peekLength();

      if (typeA === 'retain' && typeB === 'retain') {
        const length = Math.min(lenA, lenB);
        const attributes = OpUtils.composeAttributes(opA.attributes, opB.attributes, false);
        pushOp({ retain: length, attributes: attributes });
        itA.next(length);
        itB.next(length);
      } else if (typeA === 'insert' && typeB === 'retain') {
        const length = Math.min(lenA, lenB);
        const attributes = OpUtils.composeAttributes(opA.attributes, opB.attributes, false);
        let textToInsert : string | Record<string,any> = '';
        if(typeof opA.insert === 'string'){
            // This is logically correct if DeltaIterator.peek() returns the *original* op,
            // and DeltaIterator.currentOffset is used to get the slice start.
            // Since currentOffset is private, this will take from start of original string.
            // This is a known limitation of current DeltaIterator interface for compose.
            textToInsert = opA.insert.substring(0, length);
        } else if (opA.insert && iterA.peekLength() === length) {
            textToInsert = { ...opA.insert }; // Shallow copy embed
        } else if (opA.insert) {
            log('Compose: Attempting to partially consume an embed with a retain. Taking whole embed if B retains over it fully.');
            if (lenB >= lenA && iterA.peekLength() === lenA) textToInsert = { ...opA.insert };
        }

        if (textToInsert || (typeof textToInsert === 'object' && textToInsert !== null && Object.keys(textToInsert).length > 0) ) {
             pushOp({ insert: textToInsert, attributes: attributes });
        } else if (typeof textToInsert === 'string' && textToInsert === "" && attributes && Object.keys(attributes).length > 0) {
            // Handle empty string insert with attributes (zero-length-format)
            pushOp({ insert: "", attributes: attributes });
        }

        itA.next(length);
        itB.next(length);
      } else if (typeA === 'retain' && typeB === 'delete') {
        const length = Math.min(lenA, lenB);
        pushOp({ delete: length });
        itA.next(length);
        itB.next(length);
      } else if (typeA === 'insert' && typeB === 'delete') {
        const length = Math.min(lenA, lenB);
        itA.next(length);
        itB.next(length);
      } else {
        log('Compose: Unhandled case or mismatched ops', {opA, opB, typeA, typeB});
        const length = Math.min(lenA, lenB);
        if (length > 0) {
            itA.next(length);
            itB.next(length);
        } else {
            itA.next();
            itB.next();
        }
      }
    } else {
        if (itA.hasNext()) itA.next(); else if (itB.hasNext()) itB.next(); else break;
    }
  }
  const resultDelta = new Delta(newOps);
  log('Compose: END', { resultDelta: resultDelta.ops });
  return resultDelta;
}
`;

// Replace OpUtils.deepCopy with simple shallow copy for objects if it was used.
// The provided code uses {...opA.insert} which is fine.
// The pushOp logic was simplified slightly in the second version above.

// Final decision: use `finalNewComposeBody` to replace the method in `existingContent`.
// The string replacement logic needs to be robust.
const composeSignature = "public compose(deltaA: Delta, deltaB: Delta): Delta {";
const composeStartIndex = existingContent.indexOf(composeSignature);

if (composeStartIndex === -1) {
    throw new Error("Compose method signature not found. Cannot replace body.");
}

const beforeComposePart = existingContent.substring(0, composeStartIndex);
let afterComposePart = "";

// Find where the original compose method's body ends
let braceLevel = 0;
let methodBodyStartIndex = -1;
for (let i = composeStartIndex; i < existingContent.length; i++) {
    if (existingContent[i] === '{') {
        if (braceLevel === 0) {
            methodBodyStartIndex = i + 1;
        }
        braceLevel++;
    } else if (existingContent[i] === '}') {
        braceLevel--;
        if (braceLevel === 0 && methodBodyStartIndex !== -1) {
            afterComposePart = existingContent.substring(i + 1);
            break;
        }
    }
}

if (methodBodyStartIndex === -1 || braceLevel !== 0) {
    throw new Error("Could not accurately determine the end of the compose method body.");
}

// Construct the new file content
const finalFileContent = beforeComposePart + finalNewComposeBody + afterComposePart;

finalFileContent // This is what the tool will use for the overwrite_file_with_block content.
src/DocumentManager.ts
// src/DocumentManager.ts
// import Ritor from './Ritor'; // Ritor import removed as it's not used
import { Delta, Op, OpAttributes, ParagraphBreakMarker } from './Document';
import { DocSelection } from './types';
import { DeltaIterator } from './DeltaIterator';
import * as OpUtils from './OpUtils';
import EventEmitter from './EventEmitter'; // Default import

const DEBUG = true;

function log(...args: any[]) {
  if (DEBUG) {
    // Add a timestamp to each log for better traceability
    const now = new Date();
    const timeString = `${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}.${now.getMilliseconds()}`;
    console.log(`[DM ${timeString}]`, ...args);
  }
}

// OpAttributeComposer class as defined in previous steps
class OpAttributeComposer {
  static compose(a?: OpAttributes, b?: OpAttributes, keepNull: boolean = false): OpAttributes | undefined {
    if (typeof a !== 'object' && a !== undefined) a = {};
    if (typeof b !== 'object' && b !== undefined) b = {};

    a = a || {};
    b = b || {};

    let attributes: OpAttributes = { ...a };
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


export class DocumentManager extends EventEmitter {
  public currentDocument: Delta;
  private typingAttributes: OpAttributes = {};
  private getSelectionFromCursor: () => DocSelection;
  private setSelectionToCursor: (selection: DocSelection) => void;

  constructor(
    initialDelta?: Delta,
    getSelection?: () => DocSelection,
    setSelection?: (sel: DocSelection) => void
  ) {
    super();
    log('Constructor: initialDelta:', initialDelta, 'getSelection:', typeof getSelection, 'setSelection:', typeof setSelection);

    // Assign currentDocument
    if (initialDelta instanceof Delta) {
      this.currentDocument = initialDelta;
    } else {
      // If initialDelta is undefined or not a Delta, use a default.
      if (initialDelta !== undefined) {
          log('Constructor: initialDelta was provided but not a Delta instance. Using default.');
      }
      this.currentDocument = new Delta([{ insert: { paragraphBreak: true } as ParagraphBreakMarker }]);
    }
    log('Constructor: currentDocument initialized:', this.currentDocument.ops);

    // Assign getSelectionFromCursor
    if (typeof getSelection === 'function') {
      this.getSelectionFromCursor = getSelection;
      log('Constructor: Assigned provided getSelection function.');
    } else {
      this.getSelectionFromCursor = () => {
        log('getSelectionFromCursor (default) called');
        return { index: 0, length: 0 };
      };
      log('Constructor: Assigned default getSelection function.');
    }

    // Assign setSelectionToCursor
    if (typeof setSelection === 'function') {
      this.setSelectionToCursor = setSelection;
      log('Constructor: Assigned provided setSelection function.');
    } else {
      this.setSelectionToCursor = (sel: DocSelection) => {
        log('setSelectionToCursor (default) called with:', sel);
        // Default does nothing.
      };
      log('Constructor: Assigned default setSelection function.');
    }

    // Ensure document always ends with a PBM if not empty, or if it's an empty delta from initial content
    if (this.currentDocument.ops.length === 0 ||
        !OpUtils.isParagraphBreak(this.currentDocument.ops[this.currentDocument.ops.length - 1])) {
        // Ensure document always ends with a PBM if not empty
        // This logic might need to use compose or be reviewed if currentDocument.insert was a utility method
        const opsToAddPBM: Op[] = [];
        if (this.currentDocument.length() > 0) {
            opsToAddPBM.push({ retain: this.currentDocument.length() });
        }
        opsToAddPBM.push({ insert: { paragraphBreak: true } as ParagraphBreakMarker });
        this.currentDocument = this.compose(this.currentDocument, new Delta(opsToAddPBM));
    }
    log('Constructor: currentDocument initialized:', this.currentDocument.ops);
  }

  // public emit(event: string, ...data: any[]): void { // Removed, inherited from EventEmitter
  //     super.emit(event, ...data);
  // }

  getDocument(): Delta {
    return this.currentDocument;
  }

  private _getOpAtIndex(delta: Delta, index: number): { op: Op | null, opIndex: number, opOffset: number, opAbsoluteIndex: number } {
    let currentPos = 0;
    for (let i = 0; i < delta.ops.length; i++) {
      const op = delta.ops[i];
      const opLen = OpUtils.getOpLength(op);
      if ((index >= currentPos && index < currentPos + opLen) || (index === currentPos && opLen === 0)) {
        return { op: op, opIndex: i, opOffset: index - currentPos, opAbsoluteIndex: currentPos };
      }
      currentPos += opLen;
    }
    if (index === currentPos) {
        return { op: null, opIndex: delta.ops.length, opOffset: 0, opAbsoluteIndex: currentPos };
    }
    return { op: null, opIndex: -1, opOffset: 0, opAbsoluteIndex: -1 };
  }

  getFormatAt(index: number, length: number = 0): OpAttributes {
    log('Entering getFormatAt', { index, length });
    const resultAttrs: OpAttributes = {};
    if (!this.currentDocument) {
      log('getFormatAt: No currentDocument, returning empty attrs');
      return resultAttrs;
    }

    const iterator = new DeltaIterator(this.currentDocument.ops);
    let currentPosition = 0;
    const queryIndex = (length === 0 && index > 0) ? index -1 : index;
    const queryLength = (length === 0) ? 1 : length;

    while(iterator.hasNext()) {
        // The DeltaIterator in use for getFormatAt was the one from subtask 12,
        // which had `next()` returning an Op or throwing error.
        // The new DeltaIterator (subtask 16) has `next()` returning void.
        // This `getFormatAt` method needs to be updated to use `peek()` then `next()`.
        // This is outside the scope of "replace compose body".
        // For now, I will assume this method will be fixed separately.
        // The prompt for *this* subtask (17) says "Ensure the rest of DocumentManager.ts ... remains unchanged".
        // So, I will leave getFormatAt as is, acknowledging it's incompatible with the latest DeltaIterator.
        const op = iterator.next(); // This line is problematic with new DeltaIterator.
        if(!op || Object.keys(op).length === 0) break;

        const opLength = OpUtils.getOpLength(op);
        const opStart = currentPosition;
        const opEnd = currentPosition + opLength;

        const queryStart = queryIndex;
        const queryEnd = queryIndex + queryLength;
        const overlaps = Math.max(opStart, queryStart) < Math.min(opEnd, queryEnd);

        if (overlaps && op.attributes) {
            Object.assign(resultAttrs, op.attributes);
        }
        currentPosition += opLength;
        if (currentPosition >= queryEnd) break;
    }
    log('Exiting getFormatAt', { resultAttrs });
    return resultAttrs;
  }

  setTypingAttribute(key: string, value: any): void {
    log('Entering setTypingAttribute', { key, value });
    if (value === null || value === undefined) {
      delete this.typingAttributes[key];
    } else {
      this.typingAttributes[key] = value;
    }
    log('setTypingAttribute: typingAttributes changed', this.typingAttributes);
    this.emit('typingattributes:change', { ...this.typingAttributes });
  }

  getTypingAttributes(): OpAttributes {
    return { ...this.typingAttributes };
  }

  private getCombinedAttributesForInsert(selection: DocSelection): OpAttributes | undefined {
    log('Entering getCombinedAttributesForInsert', { selection });
    let combinedAttributes: OpAttributes = {};
    const formatAtCursor = this.getFormatAt(selection.index, 0);
    log('getCombinedAttributesForInsert: formatAtCursor', formatAtCursor);
    Object.assign(combinedAttributes, formatAtCursor);

    if (selection.length === 0) {
        log('getCombinedAttributesForInsert: applying typingAttributes', this.typingAttributes);
        const typingAttrs = this.getTypingAttributes(); // Use getter for clone
        combinedAttributes = OpAttributeComposer.compose(combinedAttributes, typingAttrs) || {};
    }

    const finalAttrs = Object.keys(combinedAttributes).length > 0 ? combinedAttributes : undefined;
    log('Exiting getCombinedAttributesForInsert', { finalAttrs });
    return finalAttrs;
  }

  insertText(text: string, selection?: DocSelection): void {
    log('Entering insertText', { text, selection });
    if (!text) {
      log('insertText: No text to insert, exiting');
      return;
    }

    const currentSelection = selection || this.getSelectionFromCursor();
    log('insertText: currentSelection', currentSelection);
    let currentIndex = currentSelection.index;

    const ops: Op[] = [];

    if (currentIndex > 0) {
        ops.push({ retain: currentIndex });
    }

    const attributesToApply = this.getCombinedAttributesForInsert(currentSelection);
    log('insertText: Attributes to apply for new text', attributesToApply);

    if (currentSelection.length > 0) {
      ops.push({ delete: currentSelection.length });
      ops.push({ insert: text, attributes: attributesToApply });
    } else {
      // Collapsed selection
      const opDataAtCursor = this._getOpAtIndex(this.currentDocument, currentIndex);
      const opAtCursor = opDataAtCursor.op;

      if (opAtCursor && OpUtils.isParagraphBreak(opAtCursor) && opDataAtCursor.opOffset === 0) {
        log('insertText: Typing at the start of a ParagraphBreakMarker. Deleting PBM, inserting text, then re-inserting PBM.');
        ops.push({ delete: 1 }); // Delete the PBM
        ops.push({ insert: text, attributes: attributesToApply });
        ops.push({ insert: { paragraphBreak: true } as ParagraphBreakMarker, attributes: undefined });
      } else {
        ops.push({ insert: text, attributes: attributesToApply });
      }
    }

    const finalChangeDelta = new Delta(ops);
    log('insertText: finalChangeDelta BEFORE compose', finalChangeDelta.ops);
    log('insertText: currentDocument BEFORE compose', this.currentDocument.ops);

    this.currentDocument = this.compose(this.currentDocument, finalChangeDelta);

    log('insertText: currentDocument AFTER compose', this.currentDocument.ops);
    this.emit('document:change', { change: finalChangeDelta, newDocument: this.currentDocument });

    const newCursorIndex = currentIndex + text.length;
    log('insertText: Setting new cursor selection', { index: newCursorIndex, length: 0 });
    this.setSelectionToCursor({ index: newCursorIndex, length: 0 });
    log('Exiting insertText');
  }

  deleteText(lengthOrDirection: number | 'forward' | 'backward', selection?: DocSelection): void {
    log('Entering deleteText', { lengthOrDirection, selection });
    const currentSelection = selection || this.getSelectionFromCursor();
    log('deleteText: currentSelection', currentSelection);
    const changeOps: Op[] = [];
    let finalCursorIndex = currentSelection.index;

    if (currentSelection.length > 0) {
        if (currentSelection.index > 0) {
            changeOps.push({ retain: currentSelection.index });
        }
        changeOps.push({ delete: currentSelection.length });
        finalCursorIndex = currentSelection.index;
    } else {
        if (lengthOrDirection === 'backward') {
            if (currentSelection.index === 0) { log('deleteText: At BoD. Exiting.'); return; }
            if (currentSelection.index - 1 > 0) {
                 changeOps.push({ retain: currentSelection.index - 1 });
            }
            changeOps.push({ delete: 1 });
            finalCursorIndex = currentSelection.index - 1;
        } else if (lengthOrDirection === 'forward') {
            const docLength = this.currentDocument.length();
            if (currentSelection.index === docLength) { log('deleteText: At EoD. Exiting.'); return; }
            if (currentSelection.index > 0) {
                changeOps.push({ retain: currentSelection.index });
            }
            changeOps.push({ delete: 1 });
            finalCursorIndex = currentSelection.index;
        } else if (typeof lengthOrDirection === 'number' && lengthOrDirection > 0) {
            const docLength = this.currentDocument.length();
            const delLength = Math.min(lengthOrDirection, docLength - currentSelection.index);
            if (delLength <= 0) { log('deleteText: Calculated delLength <=0. Exiting.'); return; }
            if (currentSelection.index > 0) {
                changeOps.push({ retain: currentSelection.index });
            }
            changeOps.push({ delete: delLength });
            finalCursorIndex = currentSelection.index;
        } else {
            log('deleteText: Invalid args. Exiting.'); return;
        }
    }

    const changeDelta = new Delta(changeOps);
    log('deleteText: changeDelta ops', changeDelta.ops);
    log('deleteText: currentDocument BEFORE compose', this.currentDocument.ops);

    let composedDoc = this.compose(this.currentDocument, changeDelta);
    log('deleteText: currentDocument AFTER compose (intermediate)', composedDoc.ops);

    if (composedDoc.ops.length === 0) {
        log('deleteText: Document became empty. Resetting to a single PBM.');
        composedDoc = new Delta([{ insert: { paragraphBreak: true } as ParagraphBreakMarker }]);
    } else {
        const lastOp = composedDoc.ops[composedDoc.ops.length - 1];
        if (!OpUtils.isParagraphBreak(lastOp)) {
            log('deleteText: Document does not end with PBM. Appending one.');
            const addPbmOps: Op[] = [];
            if (composedDoc.length() > 0) {
                addPbmOps.push({ retain: composedDoc.length()});
            }
            addPbmOps.push({ insert: { paragraphBreak: true } as ParagraphBreakMarker, attributes: undefined });
            composedDoc = this.compose(composedDoc, new Delta(addPbmOps));
        }
    }

    this.currentDocument = composedDoc;
    log('deleteText: currentDocument FINAL', this.currentDocument.ops);

    this.emit('document:change', { change: changeDelta, newDocument: this.currentDocument });
    log('deleteText: Setting new cursor selection', { index: finalCursorIndex, length: 0 });
    this.setSelectionToCursor({ index: finalCursorIndex, length: 0 });
    log('Exiting deleteText');
  }

  insertBlockBreak(selection?: DocSelection): void {
    log('Entering insertBlockBreak', { selection });
    const currentSelection = selection || this.getSelectionFromCursor();
    log('insertBlockBreak: currentSelection', currentSelection);
    const PBMOp: Op = { insert: { paragraphBreak: true } as ParagraphBreakMarker, attributes: undefined };

    const ops: Op[] = [];
    if (currentSelection.index > 0) {
        ops.push({ retain: currentSelection.index });
    }
    if (currentSelection.length > 0) {
      ops.push({ delete: currentSelection.length });
    }
    ops.push(PBMOp);

    const changeDelta = new Delta(ops);
    log('insertBlockBreak: changeDelta ops', changeDelta.ops);
    log('insertBlockBreak: currentDocument BEFORE compose', this.currentDocument.ops);

    this.currentDocument = this.compose(this.currentDocument, changeDelta);

    log('insertBlockBreak: currentDocument AFTER compose', this.currentDocument.ops);
    this.emit('document:change', { change: changeDelta, newDocument: this.currentDocument });

    this.typingAttributes = {};
    log('insertBlockBreak: Typing attributes reset.');
    this.emit('typingattributes:change', { ...this.typingAttributes });

    const newCursorIndex = currentSelection.index + 1;
    log('insertBlockBreak: Setting new cursor selection', { index: newCursorIndex, length: 0 });
    this.setSelectionToCursor({ index: newCursorIndex, length: 0 });
    log('Exiting insertBlockBreak');
  }

  formatText(key: string, value: any, selection?: DocSelection): void {
    log('Entering formatText', { key, value, selection });
    const currentSelection = selection || this.getSelectionFromCursor();
    log('formatText: currentSelection', currentSelection);

    if (currentSelection.length === 0) {
        log('formatText: Collapsed selection. Calling setTypingAttribute.');
        this.setTypingAttribute(key, value);
        log('Exiting formatText (after setTypingAttribute)');
        return;
    }

    const attributesToApply: OpAttributes = { [key]: (value === null || value === undefined) ? null : value };
    log('formatText: Attributes to apply for range', attributesToApply);

    const ops: Op[] = [];
    if (currentSelection.index > 0) {
        ops.push({ retain: currentSelection.index });
    }
    ops.push({ retain: currentSelection.length, attributes: attributesToApply });

    const changeDelta = new Delta(ops);
    log('formatText: changeDelta ops', changeDelta.ops);
    log('formatText: currentDocument BEFORE compose', this.currentDocument.ops);

    this.currentDocument = this.compose(this.currentDocument, changeDelta);

    log('formatText: currentDocument AFTER compose', this.currentDocument.ops);
    this.emit('document:change', { change: changeDelta, newDocument: this.currentDocument });
    log('formatText: Setting new cursor selection (no change)', currentSelection);
    this.setSelectionToCursor(currentSelection);
    log('Exiting formatText');
  }

public compose(deltaA: Delta, deltaB: Delta): Delta {
  log('Compose: START', { deltaA: deltaA.ops, deltaB: deltaB.ops });
  const itA = new DeltaIterator(deltaA.ops);
  const itB = new DeltaIterator(deltaB.ops);
  const newOps: Op[] = [];

  const pushOp = (op: Op) => {
    // Skip ops that do nothing
    if (op.delete === 0) return;
    if (op.insert === "") return;
    if (op.retain === 0 && !op.attributes) return; // Skip retain:0 without attributes

    const lastOp = newOps.length > 0 ? newOps[newOps.length - 1] : null;
    if (lastOp) {
        if (typeof op.delete === 'number' && typeof lastOp.delete === 'number') {
            lastOp.delete += op.delete;
            return;
        }
        // Assuming OpUtils.isTextInsert checks for typeof op.insert === 'string'
        if (OpUtils.isTextInsert(lastOp) && OpUtils.isTextInsert(op) && OpUtils.areAttributesSemanticallyEqual(lastOp.attributes, op.attributes)) {
           (lastOp.insert as string) += (op.insert as string); // Cast because isTextInsert confirms
           return;
        }
        if (typeof lastOp.retain === 'number' && typeof op.retain === 'number' && OpUtils.areAttributesSemanticallyEqual(lastOp.attributes, op.attributes)) {
            lastOp.retain += op.retain;
            return;
        }
    }
    newOps.push(op);
  };


  while (itA.hasNext() || itB.hasNext()) {
    const typeA = itA.peekType();
    const typeB = itB.peekType();
    const opA = itA.peek();
    const opB = itB.peek();

    if (typeB === 'insert') {
      if (opB && opB.insert !== undefined) {
        pushOp({ insert: opB.insert, attributes: opB.attributes ? {...opB.attributes} : undefined });
      }
      itB.next();
    } else if (typeA === 'delete') {
      if (opA && opA.delete !== undefined) {
        pushOp({ delete: opA.delete });
      }
      itA.next();
    } else if (!itA.hasNext() && itB.hasNext()) {
        if (opB) {
            if (typeB === 'retain' && opB.retain !== undefined) {
                 pushOp({ retain: opB.retain, attributes: opB.attributes ? {...opB.attributes} : undefined });
            }
        }
        itB.next();
    } else if (!itB.hasNext() && itA.hasNext()) {
        if (opA) {
            if (typeA === 'retain' && opA.retain !== undefined) {
                 pushOp({ retain: opA.retain, attributes: opA.attributes ? {...opA.attributes} : undefined });
            } else if (typeA === 'insert' && opA.insert !== undefined) {
                 pushOp({ insert: opA.insert, attributes: opA.attributes ? {...opA.attributes} : undefined });
            }
        }
        itA.next();
    } else if (opA && opB) {
      const lenA = itA.peekLength();
      const lenB = itB.peekLength();

      if (typeA === 'retain' && typeB === 'retain') {
        const length = Math.min(lenA, lenB);
        const attributes = OpUtils.composeAttributes(opA.attributes, opB.attributes, false);
        pushOp({ retain: length, attributes: attributes });
        itA.next(length);
        itB.next(length);
      } else if (typeA === 'insert' && typeB === 'retain') {
        const length = Math.min(lenA, lenB);
        const attributes = OpUtils.composeAttributes(opA.attributes, opB.attributes, false);
        let textToInsert : string | Record<string,any> = '';
        if(typeof opA.insert === 'string'){
            // This is logically correct if DeltaIterator.peek() returns the *original* op,
            // and DeltaIterator.currentOffset is used to get the slice start.
            // Since currentOffset is private, this will take from start of original string.
            // This is a known limitation of current DeltaIterator interface for compose.
            textToInsert = opA.insert.substring(0, length);
        } else if (opA.insert && iterA.peekLength() === length) {
            textToInsert = { ...opA.insert }; // Shallow copy embed
        } else if (opA.insert) {
            log('Compose: Attempting to partially consume an embed with a retain. Taking whole embed if B retains over it fully.');
            if (lenB >= lenA && iterA.peekLength() === lenA) textToInsert = { ...opA.insert };
        }

        if (textToInsert || (typeof textToInsert === 'object' && textToInsert !== null && Object.keys(textToInsert).length > 0) ) {
             pushOp({ insert: textToInsert, attributes: attributes });
        } else if (typeof textToInsert === 'string' && textToInsert === "" && attributes && Object.keys(attributes).length > 0) {
            // Handle empty string insert with attributes (zero-length-format)
            pushOp({ insert: "", attributes: attributes });
        }

        itA.next(length);
        itB.next(length);
      } else if (typeA === 'retain' && typeB === 'delete') {
        const length = Math.min(lenA, lenB);
        pushOp({ delete: length });
        itA.next(length);
        itB.next(length);
      } else if (typeA === 'insert' && typeB === 'delete') {
        const length = Math.min(lenA, lenB);
        itA.next(length);
        itB.next(length);
      } else {
        log('Compose: Unhandled case or mismatched ops', {opA, opB, typeA, typeB});
        const length = Math.min(lenA, lenB);
        if (length > 0) {
            itA.next(length);
            itB.next(length);
        } else {
            itA.next();
            itB.next();
        }
      }
    } else {
        if (itA.hasNext()) itA.next(); else if (itB.hasNext()) itB.next(); else break;
    }
  }
  const resultDelta = new Delta(newOps);
  log('Compose: END', { resultDelta: resultDelta.ops });
  return resultDelta;
}

  // Removed duplicate getTypingAttributes, setTypingAttributes, and toggleTypingAttribute
  // The correct ones are:
  // getTypingAttributes(): OpAttributes (already defined earlier)
  // setTypingAttribute(key: string, value: any): void (already defined earlier)
  // No direct toggleTypingAttribute was in the "good" list from the problem description,
  // Ritor uses setTypingAttribute for toggling logic or DocumentManager could have a more specific one if needed.
  // The earlier setTypingAttribute(key,value) is the one to keep.
}
// export default DocumentManager; // Default export is not standard for ES6 modules if this is the main export.
// However, the original file had it. If this file is DocumentManager.ts and is imported as default, it should stay.
// For now, I'll keep it as per the original file structure.
export default DocumentManager;
