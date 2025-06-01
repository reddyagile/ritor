// src/RitorVDOM.ts
import { Schema } from './schema.js';
import { DocNode, BaseNode, TextNode, InlineNode, Mark } from './documentModel.js';
import { DomPatcher } from './domPatcher.js';
import { modelPositionToFlatOffset, flatOffsetToModelPosition, normalizeInlineArray, nodeAtPath, findTextNodesInRange } from './modelUtils.js'; // Added findTextNodesInRange
import { ModelPosition, ModelSelection } from './selection.js';
import { UndoManager } from './undoManager.js';
import { basicNodeSpecs, basicMarkSpecs } from './basicSchema.js';
import { DOMParser as RitorDOMParser } from './domParser.js';
import { Transaction } from './transform/transaction.js';
import { Slice } from './transform/slice.js'; // Slice might not be needed directly here anymore
import { MarkType, Attrs } from './schema.js';


interface SimpleChange {
  type: 'insertText' | 'deleteContentBackward' | 'deleteContentForward' | 'insertParagraph' | 'paste' | 'undo' | 'redo';
  text?: string;
  character?: string;
  dataTransfer?: DataTransfer | null;
}


export class RitorVDOM {
  public currentViewDoc: DocNode;
  private domPatcher: DomPatcher;
  private targetElement: HTMLElement;
  private currentModelSelection: ModelSelection | null = null;
  private lastViewModelSelection: ModelSelection | null = null;
  private isComposing: boolean = false;
  public undoManager: UndoManager;
  public readonly schema: Schema;
  private domParser: RitorDOMParser;
  private mutationObserver: MutationObserver;
  private isProcessingMutations: boolean = false;


  constructor(targetElement: HTMLElement, initialDoc?: DocNode, schema?: Schema) {
    this.targetElement = targetElement;
    this.schema = schema || new Schema({ nodes: basicNodeSpecs, marks: basicMarkSpecs });
    this.domParser = new RitorDOMParser(this.schema);

    if (initialDoc) {
      this.currentViewDoc = initialDoc;
    } else {
      const p = this.schema.node(this.schema.nodes.paragraph, {}, [this.schema.text('')]);
      this.currentViewDoc = this.schema.node(this.schema.nodes.doc, {}, [p]) as DocNode;
    }

    this.domPatcher = new DomPatcher(this.targetElement, this.schema);
    this.undoManager = new UndoManager();
    this.undoManager.add(this.currentViewDoc);

    this.domPatcher.patch(this.currentViewDoc);
    this.setupEventHandlers();

    this.mutationObserver = new MutationObserver(this.handleMutations.bind(this));
    this.mutationObserver.observe(this.targetElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });

