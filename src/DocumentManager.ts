// src/DocumentManager.ts
import { Delta, Op, OpAttributes, ParagraphBreakMarker } from './Document'; // DocSelection removed
import { DocSelection } from './types'; // DocSelection imported from types
import { DeltaIterator } from './DeltaIterator';
import * as OpUtils from './OpUtils';
import EventEmitter from './EventEmitter';

const DEBUG = true;
function log(...args: any[]) {
  if (DEBUG) {
    console.log('[DocumentManager]', ...args);
  }
}

// OpAttributeComposer is not used by the new getCombinedAttributesForInsert or new compose
// class OpAttributeComposer { ... }


export class DocumentManager extends EventEmitter {
  public currentDocument: Delta;
  private getSelectionFromCursor: () => DocSelection;
  private setSelectionToCursor: (selection: DocSelection) => void;
  private typingAttributes: OpAttributes = {};

  constructor(
    initialDelta?: Delta,
    getSelection?: () => DocSelection,
    setSelection?: (sel: DocSelection) => void
  ) {
    super();
    log('Constructor: initialDelta:', initialDelta, 'getSelection:', typeof getSelection, 'setSelection:', typeof setSelection);

    if (initialDelta instanceof Delta) {
      this.currentDocument = initialDelta;
    } else {
      if (initialDelta !== undefined) {
          log('Constructor: initialDelta was provided but not a Delta instance. Using default.');
      }
      this.currentDocument = new Delta([{ insert: { paragraphBreak: true } as ParagraphBreakMarker }]);
    }

    if (this.currentDocument.ops.length === 0 ||
        !OpUtils.isParagraphBreak(this.currentDocument.ops[this.currentDocument.ops.length - 1])) {
        const opsToAddPBM: Op[] = [];
        if (this.currentDocument.length() > 0) {
            opsToAddPBM.push({ retain: this.currentDocument.length() });
        }
        opsToAddPBM.push({ insert: { paragraphBreak: true } as ParagraphBreakMarker });
        if (this.currentDocument.ops.length === 0) {
            this.currentDocument = new Delta(opsToAddPBM.filter(op => op.insert));
        } else {
             this.currentDocument = this.currentDocument.concat(new Delta(opsToAddPBM));
        }
    }
    log('Constructor: currentDocument finalized:', this.currentDocument.ops);


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

    if (typeof setSelection === 'function') {
      this.setSelectionToCursor = setSelection;
      log('Constructor: Assigned provided setSelection function.');
    } else {
      this.setSelectionToCursor = (sel: DocSelection) => {
        log('setSelectionToCursor (default) called with:', sel);
      };
      log('Constructor: Assigned default setSelection function.');
    }
  }

  getDocument(): Delta {
    return this.currentDocument;
  }

