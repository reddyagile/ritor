// src/RitorVDOM.ts
import { Schema } from './schema.js';
import { DocNode, BaseNode, TextNode, InlineNode, Mark } from './documentModel.js';
import { DomPatcher } from './domPatcher.js';
import { modelPositionToFlatOffset, flatOffsetToModelPosition, normalizeInlineArray, nodeAtPath, findTextNodesInRange, replaceNodeAtPath } from './modelUtils.js';
import { ModelPosition, ModelSelection } from './selection.js';
import { UndoManager } from './undoManager.js';
import { basicNodeSpecs, basicMarkSpecs } from './basicSchema.js';
import { DOMParser as RitorDOMParser } from './domParser.js';
import { Transaction } from './transform/transaction.js';
import { Slice } from './transform/slice.js';
import { MarkType, Attrs } from './schema.js';


interface SimpleChange {
  type: 'insertText' | 'deleteContentBackward' | 'deleteContentForward' | 'insertParagraph' | 'paste' | 'undo' | 'redo';
  text?: string;
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
      this.currentViewDoc = this.ensureBlockIds(initialDoc);
    } else {
      const p = this.schema.node(this.schema.nodes.paragraph, {}, [this.schema.text('')]);
      this.currentViewDoc = this.ensureBlockIds(this.schema.node(this.schema.nodes.doc, {}, [p]) as DocNode);
    }

    this.domPatcher = new DomPatcher(this.targetElement, this.schema);
    this.undoManager = new UndoManager();
    this.undoManager.add(this.currentViewDoc);

    this.domPatcher.patch(this.currentViewDoc);
    this.setupEventHandlers();

    this.mutationObserver = new MutationObserver(this.handleMutations.bind(this));
    this.mutationObserver.observe(this.targetElement, {
      childList: true, subtree: true, characterData: true, attributes: true,
    });

    this.ensureInitialSelection();
    this.setFocus();
  }

  private ensureInitialSelection() { /* ... as before ... */
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
  private findFirstTextNodePath(node: BaseNode, currentPath: number[] = []): { path: number[], node: TextNode } | null { /* ... as before ... */
    if (node.isText && !node.isLeaf) return { path: currentPath, node: node as TextNode };
    if (node.content) for (let i = 0; i < node.content.length; i++) { const r = this.findFirstTextNodePath(node.content[i], [...currentPath, i]); if (r) return r; }
    return null;
  }
  private setupEventHandlers(): void { /* ... as before ... */
    this.targetElement.addEventListener('beforeinput', this.handleBeforeInput.bind(this) as EventListener);
    this.targetElement.addEventListener('compositionstart', () => this.isComposing = true);
    this.targetElement.addEventListener('compositionend', () => { this.isComposing = false; this.handleMutations([]); /* Trigger recon after composition */ });
    document.addEventListener('selectionchange', this.handleSelectionChange.bind(this));
    this.targetElement.addEventListener('focus', this.handleFocus.bind(this));
    this.targetElement.addEventListener('keydown', this.handleKeyDown.bind(this));
  }
  private handleFocus(): void { this.updateModelSelectionState(); }
  private handleSelectionChange(): void { if (document.activeElement === this.targetElement && !this.isComposing) this.updateModelSelectionState(); } // Added !isComposing

  private updateModelSelectionState(): void {
    if (this.isProcessingMutations || this.isComposing) return; // Added isComposing
    const domSelection = window.getSelection();
    if (domSelection && domSelection.rangeCount > 0) {
      const range = domSelection.getRangeAt(0);
      const newModelSelection = this.domToModelSelection(range);
      if (newModelSelection && (!this.currentModelSelection || !this.areSelectionsEqual(this.currentModelSelection, newModelSelection))) {
        this.currentModelSelection = newModelSelection;
      }
    }
  }

  public domToModelSelection(range: Range): ModelSelection | null { /* ... as before ... */
    const aP = this.domToModelPosition(range.startContainer, range.startOffset); const hP = this.domToModelPosition(range.endContainer, range.endOffset); if (aP && hP) return { anchor: aP, head: hP }; return null;
  }
  public domToModelPosition(domNode: Node, domOffset: number): ModelPosition | null { /* ... as before (PoC)... */
    const path: number[] = []; let currentDomNode: Node | null = domNode; let charOffsetInText = 0;
    if (currentDomNode.nodeType === Node.TEXT_NODE) { charOffsetInText = domOffset; currentDomNode = currentDomNode.parentNode; if (!currentDomNode) return null;}
    while (currentDomNode && currentDomNode !== this.targetElement) { const parent = currentDomNode.parentNode; if (!parent) return null; const index = Array.from(parent.childNodes).indexOf(currentDomNode as ChildNode); path.unshift(index); currentDomNode = parent;}
    if (!currentDomNode) return null; let modelNode: BaseNode | undefined = this.currentViewDoc; let finalPath:number[] = [];
    for (let i=0;i<path.length;i++) { const domChildIndex=path[i]; if(!modelNode?.content || domChildIndex>=modelNode.content.length) return null; modelNode=modelNode.content[domChildIndex]; finalPath.push(domChildIndex);}
    if(!modelNode) return null; if(modelNode.isText && !modelNode.isLeaf) return {path:finalPath, offset:charOffsetInText}; if(!modelNode.isLeaf && modelNode.content){if(domNode.nodeType===Node.ELEMENT_NODE) return {path:finalPath, offset:domOffset}; return {path:finalPath, offset:0};} if(modelNode.isLeaf) return {path:finalPath, offset:0}; return null;
  }
  public modelToDomPosition(modelPos: ModelPosition): { node: Node, offset: number } | null { /* ... as before (PoC)... */
    let nM:BaseNode=this.currentViewDoc; let dN:Node=this.targetElement;
    for(let i=0;i<modelPos.path.length;i++){const idx=modelPos.path[i]; if(!nM.content||idx>=nM.content.length)return null; nM=nM.content[idx]; let dC:Node|null=null; if(nM.attrs?.id){dC=this.targetElement.querySelector(`[id="${nM.attrs.id}"]`); if(dC)dN=dC; else return null;}else if(dN.childNodes.length>idx){dN=dN.childNodes[idx];}else return null;}
    if(nM.isText&&!nM.isLeaf){let tC:Node|null=null; for(let i=0;i<dN.childNodes.length;i++)if(dN.childNodes[i].nodeType===Node.TEXT_NODE){tC=dN.childNodes[i];break;} if(tC)return{node:tC,offset:modelPos.offset}; return{node:dN,offset:0};}
    if(!nM.isLeaf&&nM.content){if(dN.childNodes.length>=modelPos.offset)return{node:dN,offset:modelPos.offset}; return{node:dN,offset:dN.childNodes.length};}
    if(nM.isLeaf)return{node:dN,offset:modelPos.offset>0?1:0}; return null;
  }
  public applyModelSelectionToDom(modelSelection: ModelSelection | null): void { /* ... as before ... */
    if (!modelSelection) return; const aDP = this.modelToDomPosition(modelSelection.anchor); const hDP = this.modelToDomPosition(modelSelection.head); if (aDP && hDP) { const dS = window.getSelection(); if (dS) { this.lastViewModelSelection = modelSelection; const nR = document.createRange(); nR.setStart(aDP.node, aDP.offset); nR.setEnd(hDP.node, hDP.offset); if (document.activeElement === this.targetElement) { dS.removeAllRanges(); dS.addRange(nR);}}}
  }
  private areSelectionsEqual(sel1: ModelSelection, sel2: ModelSelection): boolean { /* ... as before ... */ return this.arePositionsEqual(sel1.anchor, sel2.anchor) && this.arePositionsEqual(sel1.head, sel2.head); }
  private arePositionsEqual(pos1: ModelPosition, pos2: ModelPosition): boolean { /* ... as before ... */ if (!pos1 || !pos2) return pos1 === pos2; if (pos1.offset !== pos2.offset) return false; if (pos1.path.length !== pos2.path.length) return false; for (let i = 0; i < pos1.path.length; i++) if (pos1.path[i] !== pos2.path[i]) return false; return true; }
  private handleKeyDown(event: KeyboardEvent): void { /* ... as before ... */
    if ((event.metaKey || event.ctrlKey) && event.key === 'z') { event.preventDefault(); this.undo(); }
    else if ((event.metaKey || event.ctrlKey) && (event.key === 'y' || (event.shiftKey && event.key === 'Z'))) { event.preventDefault(); this.redo(); }
    else if ((event.metaKey || event.ctrlKey) && event.key === 'b') { event.preventDefault(); this.toggleMark(this.schema.marks.bold); }
    else if ((event.metaKey || event.ctrlKey) && event.key === 'i') { event.preventDefault(); this.toggleMark(this.schema.marks.italic); }
    else if ((event.metaKey || event.ctrlKey) && event.key === 's' && event.shiftKey) { event.preventDefault(); this.toggleMark(this.schema.marks.strikethrough); }
  }

  private handleBeforeInput(event: InputEvent): void { /* ... as before ... */
    if (this.isComposing) return; const changeType = event.inputType; let simpleChangeToApply: SimpleChange | null = null;
    switch (changeType) {
      case 'insertText': simpleChangeToApply = { type: changeType, text: event.data || undefined }; break;
      case 'deleteContentBackward': case 'deleteContentForward': case 'insertParagraph': simpleChangeToApply = { type: changeType }; break;
      case 'formatBold': event.preventDefault(); this.toggleMark(this.schema.marks.bold); return;
      case 'formatItalic': event.preventDefault(); this.toggleMark(this.schema.marks.italic); return;
      case 'formatStrikeThrough': event.preventDefault(); this.toggleMark(this.schema.marks.strikethrough); return;
      case 'insertFromPaste': event.preventDefault(); this.handlePaste(event.dataTransfer); return;
      default: console.log('Unhandled beforeinput type by RitorVDOM, allowing native:', event.inputType); return;
    }
    event.preventDefault(); if (simpleChangeToApply) this.applyChange(simpleChangeToApply);
  }

  private pasteText(text: string): void { /* ... as before ... */
    if (!this.currentModelSelection) { console.warn("No model selection, cannot paste text."); return; }
    const tr = new Transaction(this.currentViewDoc, this.currentModelSelection); const flatAnchor = modelPositionToFlatOffset(this.currentViewDoc, this.currentModelSelection.anchor, this.schema); const flatHead = this.arePositionsEqual(this.currentModelSelection.anchor, this.currentModelSelection.head) ? flatAnchor : modelPositionToFlatOffset(this.currentViewDoc, this.currentModelSelection.head, this.schema); const from = Math.min(flatAnchor, flatHead); const to = Math.max(flatAnchor, flatHead);
    const lines = text.split(/\r\n|\r|\n/); let nodesToInsert: BaseNode[] = [];
    if (lines.length <= 1) { const marks = this.getMarksAtPosition(this.currentViewDoc, this.currentModelSelection.anchor); nodesToInsert.push(this.schema.text(lines[0] || "", marks));}
    else { lines.forEach((line) => { nodesToInsert.push(this.schema.node(this.schema.nodes.paragraph, {}, [this.schema.text(line)])); });}
    const sliceToInsert = Slice.fromFragment(nodesToInsert); tr.replace(from, to, sliceToInsert); const endOfPastedContentFlat = from + sliceToInsert.size; const endModelPos = flatOffsetToModelPosition(tr.doc, endOfPastedContentFlat, this.schema); tr.setSelection({ anchor: endModelPos, head: endModelPos }); tr.scrollIntoView();
    if (tr.stepsApplied) { this.undoManager.add(this.currentViewDoc); this.updateDocument(tr); }
  }

  private handlePaste(dataTransfer: DataTransfer | null): void { /* ... as before ... */
    if (!dataTransfer) return; this.updateModelSelectionState(); const selection = this.currentModelSelection; if (!selection) { console.error("Cannot paste: no valid model selection."); return; }
    const html = dataTransfer.getData('text/html'); const pastedText = dataTransfer.getData('text/plain'); let modelNodesToInsert: BaseNode[] | null = null;
    if (html && html.length > 0) { const tempDiv = document.createElement('div'); tempDiv.innerHTML = html; modelNodesToInsert = this.domParser.parseFragment(tempDiv); }
    if (modelNodesToInsert && modelNodesToInsert.length > 0) {
        const tr = new Transaction(this.currentViewDoc, selection); const fromFlat = modelPositionToFlatOffset(this.currentViewDoc, selection.anchor, this.schema); const toFlat = modelPositionToFlatOffset(this.currentViewDoc, selection.head, this.schema); const replaceFrom = Math.min(fromFlat, toFlat); const replaceTo = Math.max(fromFlat, toFlat);
        const sliceToInsert = Slice.fromFragment(modelNodesToInsert); tr.replace(replaceFrom, replaceTo, sliceToInsert); const endOfPastedContentFlat = replaceFrom + sliceToInsert.size; const endModelPos = flatOffsetToModelPosition(tr.doc, endOfPastedContentFlat, this.schema); tr.setSelection({ anchor: endModelPos, head: endModelPos }); tr.scrollIntoView();
        if (tr.stepsApplied) { if (!this.domPatcher.areNodesEffectivelyEqual(this.currentViewDoc, tr.doc)) this.undoManager.add(this.currentViewDoc); this.updateDocument(tr); }
        else if (pastedText && pastedText.trim().length > 0) { console.log("HTML paste resulted in no steps, trying plain text."); this.pasteText(pastedText); }
    } else if (pastedText && pastedText.trim().length > 0) { console.log("HTML parsing yielded no nodes, or no HTML pasted. Pasting as plain text."); this.pasteText(pastedText); }
  }

  private applyChange(change: SimpleChange): void { /* ... as before, without paste case ... */
    if (!this.currentModelSelection) return;
    const tr = new Transaction(this.currentViewDoc, this.currentModelSelection);
    const flatAnchor = modelPositionToFlatOffset(this.currentViewDoc, this.currentModelSelection.anchor, this.schema); const flatHead = this.arePositionsEqual(this.currentModelSelection.anchor, this.currentModelSelection.head) ? flatAnchor : modelPositionToFlatOffset(this.currentViewDoc, this.currentModelSelection.head, this.schema); const from = Math.min(flatAnchor, flatHead); const to = Math.max(flatAnchor, flatHead);
    let newSelectionAnchorPos: ModelPosition | null = null; let newSelectionHeadPos: ModelPosition | null = null;
    switch (change.type) {
      case 'insertText': if (change.text) { const marks = this.getMarksAtPosition(this.currentViewDoc, this.currentModelSelection.anchor); const textNode = this.schema.text(change.text, marks); tr.replace(from, to, Slice.fromFragment([textNode])); const newFlatPos = from + textNode.text.length; newSelectionAnchorPos = newSelectionHeadPos = flatOffsetToModelPosition(tr.doc, newFlatPos, this.schema); } break;
      case 'deleteContentBackward': if (from === to && from > 0) { tr.delete(from -1, from); newSelectionAnchorPos = newSelectionHeadPos = flatOffsetToModelPosition(tr.doc, from -1, this.schema); } else if (from < to) { tr.delete(from, to); newSelectionAnchorPos = newSelectionHeadPos = flatOffsetToModelPosition(tr.doc, from, this.schema); } break;
      case 'insertParagraph': const newPara = this.schema.node(this.schema.nodes.paragraph, {}, [this.schema.text('')]); tr.replace(from, to, Slice.fromFragment([newPara])); const newParaStartFlatPos = from + 1; newSelectionAnchorPos = newSelectionHeadPos = flatOffsetToModelPosition(tr.doc, newParaStartFlatPos, this.schema); break;
      default: return;
    }
    if (newSelectionAnchorPos && newSelectionHeadPos) tr.setSelection({ anchor: newSelectionAnchorPos, head: newSelectionHeadPos });
    if (tr.stepsApplied) { this.undoManager.add(this.currentViewDoc); this.updateDocument(tr); }
  }

  public updateDocument(trOrDoc: Transaction | DocNode): void { /* ... as before ... */
    this.isProcessingMutations = true; let selToApply: ModelSelection|null=null;
    if(trOrDoc instanceof Transaction){this.currentViewDoc=trOrDoc.doc; selToApply=trOrDoc.selection;}
    else{this.currentViewDoc=trOrDoc; if(this.currentModelSelection){const dS=window.getSelection(); if(dS&&dS.rangeCount>0)selToApply=this.domToModelSelection(dS.getRangeAt(0)); if(!selToApply){const fTI=this.findFirstTextNodePath(this.currentViewDoc); selToApply=fTI?{anchor:{path:fTI.path,offset:0},head:{path:fTI.path,offset:0}}:{anchor:{path:[],offset:0},head:{path:[],offset:0}};}}}
    this.currentViewDoc = this.ensureBlockIds(this.currentViewDoc);
    this.domPatcher.patch(this.currentViewDoc);
    if(selToApply){this.currentModelSelection=selToApply; this.applyModelSelectionToDom(selToApply);} else this.currentModelSelection=null;
    this.isProcessingMutations = false;
  }

  private getModelPathFromDomNode(domNode: Node | null): number[] | null {
    if (!domNode) return null;
    const path: number[] = [];
    let currentDomNode: Node | null = domNode;
    while (currentDomNode && currentDomNode !== this.targetElement) {
        const parent = currentDomNode.parentNode;
        if (!parent) return null;
        const index = Array.from(parent.childNodes).indexOf(currentDomNode as ChildNode);
        if (index === -1) return null; // Should not happen if domNode is within targetElement
        path.unshift(index);
        currentDomNode = parent;
    }
    return currentDomNode === this.targetElement ? path : null;
  }

  private findClosestBlockParentInfo(domNode: Node | null): { element: HTMLElement, path: number[] } | null {
    let current: Node | null = domNode;
    while (current && current !== this.targetElement) {
        if (current.nodeType === Node.ELEMENT_NODE) {
            const el = current as HTMLElement;
            // Check if this element corresponds to a known block node in our model
            // This is a heuristic: does it have an ID that our DomPatcher would have set?
            // Or, does its tagName match a block node type in the schema?
            if (el.id && el.id.startsWith('ritor-node-')) { // ID set by our schema.generateNodeId()
                 const modelPath = this.getModelPathFromDomNode(el); // Path to this block
                 if (modelPath) return { element: el, path: modelPath };
            } else if (this.schema.nodes[el.nodeName.toLowerCase()]?.isBlock) {
                 const modelPath = this.getModelPathFromDomNode(el);
                 if (modelPath) return { element: el, path: modelPath };
            }
        }
        current = current.parentNode;
    }
    return null;
  }


  private handleMutations(mutations: MutationRecord[]): void {
    if (this.isProcessingMutations || this.isComposing) {
        return;
    }
    this.isProcessingMutations = true;

    // Simplified PoC: Find the highest common ancestor that is a known block element.
    // This is a very basic way to determine the scope of re-parse.
    let changedBlockInfo: { element: HTMLElement, path: number[] } | null = null;
    let fullResyncNeeded = false;

    for (const mutation of mutations) {
        if (mutation.type === 'attributes') { // Often can be ignored unless model depends on them
            if (mutation.target === this.targetElement) continue; // Ignore changes to root $el attributes
            // If an attribute change on a block node is significant, we might need to re-parse it.
        }

        const parentBlockInfo = this.findClosestBlockParentInfo(mutation.target);
        if (parentBlockInfo) {
            if (!changedBlockInfo || parentBlockInfo.path.length < changedBlockInfo.path.length) {
                changedBlockInfo = parentBlockInfo; // Smallest path length means higher ancestor
            }
            // If paths are same, it's within same block or siblings.
        } else {
            // Change occurred outside a known block or directly under targetElement
            fullResyncNeeded = true;
            break;
        }
        if (mutation.type === 'childList' && (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0)) {
            // If block nodes themselves are added/removed directly under targetElement
             Array.from(mutation.addedNodes).concat(Array.from(mutation.removedNodes)).forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE && this.schema.nodes[(node as HTMLElement).nodeName.toLowerCase()]?.isBlock) {
                    fullResyncNeeded = true;
                }
             });
             if (mutation.target === this.targetElement) fullResyncNeeded = true;
        }
        if (fullResyncNeeded) break;
    }

    // If after checking all mutations, we haven't found a specific block and not forced fullResync,
    // but there were mutations, it's safer to resync.
    if (!changedBlockInfo && mutations.length > 0 && !fullResyncNeeded) {
        // This can happen if, e.g., text is deleted from a paragraph, leaving it empty,
        // and the empty text node is removed. Target might be the paragraph.
        if (mutations.length === 1 && mutations[0].target.nodeType === Node.ELEMENT_NODE) {
            const blockInfo = this.findClosestBlockParentInfo(mutations[0].target);
            if (blockInfo) changedBlockInfo = blockInfo;
            else fullResyncNeeded = true;
        } else {
             fullResyncNeeded = true;
        }
    }


    Promise.resolve().then(() => { // Allow DOM to settle before reading selection
        if (fullResyncNeeded) {
            console.warn("RitorVDOM: Performing full DOM re-parse due to complex/block-level mutations.");
            const newModelNodes = this.domParser.parseFragment(this.targetElement);
            // Ensure these are valid doc content (e.g. wrap inlines in paragraphs if necessary)
            const newDocContent: BaseNode[] = [];
            let currentInlineGroup: InlineNode[] = [];
            for (const node of newModelNodes) {
                if (node.type.isBlock) {
                    if (currentInlineGroup.length > 0) { newDocContent.push(this.schema.nodes.paragraph.create(null, normalizeInlineArray(currentInlineGroup, this.schema))); currentInlineGroup = []; }
                    newDocContent.push(node);
                } else { currentInlineGroup.push(node as InlineNode); }
            }
            if (currentInlineGroup.length > 0) { newDocContent.push(this.schema.nodes.paragraph.create(null, normalizeInlineArray(currentInlineGroup, this.schema)));}

            const newDoc = this.schema.node(this.schema.nodes.doc, this.currentViewDoc.attrs, newDocContent) as DocNode;
            if (newDoc && !this.areDocsEffectivelyEqual(this.currentViewDoc, newDoc)) { // Use a deep model comparison
                this.undoManager.add(this.currentViewDoc);
                this.updateDocument(newDoc); // Pass newDoc directly
            } else { this.isProcessingMutations = false; } // No change or no newDoc
            return;
        }

        if (changedBlockInfo) {
            const { element: domChangedBlockElement, path: modelBlockPath } = changedBlockInfo;
            const oldModelBlock = nodeAtPath(this.currentViewDoc, modelBlockPath);

            if (!oldModelBlock || oldModelBlock.isLeafType) { // isLeafType from NodeType
                console.error("Mutation handler: Could not find model block or it's a leaf.", modelBlockPath);
                this.isProcessingMutations = false;
                return;
            }

            // Re-parse only the content of the identified block
            const newParsedInlineNodes = this.domParser.parseFragment(domChangedBlockElement);
            const normalizedNewInlineContent = normalizeInlineArray(newParsedInlineNodes as InlineNode[], this.schema);

            // Create a new version of the block with the new content
            const newModelBlock = this.schema.node(oldModelBlock.type, oldModelBlock.attrs, normalizedNewInlineContent, oldModelBlock.marks);

            // Create a new document with this updated block
            const newDoc = replaceNodeAtPath(this.currentViewDoc, modelBlockPath, newModelBlock, this.schema) as DocNode | null;

            if (newDoc && !this.areDocsEffectivelyEqual(this.currentViewDoc, newDoc)) {
                this.undoManager.add(this.currentViewDoc);
                this.updateDocument(newDoc); // Update with the new document state
            } else { this.isProcessingMutations = false; } // No change or failed replacement
            return;
        }
        this.isProcessingMutations = false; // No action taken
    }).catch(error => {
        console.error("Error during mutation handling:", error);
        this.isProcessingMutations = false;
    });
  }

  // Helper for deep document comparison (can be basic for PoC)
  private areDocsEffectivelyEqual(docA: DocNode, docB: DocNode): boolean {
    // For PoC, JSON stringify is a simple way, but can be slow or miss nuances.
    // A proper diff of model structure would be better.
    // DomPatcher.areNodesEffectivelyEqual might be too DOM focused.
    // This needs to compare model structure and content.
    if (docA.content.length !== docB.content.length) return false;
    // This is a very shallow check for PoC.
    // TODO: Implement a proper deep model comparison.
    return JSON.stringify(docA) === JSON.stringify(docB);
  }


  public setFocus(): void { /* ... as before ... */ this.targetElement.focus(); if(this.currentModelSelection) this.applyModelSelectionToDom(this.currentModelSelection); else this.ensureInitialSelection(); }
  public undo(): void { /* ... as before ... */ const pS = this.undoManager.undo(); if (pS) this.updateDocument(pS); }
  public redo(): void { /* ... as before ... */ const nS = this.undoManager.redo(); if (nS) this.updateDocument(nS); }
  private _isMarkActiveInSelection(markType: MarkType, attrs: Attrs | undefined, selection: ModelSelection): boolean { /* ... as before ... */
    if(this.arePositionsEqual(selection.anchor,selection.head)){const mAC=this.getMarksAtPosition(this.currentViewDoc,selection.anchor); return mAC.some(m=>m.type===markType&&(!attrs||m.eq(markType.create(attrs))));}
    const fF=modelPositionToFlatOffset(this.currentViewDoc,selection.anchor,this.schema); const fT=modelPositionToFlatOffset(this.currentViewDoc,selection.head,this.schema);
    const tNs=findTextNodesInRange(this.currentViewDoc,Math.min(fF,fT),Math.max(fF,fT),this.schema); if(tNs.length===0)return false;
    for(const seg of tNs){if(seg.startOffsetInNode===seg.endOffsetInNode)continue; const mOS=seg.node.marks||[]; const fM=mOS.some(m=>{if(m.type!==markType)return false; if(attrs){let aAM=true; for(const k in attrs)if(m.attrs[k]!==attrs[k]){aAM=false;break;} /* Check extra attrs */ return aAM;} return true;}); if(!fM)return false;} return true;
  }
  public toggleMark(markTypeOrName: MarkType | string, attrs?: Attrs): void { /* ... as before ... */
    if(!this.currentModelSelection)return; const mT=typeof markTypeOrName==='string'?this.schema.marks[markTypeOrName]:markTypeOrName; if(!mT){console.warn(`Unknown mark type: ${markTypeOrName}`);return;}
    if(this.arePositionsEqual(this.currentModelSelection.anchor,this.currentModelSelection.head)){console.log("Toggling mark on collapsed selection - PoC: No change yet.");return;}
    const tr=new Transaction(this.currentViewDoc,this.currentModelSelection); const fA=modelPositionToFlatOffset(this.currentViewDoc,this.currentModelSelection.anchor,this.schema); const fH=modelPositionToFlatOffset(this.currentViewDoc,this.currentModelSelection.head,this.schema); const from=Math.min(fA,fH); const to=Math.max(fA,fH);
    const mIA=this._isMarkActiveInSelection(mT,attrs,this.currentModelSelection!); if(mIA){const mTR=attrs?mT.create(attrs):mT; tr.removeMark(from,to,mTR);}else{tr.addMark(from,to,mT.create(attrs||{}));}
    if(tr.stepsApplied){this.undoManager.add(this.currentViewDoc); this.updateDocument(tr);}
  }
  private getMarksAtPosition(doc: BaseNode, pos: ModelPosition): Mark[] { /* ... as before ... */
    if(!pos)return[]; let n:BaseNode|null=nodeAtPath(doc,pos.path); if(n?.isText&&!n.isLeaf){const tN=n as TextNode; if(pos.offset>0||tN.text.length>0){if(tN.marks&&tN.marks.length>0)return[...tN.marks];}return[];} if(n&&!n.isText&&!n.isLeaf&&n.content&&pos.offset>0&&pos.offset<=n.content.length){const cB=n.content[pos.offset-1]; if(cB?.marks&&cB.marks.length>0)return[...cB.marks];} return[];
  }
  public ensureBlockIds(doc: DocNode): DocNode { /* ... as before ... */
    let ch=false; const nC=(doc.content||[]).map(bN=>{let cB=bN; if(!cB.attrs||cB.attrs.id==null){ch=true; const nA={...cB.attrs,id:this.schema.generateNodeId()}; cB=this.schema.node(cB.type,nA,cB.content,cB.marks);} if(cB.content&&(cB.type.name==='list_item'||cB.type.name==='blockquote')){ /* Ensure recursive call uses a DocNode-like structure for its 'doc' param if ensureBlockIds expects DocNode */ const tempTypeForRecurse = this.schema.nodes[cB.type.name] || cB.type; const tempInnerDoc = { type: tempTypeForRecurse, content: cB.content, attrs: cB.attrs, nodeSize:cB.nodeSize } as DocNode; const nID=this.ensureBlockIds(tempInnerDoc); if(nID.content!==cB.content){ch=true; cB=this.schema.node(cB.type,cB.attrs,nID.content,cB.marks);}} return cB;}); if(ch)return this.schema.node(doc.type,doc.attrs,nC)as DocNode; return doc;
  }
}

console.log("RitorVDOM.ts updated: handleMutations PoC uses DOMParser, handlePaste uses transactions.");
