// src/DocumentManager.ts
import Ritor from './Ritor';
import { Document, Delta, Op, OpAttributes, ParagraphBreakMarker } from './Document';
import { DocSelection } from './types';
import { DeltaIterator } from './DeltaIterator';
import * as OpUtils from './OpUtils';
import { EventEmitter } from './EventEmitter';

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
    ritorOrInitialContent?: Ritor | Delta, // First arg can be Ritor or Delta for backward compatibility or testing
    initialContentOrGetSelection?: Delta | (() => DocSelection),
    getSelectionOrSetSelection?: (() => DocSelection) | ((sel: DocSelection) => void),
    setSelection?: (sel: DocSelection) => void
  ) {
    super();

    let initialContent: Delta | undefined;

    // Adapt for Ritor instance if provided (though Ritor itself is not stored or used directly anymore beyond emit)
    // For this refactor, we assume Ritor instance is not stored, and emit is via super()
    if (ritorOrInitialContent instanceof Delta) {
        initialContent = ritorOrInitialContent;
        this.getSelectionFromCursor = initialContentOrGetSelection as (() => DocSelection) || (() => {
            log('getSelectionFromCursor (default) called'); return { index: 0, length: 0 };
        });
        this.setSelectionToCursor = getSelectionOrSetSelection as ((sel: DocSelection) => void) || ((sel) => {
            log('setSelectionToCursor (default) called with:', sel);
        });
    } else { // Assuming first arg is Ritor (though not used), second is initialContent
        initialContent = initialContentOrGetSelection as Delta | undefined;
        this.getSelectionFromCursor = getSelectionOrSetSelection as (() => DocSelection) || (() => {
            log('getSelectionFromCursor (default) called'); return { index: 0, length: 0 };
        });
        this.setSelectionToCursor = setSelection || ((sel) => {
            log('setSelectionToCursor (default) called with:', sel);
        });
    }

    log('Constructor: initialContent:', initialContent ? initialContent.ops : undefined);
    this.currentDocument = initialContent || new Delta([{ insert: { paragraphBreak: true } as ParagraphBreakMarker }]);
    if (this.currentDocument.ops.length === 0 || !OpUtils.isParagraphBreak(this.currentDocument.ops[this.currentDocument.ops.length -1])) {
        // Ensure document always ends with a PBM if not empty
        this.currentDocument = this.currentDocument.insert({ paragraphBreak: true } as ParagraphBreakMarker);
    }
    log('Constructor: currentDocument initialized:', this.currentDocument.ops);
  }

  public emit(event: string, ...data: any[]): void {
      super.emit(event, ...data);
  }

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
    let lengthToDelete = currentSelection.length;

    let finalChangeDelta = new Delta();
    if (currentIndex > 0) {
        finalChangeDelta = finalChangeDelta.retain(currentIndex);
    }

    const attributesToApply = this.getCombinedAttributesForInsert(currentSelection);
    log('insertText: Attributes to apply for new text', attributesToApply);

    if (currentSelection.length === 0) {
        const opData = this._getOpAtIndex(this.currentDocument, currentIndex);
        if (opData.op && OpUtils.isParagraphBreak(opData.op) && opData.opOffset === 0) {
            log('insertText: Typing at a ParagraphBreakMarker. Deleting PBM.');
            lengthToDelete = 1; // Delete the PBM
        }
    }

    if (lengthToDelete > 0) {
      finalChangeDelta = finalChangeDelta.delete(lengthToDelete);
      log('insertText: Deleting selected/PBM text, intermediate change', finalChangeDelta.ops);
    }

    finalChangeDelta = finalChangeDelta.insert(text, attributesToApply);
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
    let change = new Delta();
    let finalCursorIndex = currentSelection.index;

    if (currentSelection.length > 0) {
        if (currentSelection.index > 0) change = change.retain(currentSelection.index);
        change = change.delete(currentSelection.length);
        finalCursorIndex = currentSelection.index;
    } else {
        if (lengthOrDirection === 'backward') {
            if (currentSelection.index === 0) { log('deleteText: At BoD. Exiting.'); return; }
            change = change.retain(currentSelection.index - 1).delete(1);
            finalCursorIndex = currentSelection.index - 1;
        } else if (lengthOrDirection === 'forward') {
            const docLength = this.currentDocument.length();
            if (currentSelection.index === docLength) { log('deleteText: At EoD. Exiting.'); return; }
            if (currentSelection.index > 0) change = change.retain(currentSelection.index);
            change = change.delete(1);
            finalCursorIndex = currentSelection.index;
        } else if (typeof lengthOrDirection === 'number' && lengthOrDirection > 0) {
            const docLength = this.currentDocument.length();
            const delLength = Math.min(lengthOrDirection, docLength - currentSelection.index);
            if (delLength <= 0) { log('deleteText: Calculated delLength <=0. Exiting.'); return; }
            if (currentSelection.index > 0) change = change.retain(currentSelection.index);
            change = change.delete(delLength);
            finalCursorIndex = currentSelection.index;
        } else {
            log('deleteText: Invalid args. Exiting.'); return;
        }
    }

    log('deleteText: changeDelta', change.ops);
    log('deleteText: currentDocument BEFORE compose', this.currentDocument.ops);

    let composedDoc = this.compose(this.currentDocument, change);
    log('deleteText: currentDocument AFTER compose (intermediate)', composedDoc.ops);

    if (composedDoc.ops.length === 0) {
        log('deleteText: Document became empty. Resetting to a single PBM.');
        composedDoc = new Delta([{ insert: { paragraphBreak: true } as ParagraphBreakMarker }]);
    } else {
        const lastOp = composedDoc.ops[composedDoc.ops.length - 1];
        if (!OpUtils.isParagraphBreak(lastOp)) {
            log('deleteText: Document does not end with PBM. Appending one.');
            const addPbmDelta = new Delta().retain(composedDoc.length()).insert({ paragraphBreak: true } as ParagraphBreakMarker, undefined);
            composedDoc = this.compose(composedDoc, addPbmDelta);
        }
    }

    this.currentDocument = composedDoc;
    log('deleteText: currentDocument FINAL', this.currentDocument.ops);

    this.emit('document:change', { change, newDocument: this.currentDocument });
    log('deleteText: Setting new cursor selection', { index: finalCursorIndex, length: 0 });
    this.setSelectionToCursor({ index: finalCursorIndex, length: 0 });
    log('Exiting deleteText');
  }

  insertBlockBreak(selection?: DocSelection): void {
    log('Entering insertBlockBreak', { selection });
    const currentSelection = selection || this.getSelectionFromCursor();
    log('insertBlockBreak: currentSelection', currentSelection);
    let change = new Delta();
    const PBMOp: Op = { insert: { paragraphBreak: true } as ParagraphBreakMarker };

    if (currentSelection.index > 0) {
        change = change.retain(currentSelection.index);
    }
    if (currentSelection.length > 0) {
      change = change.delete(currentSelection.length);
    }

    change = change.insert(PBMOp, undefined);

    log('insertBlockBreak: changeDelta BEFORE compose', change.ops);
    log('insertBlockBreak: currentDocument BEFORE compose', this.currentDocument.ops);

    this.currentDocument = this.compose(this.currentDocument, change);

    log('insertBlockBreak: currentDocument AFTER compose', this.currentDocument.ops);
    this.emit('document:change', { change, newDocument: this.currentDocument });

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

    let change = new Delta();
    if (currentSelection.index > 0) {
        change = change.retain(currentSelection.index);
    }
    change = change.retain(currentSelection.length, attributesToApply);

    log('formatText: changeDelta BEFORE compose', change.ops);
    log('formatText: currentDocument BEFORE compose', this.currentDocument.ops);

    this.currentDocument = this.compose(this.currentDocument, change);

    log('formatText: currentDocument AFTER compose', this.currentDocument.ops);
    this.emit('document:change', { change, newDocument: this.currentDocument });
    log('formatText: Setting new cursor selection (no change)', currentSelection);
    this.setSelectionToCursor(currentSelection);
    log('Exiting formatText');
  }

  public compose(deltaA: Delta, deltaB: Delta): Delta {
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
                if (newInsertStr === '\n' && !lastInsertStr.endsWith('\n')) { resultOps.push(newOp); }
                else if (lastInsertStr.endsWith('\n') && newInsertStr !== '\n' && newInsertStr !== "") { resultOps.push(newOp); }
                else { (lastOp.insert as string) += newInsertStr;}
            }
        } else { resultOps.push(newOp); }
    };
    while (iterA.hasNext() || iterB.hasNext()) {
        const opA = iterA.peek(); const opB = iterB.peek();
        const typeA = iterA.peekType(); const typeB = iterB.peekType();
        if (typeB === 'insert') { pushOp(iterB.next()); }
        else if (typeA === 'delete') { pushOp(iterA.next()); }
        else if (typeB === 'delete') {
            const bOpDelete = iterB.next();
            if (bOpDelete && bOpDelete.delete) {
                let length = bOpDelete.delete;
                while (length > 0 && iterA.hasNext()) {
                    const nextA = iterA.peek(); if (!nextA) break;
                    const nextALength = OpUtils.getOpLength(nextA); const consumeLength = Math.min(length, nextALength);
                    if ((nextA.retain || nextA.insert) && consumeLength > 0) { iterA.next(consumeLength); }
                    else if (consumeLength === 0 && nextALength === 0) { iterA.next(); continue; }
                    else { if(typeA === 'delete') { pushOp(iterA.next()); } else { if (nextALength > 0) iterA.next(consumeLength); else iterA.next();}}
                    length -= consumeLength;
                }
            }
        }
        else if (typeA === 'retain' && typeB === 'retain') {
            if (!opA || !opB || typeof opA.retain !== 'number' || typeof opB.retain !== 'number') { if (iterA.hasNext()) iterA.next(); else if (iterB.hasNext()) iterB.next(); else break; continue; }
            const attributes = OpAttributeComposer.compose(opA.attributes, opB.attributes, true);
            const length = Math.min(opA.retain, opB.retain);
            if (length > 0) pushOp({ retain: length, attributes });
            iterA.next(length); iterB.next(length);
        }
        else if (typeA === 'insert' && typeB === 'retain') {
            if (!opA || !opB || opA.insert === undefined || typeof opB.retain !== 'number') { if (iterA.hasNext()) iterA.next(); else if (iterB.hasNext()) iterB.next(); else break; continue; }
            const newAttributes = OpAttributeComposer.compose(opA.attributes, opB.attributes, true);
            const length = Math.min(OpUtils.getOpLength(opA), opB.retain);
            if (length > 0) { const opAWithValue = iterA.next(length); if (opAWithValue && opAWithValue.insert !== undefined) pushOp({ insert: opAWithValue.insert, attributes: newAttributes });}
            iterB.next(length);
        }
        else if (opA) { pushOp(iterA.next()); }
        else if (opB) { pushOp(iterB.next()); }
        else { break; }
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
                if (currentInsertStr === '\n' && !lastMergedInsertStr.endsWith('\n')) { mergedFinalOps.push(currentOp); }
                else if (lastMergedInsertStr.endsWith('\n') && currentInsertStr !== '\n' && currentInsertStr !== "") { mergedFinalOps.push(currentOp); }
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

  public getTypingAttributes(): OpAttributesType {
    return { ...this.typingAttributes };
  }

  public setTypingAttributes(attrs: OpAttributesType): void {
    log('Entering setTypingAttributes', { attrs });
    this.typingAttributes = attrs ? { ...attrs } : {};
    log('setTypingAttributes: typingAttributes changed', this.typingAttributes);
    this.emit('typingattributes:change', this.getTypingAttributes());
  }

  public toggleTypingAttribute(formatKey: string, explicitValue?: boolean | null): void {
    log('Entering toggleTypingAttribute', { formatKey, explicitValue });
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
    log('toggleTypingAttribute: typingAttributes changed', this.typingAttributes);
    this.emit('typingattributes:change', this.getTypingAttributes());
  }
}
export default DocumentManager;