    this.ensureInitialSelection();
    this.setFocus();
  }

  private ensureInitialSelection() {
    if (!this.currentModelSelection) {
        const firstTextNodeInfo = this.findFirstTextNodePath(this.currentViewDoc);
        if (firstTextNodeInfo) {
            this.currentModelSelection = {
                anchor: { path: firstTextNodeInfo.path, offset: 0 },
                head: { path: firstTextNodeInfo.path, offset: 0 }
            };
        } else {
            this.currentModelSelection = { anchor: { path: [], offset: 0 }, head: { path: [], offset: 0 } };
        }
        this.applyModelSelectionToDom(this.currentModelSelection);
    }
  }

  private findFirstTextNodePath(node: BaseNode, currentPath: number[] = []): { path: number[], node: TextNode } | null {
    if (node.isText && !node.isLeaf) {
        return { path: currentPath, node: node as TextNode };
    }
    if (node.content) {
        for (let i = 0; i < node.content.length; i++) {
            const child = node.content[i];
            const result = this.findFirstTextNodePath(child, [...currentPath, i]);
            if (result) return result;
        }
    }
    return null;
  }

  private setupEventHandlers(): void {
    this.targetElement.addEventListener('beforeinput', this.handleBeforeInput.bind(this) as EventListener);
    this.targetElement.addEventListener('compositionstart', () => this.isComposing = true);
    this.targetElement.addEventListener('compositionend', () => this.isComposing = false);
    document.addEventListener('selectionchange', this.handleSelectionChange.bind(this));
    this.targetElement.addEventListener('focus', this.handleFocus.bind(this));
    this.targetElement.addEventListener('keydown', this.handleKeyDown.bind(this));
  }

  private handleFocus(): void { this.updateModelSelectionState(); }
  private handleSelectionChange(): void { if (document.activeElement === this.targetElement) this.updateModelSelectionState(); }

  private updateModelSelectionState(): void {
    if (this.isProcessingMutations) return;
    const domSelection = window.getSelection();
    if (domSelection && domSelection.rangeCount > 0) {
      const range = domSelection.getRangeAt(0);
      const newModelSelection = this.domToModelSelection(range);
      if (newModelSelection && (!this.currentModelSelection || !this.areSelectionsEqual(this.currentModelSelection, newModelSelection))) {
        this.currentModelSelection = newModelSelection;
      }
    }
  }

  public domToModelSelection(range: Range): ModelSelection | null {
    const anchorPos = this.domToModelPosition(range.startContainer, range.startOffset);
    const headPos = this.domToModelPosition(range.endContainer, range.endOffset);
    if (anchorPos && headPos) return { anchor: anchorPos, head: headPos };
    return null;
  }

  public domToModelPosition(domNode: Node, domOffset: number): ModelPosition | null {
    // ... (domToModelPosition implementation - keeping existing PoC version) ...
    const path: number[] = []; let currentDomNode: Node | null = domNode; let charOffsetInText = 0;
    if (currentDomNode.nodeType === Node.TEXT_NODE) { charOffsetInText = domOffset; currentDomNode = currentDomNode.parentNode; if (!currentDomNode) return null;}
    while (currentDomNode && currentDomNode !== this.targetElement) { const parent = currentDomNode.parentNode; if (!parent) return null; const index = Array.from(parent.childNodes).indexOf(currentDomNode as ChildNode); path.unshift(index); currentDomNode = parent;}
    if (!currentDomNode) return null; let modelNode: BaseNode | undefined = this.currentViewDoc; let finalPath = [];
    for (let i = 0; i < path.length; i++) { const domChildIndex = path[i]; if (!modelNode || !modelNode.content || domChildIndex >= modelNode.content.length) return null; const modelChildNode = modelNode.content[domChildIndex]; finalPath.push(domChildIndex); modelNode = modelChildNode; }
    if (!modelNode) return null; if (modelNode.isText && !modelNode.isLeaf) return { path: finalPath, offset: charOffsetInText }; if (!modelNode.isLeaf && modelNode.content) { if (domNode.nodeType === Node.ELEMENT_NODE) return { path: finalPath, offset: domOffset }; return { path: finalPath, offset: 0 }; } if (modelNode.isLeaf) return { path: finalPath, offset: 0 }; return null;
  }

  public modelToDomPosition(modelPos: ModelPosition): { node: Node, offset: number } | null {
    // ... (modelToDomPosition implementation - keeping existing PoC version) ...
    let nM: BaseNode = this.currentViewDoc; let dN: Node = this.targetElement;
    for (let i = 0; i < modelPos.path.length; i++) { const idx = modelPos.path[i]; if (!nM.content || idx >= nM.content.length) return null; nM = nM.content[idx]; let dC: Node | null = null; if (nM.attrs?.id) { dC = this.targetElement.querySelector(`[id="${nM.attrs.id}"]`); if (dC) dN = dC; else return null; } else if (dN.childNodes.length > idx) { dN = dN.childNodes[idx]; } else return null; }
    if (nM.isText && !nM.isLeaf) { let tC: Node | null = null; for(let i=0; i < dN.childNodes.length; i++) { if (dN.childNodes[i].nodeType === Node.TEXT_NODE) { tC = dN.childNodes[i]; break; }} if (tC) return { node: tC, offset: modelPos.offset }; return { node: dN, offset: 0 }; }
    if (!nM.isLeaf && nM.content) { if (dN.childNodes.length >= modelPos.offset) return { node: dN, offset: modelPos.offset }; return { node: dN, offset: dN.childNodes.length }; }
    if (nM.isLeaf) return { node: dN, offset: modelPos.offset > 0 ? 1: 0 }; return null;
  }

  public applyModelSelectionToDom(modelSelection: ModelSelection | null): void {
    if (!modelSelection) return; const anchorDomPos = this.modelToDomPosition(modelSelection.anchor); const headDomPos = this.modelToDomPosition(modelSelection.head);
    if (anchorDomPos && headDomPos) { const domSelection = window.getSelection(); if (domSelection) { this.lastViewModelSelection = modelSelection; const newRange = document.createRange(); newRange.setStart(anchorDomPos.node, anchorDomPos.offset); newRange.setEnd(headDomPos.node, headDomPos.offset); if (document.activeElement === this.targetElement) { domSelection.removeAllRanges(); domSelection.addRange(newRange);}}}
  }

  private areSelectionsEqual(sel1: ModelSelection, sel2: ModelSelection): boolean {
    if (!sel1 || !sel2) return sel1 === sel2; return this.arePositionsEqual(sel1.anchor, sel2.anchor) && this.arePositionsEqual(sel1.head, sel2.head);
  }
  private arePositionsEqual(pos1: ModelPosition, pos2: ModelPosition): boolean {
    if (!pos1 || !pos2) return pos1 === pos2; if (pos1.offset !== pos2.offset) return false; if (pos1.path.length !== pos2.path.length) return false; for (let i = 0; i < pos1.path.length; i++) if (pos1.path[i] !== pos2.path[i]) return false; return true;
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key === 'z') { event.preventDefault(); this.undo(); }
    else if ((event.metaKey || event.ctrlKey) && (event.key === 'y' || (event.shiftKey && event.key === 'Z'))) { event.preventDefault(); this.redo(); }
    else if ((event.metaKey || event.ctrlKey) && event.key === 'b') { event.preventDefault(); this.toggleMark('bold'); }
    else if ((event.metaKey || event.ctrlKey) && event.key === 'i') { event.preventDefault(); this.toggleMark('italic'); }
    else if ((event.metaKey || event.ctrlKey) && event.key === 's' && event.shiftKey) { event.preventDefault(); this.toggleMark(this.schema.marks.strikethrough); } // Pass MarkType
  }

  private handleBeforeInput(event: InputEvent): void {
    if (this.isComposing) return; const changeType = event.inputType; let changeToApply: SimpleChange | null = null;
    switch (changeType) {
      case 'insertText': changeToApply = { type: changeType, text: event.data || undefined }; break;
      case 'deleteContentBackward': case 'deleteContentForward': case 'insertParagraph': changeToApply = { type: changeType }; break;
      case 'formatBold': this.toggleMark(this.schema.marks.bold); return;
      case 'formatItalic': this.toggleMark(this.schema.marks.italic); return;
      case 'formatStrikeThrough': this.toggleMark(this.schema.marks.strikethrough); return;
      case 'insertFromPaste': changeToApply = { type: changeType, dataTransfer: event.dataTransfer }; break;
      default: console.log('Unhandled beforeinput type by RitorVDOM, allowing native:', event.inputType); return;
    }
    event.preventDefault(); if (changeToApply) this.applyChange(changeToApply);
  }

  private applyChange(change: SimpleChange): void {
    if (!this.currentModelSelection) return;
    const tr = new Transaction(this.currentViewDoc, this.currentModelSelection);
    const flatAnchor = modelPositionToFlatOffset(this.currentViewDoc, this.currentModelSelection.anchor, this.schema);
    const flatHead = this.arePositionsEqual(this.currentModelSelection.anchor, this.currentModelSelection.head) ? flatAnchor : modelPositionToFlatOffset(this.currentViewDoc, this.currentModelSelection.head, this.schema);
    const from = Math.min(flatAnchor, flatHead); const to = Math.max(flatAnchor, flatHead);
    let newSelectionAnchorPos: ModelPosition | null = null; let newSelectionHeadPos: ModelPosition | null = null;

    switch (change.type) {
      case 'insertText': if (change.text) { const marks = this.getMarksAtPosition(this.currentViewDoc, this.currentModelSelection.anchor); const textNode = this.schema.text(change.text, marks); tr.replace(from, to, Slice.fromFragment([textNode])); const newFlatPos = from + textNode.text.length; newSelectionAnchorPos = newSelectionHeadPos = flatOffsetToModelPosition(tr.doc, newFlatPos, this.schema); } break;
      case 'deleteContentBackward': if (from === to && from > 0) { tr.delete(from -1, from); newSelectionAnchorPos = newSelectionHeadPos = flatOffsetToModelPosition(tr.doc, from -1, this.schema); } else if (from < to) { tr.delete(from, to); newSelectionAnchorPos = newSelectionHeadPos = flatOffsetToModelPosition(tr.doc, from, this.schema); } break;
      case 'insertParagraph': const newPara = this.schema.node(this.schema.nodes.paragraph, {}, [this.schema.text('')]); tr.replace(from, to, Slice.fromFragment([newPara])); const newParaStartFlatPos = from + 1; newSelectionAnchorPos = newSelectionHeadPos = flatOffsetToModelPosition(tr.doc, newParaStartFlatPos, this.schema); break;
      case 'paste': if (change.dataTransfer) { const pastedText = change.dataTransfer.getData('text/plain'); if (pastedText) { const marks = this.getMarksAtPosition(this.currentViewDoc, this.currentModelSelection.anchor); const textNode = this.schema.text(pastedText, marks); tr.replace(from, to, Slice.fromFragment([textNode])); const newFlatPastePos = from + textNode.text.length; newSelectionAnchorPos = newSelectionHeadPos = flatOffsetToModelPosition(tr.doc, newFlatPastePos, this.schema); }} break;
      default: return;
    }
    if (newSelectionAnchorPos && newSelectionHeadPos) tr.setSelection({ anchor: newSelectionAnchorPos, head: newSelectionHeadPos });
    if (tr.stepsApplied) { this.undoManager.add(this.currentViewDoc); this.updateDocument(tr); }
  }

  public updateDocument(trOrDoc: Transaction | DocNode): void {
    this.isProcessingMutations = true; let selectionToApply: ModelSelection | null = null;
    if (trOrDoc instanceof Transaction) { this.currentViewDoc = trOrDoc.doc; selectionToApply = trOrDoc.selection;}
    else { this.currentViewDoc = trOrDoc; if (this.currentModelSelection) { const dS = window.getSelection(); if (dS && dS.rangeCount > 0) selectionToApply = this.domToModelSelection(dS.getRangeAt(0)); if (!selectionToApply) { const fTI = this.findFirstTextNodePath(this.currentViewDoc); selectionToApply = fTI ? {anchor:{path:fTI.path,offset:0},head:{path:fTI.path,offset:0}}:{anchor:{path:[],offset:0},head:{path:[],offset:0}};}}}
    this.domPatcher.patch(this.currentViewDoc);
    if (selectionToApply) { this.currentModelSelection = selectionToApply; this.applyModelSelectionToDom(selectionToApply); } else this.currentModelSelection = null;
    this.isProcessingMutations = false;
  }

  private handleMutations(mutations: MutationRecord[]): void { if (this.isProcessingMutations) return; /* console.log("Unhandled mutations by RitorVDOM:", mutations); */ }
  public setFocus(): void { this.targetElement.focus(); if(this.currentModelSelection) this.applyModelSelectionToDom(this.currentModelSelection); else this.ensureInitialSelection(); }
  public undo(): void { const pS = this.undoManager.undo(); if (pS) this.updateDocument(pS); }
  public redo(): void { const nS = this.undoManager.redo(); if (nS) this.updateDocument(nS); }

  private _isMarkActiveInSelection(markType: MarkType, attrs: Attrs | undefined, selection: ModelSelection): boolean {
    if (this.arePositionsEqual(selection.anchor, selection.head)) { // Collapsed selection
        const marksAtCursor = this.getMarksAtPosition(this.currentViewDoc, selection.anchor); // TODO: Check "active marks for typing"
        return marksAtCursor.some(mark => mark.type === markType && (!attrs || mark.eq(markType.create(attrs))));
    }

    const flatFrom = modelPositionToFlatOffset(this.currentViewDoc, selection.anchor, this.schema);
    const flatTo = modelPositionToFlatOffset(this.currentViewDoc, selection.head, this.schema);
    const textNodes = findTextNodesInRange(this.currentViewDoc, Math.min(flatFrom, flatTo), Math.max(flatFrom, flatTo), this.schema);

    if (textNodes.length === 0) return false; // No text selected, or selection doesn't span text

    // For a range, mark is active if *all* parts of the text in range have it.
    // (Prosemirror's `rangeHasMark` is more nuanced for partial coverage)
    for (const segment of textNodes) {
        if (segment.startOffsetInNode === segment.endOffsetInNode) continue; // Skip zero-length segments

        const marksOnSegment = segment.node.marks || [];
        const foundMatch = marksOnSegment.some(mark => {
            if (mark.type !== markType) return false;
            if (attrs) { // If specific attributes provided, they must match
                // Use mark.eq for full attribute comparison if needed, or manual check
                let allAttrsMatch = true;
                for (const key in attrs) {
                    if (mark.attrs[key] !== attrs[key]) {
                        allAttrsMatch = false;
                        break;
                    }
                }
                // Also check if mark has extra attrs not in `attrs`
                for (const key in mark.attrs) {
                    if (!(key in attrs)) { // if comparing strictly, this means not equal
                        // allAttrsMatch = false; break;
                    }
                }
                return allAttrsMatch;
            }
            return true; // Type matches, no specific attrs to check
        });
        if (!foundMatch) return false; // If any segment doesn't have the mark, the range is not fully active
    }
    return true; // All segments have the mark
  }

  public toggleMark(markTypeOrName: MarkType | string, attrs?: Attrs): void {
    if (!this.currentModelSelection) return;
    const markType = typeof markTypeOrName === 'string' ? this.schema.marks[markTypeOrName] : markTypeOrName;
    if (!markType) { console.warn(`Unknown mark type: ${markTypeOrName}`); return; }

    if (this.arePositionsEqual(this.currentModelSelection.anchor, this.currentModelSelection.head)) {
        console.log("Toggling mark on collapsed selection - PoC: No change to active marks for typing yet.");
        // TODO: Manage active/stored marks for typing when selection is collapsed.
        return;
    }

    const tr = new Transaction(this.currentViewDoc, this.currentModelSelection);
    const flatAnchor = modelPositionToFlatOffset(this.currentViewDoc, this.currentModelSelection.anchor, this.schema);
    const flatHead = modelPositionToFlatOffset(this.currentViewDoc, this.currentModelSelection.head, this.schema);
    const from = Math.min(flatAnchor, flatHead);
    const to = Math.max(flatAnchor, flatHead);

    const markIsActive = this._isMarkActiveInSelection(markType, attrs, this.currentModelSelection!);

    if (markIsActive) {
        // When removing, if specific attrs were part of "activeness" check, remove that specific mark.
        // Otherwise, remove all marks of the type. For PoC, remove by type.
        const markToRemove = attrs ? markType.create(attrs) : markType;
        tr.removeMark(from, to, markToRemove);
    } else {
        tr.addMark(from, to, markType.create(attrs || {}));
    }

    if (tr.stepsApplied) {
        this.undoManager.add(this.currentViewDoc); // Save state *before* this transaction
        this.updateDocument(tr); // This will now use the AddMarkStep/RemoveMarkStep.apply()
    }
  }

  private getMarksAtPosition(doc: BaseNode, pos: ModelPosition): Mark[] {
    if (!pos) return [];
    let node: BaseNode | null = nodeAtPath(doc, pos.path);
    if (node && node.isText && !node.isLeaf) {
        const textNode = node as TextNode;
        // For offset 0, typically no marks are "active" unless from previous char or stored.
        // For this PoC, if at start of text node, take its marks if selection is into it.
        // If offset > 0, the marks of the character before are relevant, which are on the node itself.
        if (pos.offset > 0 || textNode.text.length > 0) { // If offset > 0 OR textnode is not empty (marks apply even at offset 0 for non-empty)
            if (textNode.marks && textNode.marks.length > 0) return [...textNode.marks];
        }
        // If at offset 0 of an empty text node, or text node has no marks, try to find from context (harder)
        return [];
    }
    if (node && !node.isText && !node.isLeaf && node.content && pos.offset > 0 && pos.offset <= node.content.length) {
        const childBefore = node.content[pos.offset -1];
        if (childBefore && childBefore.marks && childBefore.marks.length > 0) return [...childBefore.marks];
    }
    return [];
  }

  public ensureBlockIds(doc: DocNode): DocNode {
    let changed = false;
    const newContent = (doc.content || []).map(blockNode => {
        let currentBlock = blockNode;
        if (!currentBlock.attrs || currentBlock.attrs.id === undefined || currentBlock.attrs.id === null) {
            changed = true;
            const newAttrs = { ...currentBlock.attrs, id: this.schema.generateNodeId() };
            currentBlock = this.schema.node(currentBlock.type, newAttrs, currentBlock.content, currentBlock.marks);
        }
        if (currentBlock.content && (currentBlock.type.name === 'list_item' || currentBlock.type.name === 'blockquote')) {
            const tempInnerDoc = this.schema.node(currentBlock.type, currentBlock.attrs, currentBlock.content) as DocNode;
            const newInnerDocWithIds = this.ensureBlockIds(tempInnerDoc);
            if (newInnerDocWithIds.content !== currentBlock.content) {
                changed = true;
                currentBlock = this.schema.node(currentBlock.type, currentBlock.attrs, newInnerDocWithIds.content, currentBlock.marks);
            }
        }
        return currentBlock;
    });
    if (changed) return this.schema.node(doc.type, doc.attrs, newContent) as DocNode;
    return doc;
  }
}

console.log("RitorVDOM.ts updated: toggleMark uses Add/RemoveMarkStep; _applyMarkToRange_Legacy removed; _isMarkActiveInSelection refined.");