  public compose(deltaA: Delta, deltaB: Delta): Delta {
    log('Compose: START', { deltaA: deltaA.ops, deltaB: deltaB.ops });
    const itA = new DeltaIterator(deltaA.ops); // itA, not iterA
    const itB = new DeltaIterator(deltaB.ops); // itB, not iterB
    const newOps: Op[] = [];

    const pushOp = (op: Op) => {
        if (Object.keys(op).length === 0) return;
        if (op.retain === 0 && !op.attributes && op.delete === undefined && op.insert === undefined) return;

        const lastOp = newOps.length > 0 ? newOps[newOps.length - 1] : null;
        if (lastOp) {
            if (typeof op.delete === 'number' && typeof lastOp.delete === 'number') {
                lastOp.delete += op.delete;
                return;
            }
            if (OpUtils.isTextInsert(lastOp) && OpUtils.isTextInsert(op) &&
                OpUtils.areAttributesSemanticallyEqual(lastOp.attributes, op.attributes)) {
                (lastOp.insert as string) += (op.insert as string);
                return;
            }
            if (typeof lastOp.retain === 'number' && typeof op.retain === 'number' &&
                OpUtils.areAttributesSemanticallyEqual(lastOp.attributes, op.attributes)) {
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
            const lenA = itA.peekLength(); // Current remaining length of opA
            const lenB = itB.peekLength(); // Current remaining length of opB
            // const length = Math.min(lenA, lenB); // This was defined in the prompt's replacement block, defined later here as needed

            if (typeA === 'retain' && typeB === 'retain') {
                const length = Math.min(lenA, lenB); // Specific to this block
                const attributes = OpUtils.composeAttributes(opA.attributes, opB.attributes); // Removed 3rd arg
                const opToPush: Op = { retain: length };
                if (attributes && Object.keys(attributes).length > 0) opToPush.attributes = attributes;
                pushOp(opToPush);
                itA.next(length);
                itB.next(length);
            } else if (typeA === 'insert' && typeB === 'retain') {
                // ---- Start of replacement block from prompt ----
                const opA_attributes = opA ? opA.attributes : undefined;
                const opB_attributes = opB ? opB.attributes : undefined;
                const attributes = OpUtils.composeAttributes(opA_attributes, opB_attributes);

                const current_lenA = opA ? itA.peekLength() : 0;
                const current_lenB = opB ? itB.peekLength() : 0;
                const length = Math.min(current_lenA, current_lenB);

                let opToPush: Op | null = null;

                if (opA && opA.insert !== undefined) {
                    if (typeof opA.insert === 'string') {
                        const segment = opA.insert.substring(itA.currentOffset, itA.currentOffset + length);
                        if (segment.length > 0) {
                            opToPush = { insert: segment, attributes: attributes };
                        } else if (length > 0 && attributes && Object.keys(attributes).length > 0) {
                            opToPush = { retain: length, attributes: attributes };
                        }
                    } else {
                        if (length === 1) {
                            if (OpUtils.isParagraphBreak(opA)) {
                                const pbmInsert: ParagraphBreakMarker = { paragraphBreak: true };
                                opToPush = { insert: pbmInsert, attributes: attributes };
                            } else {
                                const embedInsert: Record<string, any> = { ...(opA.insert as Record<string, any>) };
                                opToPush = { insert: embedInsert, attributes: attributes };
                            }
                        } else {
                            log('Compose: Object insert from deltaA cannot be segmented for current processing length.', { insert: opA.insert, length });
                            if (length > 0 && attributes && Object.keys(attributes).length > 0) {
                                opToPush = { retain: length, attributes: attributes };
                            }
                        }
                    }
                } else if (opA === null && opB && typeB === 'retain') {
                    if (length > 0 ) {
                         opToPush = { retain: length, attributes: attributes };
                    }
                } else if (length > 0 && attributes && Object.keys(attributes).length > 0) {
                    opToPush = { retain: length, attributes: attributes };
                }

                if (opToPush) {
                    pushOp(opToPush);
                }
                // ---- End of replacement block ----
                itA.next(length); // These were outside the replacement block in the prompt,
                itB.next(length); // but must be part of the insert/retain branch.
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
                log('Compose: Unhandled case or mismatched ops', {opA_type: typeA, opB_type: typeB, opA, opB});
                const length = Math.min(lenA, lenB);
                if (length > 0) {
                    itA.next(length);
                    itB.next(length);
                } else {
                    if(itA.hasNext()) itA.next();
                    if(itB.hasNext()) itB.next();
                }
            }
        } else {
            log('Compose: Loop anomaly, one or both ops are null despite hasNext.', {opA, opB, hasA: itA.hasNext(), hasB: itB.hasNext()});
            if (itA.hasNext() && !opA) itA.next();
            else if (itB.hasNext() && !opB) itB.next();
            else if (!itA.hasNext() && !itB.hasNext()) break;
            else { itA.hasNext() ? itA.next() : itB.next(); }
        }
    }
    const resultDelta = new Delta(newOps);
    log('Compose: END', { resultDelta: resultDelta.ops });
    return resultDelta;
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

    const effectiveIndex = (length === 0 && index > 0) ? index - 1 : index;
    const effectiveLength = length === 0 ? 1 : length;

    while(iterator.hasNext()) {
        const op = iterator.peek();
        if (!op) { iterator.next(); continue; }

        const opLength = iterator.peekLength();
        if (opLength === 0 && !op.attributes) {
            iterator.next();
            continue;
        }

        const opStart = currentPosition;
        const opEnd = currentPosition + opLength;

        const queryStart = effectiveIndex;
        const queryEnd = effectiveIndex + effectiveLength;

        const overlaps = opStart < queryEnd && opEnd > queryStart;

        if (overlaps && op.attributes) {
            Object.assign(resultAttrs, op.attributes);
        }

        currentPosition += opLength;
        iterator.next();

        if (length > 0 && currentPosition >= queryEnd) {
        }
        if (length === 0 && opEnd > effectiveIndex && Object.keys(resultAttrs).length > 0) {
        }
    }
    log('Exiting getFormatAt', { resultAttrs });
    return resultAttrs;
  }

  setTypingAttribute(key: string, value: any): void {
    log('Entering setTypingAttribute', { key, value });
    if (value === null || value === undefined) { delete this.typingAttributes[key]; }
    else { this.typingAttributes[key] = value; }
    log('setTypingAttribute: typingAttributes changed', this.typingAttributes);
    this.emit('typingattributes:change', { ...this.typingAttributes });
  }

  getTypingAttributes(): OpAttributes { return { ...this.typingAttributes }; }

  private getCombinedAttributesForInsert(selection: DocSelection): OpAttributes | undefined {
    log('Entering getCombinedAttributesForInsert', { selection });
    const formatAtCursor = this.getFormatAt(selection.index, 0);
    let combinedAttributes: OpAttributes = { ...formatAtCursor };

    if (selection.length === 0) { // Only apply typing attributes for collapsed selections
        const typingAttrs = this.getTypingAttributes();
        // Manual merge: typingAttrs override formatAtCursor
        for (const key in typingAttrs) {
            if (Object.prototype.hasOwnProperty.call(typingAttrs, key)) {
                if (typingAttrs[key] === null) { // null from typingAttrs means unset
                    delete combinedAttributes[key];
                } else if (typingAttrs[key] !== undefined) {
                    combinedAttributes[key] = typingAttrs[key];
                }
            }
        }
    }

    // Clean up any attributes that ended up as null from the initial formatAtCursor or merge.
    for (const key in combinedAttributes) {
        if (Object.prototype.hasOwnProperty.call(combinedAttributes, key) && combinedAttributes[key] === null) {
            delete combinedAttributes[key];
        }
    }

    const finalAttrs = Object.keys(combinedAttributes).length > 0 ? combinedAttributes : undefined;
    log('Exiting getCombinedAttributesForInsert', { finalAttrs });
    return finalAttrs;
  }

  insertText(text: string, selection?: DocSelection): void {
    log('Entering insertText', { text, selection });
    if (!text) { log('insertText: No text to insert, exiting'); return; }
    const currentSelection = selection || this.getSelectionFromCursor();
    log('insertText: currentSelection', currentSelection);
    let currentIndex = currentSelection.index;
    const ops: Op[] = [];
    if (currentIndex > 0) { ops.push({ retain: currentIndex }); }

    const attributesToApply = this.getCombinedAttributesForInsert(currentSelection);
    log('insertText: Attributes to apply for new text', attributesToApply);

    if (currentSelection.length > 0) { ops.push({ delete: currentSelection.length }); }

    let opAtCursor: Op | null = null;
    if (currentSelection.length === 0) {
        const iterator = new DeltaIterator(this.currentDocument.ops);
        let currentIterIndex = 0;
        while(iterator.hasNext()) {
            const opPeeked = iterator.peek();
            if (!opPeeked) { iterator.next(); continue; }
            const opLength = iterator.peekLength();

            if (currentIterIndex <= currentIndex && currentIndex < currentIterIndex + opLength) {
                if (iterator.currentOffset === 0 && currentIndex === currentIterIndex) {
                     opAtCursor = opPeeked;
                }
                break;
            }
            currentIterIndex += opLength;
            iterator.next();
            if (currentIterIndex > currentIndex && opLength > 0) break;
        }
        log('insertText: Op at cursor (collapsed selection)', { opAtCursor, currentIndex, currentIterIndex });
    }

    if (currentSelection.length === 0 && opAtCursor && OpUtils.isParagraphBreak(opAtCursor)) {
      log('insertText: Typing at a ParagraphBreakMarker. Deleting PBM, inserting text, then re-inserting PBM.');
      ops.push({ delete: 1 });
      ops.push({ insert: text, attributes: attributesToApply });
      ops.push({ insert: { paragraphBreak: true } as ParagraphBreakMarker, attributes: undefined });
    } else {
      ops.push({ insert: text, attributes: attributesToApply });
    }
    const finalChangeDelta = new Delta(ops);
    log('insertText: finalChangeDelta BEFORE compose', finalChangeDelta.ops);
    this.currentDocument = this.compose(this.currentDocument, finalChangeDelta);
    log('insertText: currentDocument AFTER compose', this.currentDocument.ops);
    this.emit('document:change', { change: finalChangeDelta, newDocument: this.currentDocument });
    const newCursorIndex = currentIndex + text.length;
    this.setSelectionToCursor({ index: newCursorIndex, length: 0 });
    log('Exiting insertText');
  }

  deleteText(lengthOrDirection: number | 'forward' | 'backward', selection?: DocSelection): void {
    log('Entering deleteText', { lengthOrDirection, selection });
    const currentSelection = selection || this.getSelectionFromCursor();
    let finalCursorIndex = currentSelection.index;
    const changeOps: Op[] = [];
    if (currentSelection.length > 0) {
        if (currentSelection.index > 0) { changeOps.push({ retain: currentSelection.index }); }
        changeOps.push({ delete: currentSelection.length });
    } else {
        if (lengthOrDirection === 'backward') {
            if (currentSelection.index === 0) { log('deleteText: At BoD. Exiting.'); return; }
            if (currentSelection.index -1 > 0) { changeOps.push({ retain: currentSelection.index - 1 }); }
            changeOps.push({ delete: 1 });
            finalCursorIndex = currentSelection.index - 1;
        } else if (lengthOrDirection === 'forward') {
            const docLength = this.currentDocument.length();
            if (currentSelection.index === docLength) { log('deleteText: At EoD. Exiting.'); return; }
            if (currentSelection.index > 0) {changeOps.push({ retain: currentSelection.index });}
            changeOps.push({ delete: 1 });
        } else if (typeof lengthOrDirection === 'number' && lengthOrDirection > 0) {
            if (currentSelection.index > 0) {changeOps.push({ retain: currentSelection.index });}
            changeOps.push({ delete: lengthOrDirection });
        } else { log('deleteText: Invalid args. Exiting.'); return; }
    }
    const changeDelta = new Delta(changeOps);
    log('deleteText: changeDelta BEFORE compose', changeDelta.ops);
    let composedDoc = this.compose(this.currentDocument, changeDelta);
    log('deleteText: currentDocument AFTER compose (intermediate)', composedDoc.ops);
    if (composedDoc.ops.length === 0) {
        composedDoc = new Delta([{ insert: { paragraphBreak: true } as ParagraphBreakMarker }]);
    } else {
        const lastOp = composedDoc.ops[composedDoc.ops.length - 1];
        if (!OpUtils.isParagraphBreak(lastOp)) {
            const addPbmOps: Op[] = [];
            if (composedDoc.length() > 0) addPbmOps.push({retain: composedDoc.length()});
            addPbmOps.push({insert: { paragraphBreak: true } as ParagraphBreakMarker, attributes: undefined });
            composedDoc = this.compose(composedDoc, new Delta(addPbmOps));
        }
    }
    this.currentDocument = composedDoc;
    this.emit('document:change', { change: changeDelta, newDocument: this.currentDocument });
    this.setSelectionToCursor({ index: finalCursorIndex, length: 0 });
    log('Exiting deleteText');
  }

  insertBlockBreak(selection?: DocSelection): void {
    log('Entering insertBlockBreak', { selection });
    const currentSelection = selection || this.getSelectionFromCursor();
    const ops: Op[] = [];
    if (currentSelection.index > 0) { ops.push({ retain: currentSelection.index }); }
    if (currentSelection.length > 0) { ops.push({ delete: currentSelection.length }); }
    ops.push({ insert: { paragraphBreak: true } as ParagraphBreakMarker, attributes: undefined });
    const changeDelta = new Delta(ops);
    this.currentDocument = this.compose(this.currentDocument, changeDelta);
    this.emit('document:change', { change: changeDelta, newDocument: this.currentDocument });
    this.typingAttributes = {};
    this.emit('typingattributes:change', { ...this.typingAttributes });
    this.setSelectionToCursor({ index: currentSelection.index + 1, length: 0 });
    log('Exiting insertBlockBreak');
  }

  formatText(key: string, value: any, selection?: DocSelection): void {
    log('Entering formatText', { key, value, selection });
    const currentSelection = selection || this.getSelectionFromCursor();
    if (currentSelection.length === 0) { this.setTypingAttribute(key, value); return; }
    const attributesToApply: OpAttributes = { [key]: (value === null || value === undefined) ? null : value };
    const ops: Op[] = [];
    if (currentSelection.index > 0) { ops.push({ retain: currentSelection.index }); }
    ops.push({ retain: currentSelection.length, attributes: attributesToApply });
    const docLen = this.currentDocument.length();
    const endOfSelection = currentSelection.index + currentSelection.length;
    if (endOfSelection < docLen) {
        ops.push({ retain: docLen - endOfSelection });
    }

    const changeDelta = new Delta(ops);
    this.currentDocument = this.compose(this.currentDocument, changeDelta);
    this.emit('document:change', { change: changeDelta, newDocument: this.currentDocument });
    this.setSelectionToCursor(currentSelection);
    log('Exiting formatText');
  }
}
