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
    if (node.isText && !node.isLeaf) return { path: currentPath, node: node as TextNode };
    if (node.content) for (let i = 0; i < node.content.length; i++) { const r = this.findFirstTextNodePath(node.content[i], [...currentPath, i]); if (r) return r; }
    return null;
  }
  private setupEventHandlers(): void {
    this.targetElement.addEventListener('beforeinput', this.handleBeforeInput.bind(this) as EventListener);
    this.targetElement.addEventListener('compositionstart', () => this.isComposing = true);
    this.targetElement.addEventListener('compositionend', () => { this.isComposing = false; this.handleMutations([]); });
    document.addEventListener('selectionchange', this.handleSelectionChange.bind(this));
    this.targetElement.addEventListener('focus', this.handleFocus.bind(this));
    this.targetElement.addEventListener('keydown', this.handleKeyDown.bind(this));
  }
  private handleFocus(): void { this.updateModelSelectionState(); }
  private handleSelectionChange(): void { if (document.activeElement === this.targetElement && !this.isComposing) this.updateModelSelectionState(); }

  private updateModelSelectionState(): void {
    if (this.isProcessingMutations || this.isComposing) return;
    const dS = window.getSelection(); if (dS && dS.rangeCount > 0) { const r = dS.getRangeAt(0); const nMS = this.domToModelSelection(r); if (nMS && (!this.currentModelSelection || !this.areSelectionsEqual(this.currentModelSelection, nMS))) this.currentModelSelection = nMS; }
  }

  public domToModelSelection(range: Range): ModelSelection | null {
    const aP = this.domToModelPosition(range.startContainer, range.startOffset); const hP = this.domToModelPosition(range.endContainer, range.endOffset); if (aP && hP) return { anchor: aP, head: hP }; return null;
  }
  public domToModelPosition(domNode: Node, domOffset: number): ModelPosition | null {
    const path: number[] = []; let currentDomNode: Node | null = domNode; let charOffsetInText = 0;
    if (currentDomNode.nodeType === Node.TEXT_NODE) { charOffsetInText = domOffset; currentDomNode = currentDomNode.parentNode; if (!currentDomNode) return null;}
    while (currentDomNode && currentDomNode !== this.targetElement) { const parent = currentDomNode.parentNode; if (!parent) return null; const index = Array.from(parent.childNodes).indexOf(currentDomNode as ChildNode); path.unshift(index); currentDomNode = parent;}
    if (!currentDomNode) return null; let modelNode: BaseNode|undefined = this.currentViewDoc; let finalPath:number[] = [];
    for (let i=0;i<path.length;i++) { const domChildIndex=path[i]; if(!modelNode?.content || domChildIndex>=modelNode.content.length) return null; modelNode=modelNode.content[domChildIndex]; finalPath.push(domChildIndex);}
    if(!modelNode) return null; if(modelNode.isText && !modelNode.isLeaf) return {path:finalPath, offset:charOffsetInText}; if(!modelNode.isLeaf && modelNode.content){if(domNode.nodeType===Node.ELEMENT_NODE) return {path:finalPath, offset:domOffset}; return {path:finalPath, offset:0};} if(modelNode.isLeaf) return {path:finalPath, offset:0}; return null;
  }
  public modelToDomPosition(modelPos: ModelPosition): { node: Node, offset: number } | null {
    let nM:BaseNode=this.currentViewDoc; let dN:Node=this.targetElement;
    for(let i=0;i<modelPos.path.length;i++){const idx=modelPos.path[i]; if(!nM.content||idx>=nM.content.length)return null; nM=nM.content[idx]; let dC:Node|null=null; if(nM.attrs?.id){dC=this.targetElement.querySelector(`[id="${nM.attrs.id}"]`); if(dC)dN=dC; else return null;}else if(dN.childNodes.length>idx){dN=dN.childNodes[idx];}else return null;}
    if(nM.isText&&!nM.isLeaf){let tC:Node|null=null; for(let i=0;i<dN.childNodes.length;i++)if(dN.childNodes[i].nodeType===Node.TEXT_NODE){tC=dN.childNodes[i];break;} if(tC)return{node:tC,offset:modelPos.offset}; return{node:dN,offset:0};}
    if(!nM.isLeaf&&nM.content){if(dN.childNodes.length>=modelPos.offset)return{node:dN,offset:modelPos.offset}; return{node:dN,offset:dN.childNodes.length};}
    if(nM.isLeaf)return{node:dN,offset:modelPos.offset>0?1:0}; return null;
  }
  public applyModelSelectionToDom(modelSelection: ModelSelection | null): void {
    if (!modelSelection) return; const aDP = this.modelToDomPosition(modelSelection.anchor); const hDP = this.modelToDomPosition(modelSelection.head); if (aDP && hDP) { const dS = window.getSelection(); if (dS) { this.lastViewModelSelection = modelSelection; const nR = document.createRange(); nR.setStart(aDP.node, aDP.offset); nR.setEnd(hDP.node, hDP.offset); if (document.activeElement === this.targetElement) { dS.removeAllRanges(); dS.addRange(nR);}}}
  }
  private areSelectionsEqual(sel1: ModelSelection, sel2: ModelSelection): boolean { return this.arePositionsEqual(sel1.anchor, sel2.anchor) && this.arePositionsEqual(sel1.head, sel2.head); }
  private arePositionsEqual(pos1: ModelPosition, pos2: ModelPosition): boolean { if (!pos1 || !pos2) return pos1 === pos2; if (pos1.offset !== pos2.offset) return false; if (pos1.path.length !== pos2.path.length) return false; for (let i = 0; i < pos1.path.length; i++) if (pos1.path[i] !== pos2.path[i]) return false; return true; }

  private handleKeyDown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key === 'z') { event.preventDefault(); this.undo(); }
    else if ((event.metaKey || event.ctrlKey) && (event.key === 'y' || (event.shiftKey && event.key === 'Z'))) { event.preventDefault(); this.redo(); }
    else if ((event.metaKey || event.ctrlKey) && event.key === 'b') { event.preventDefault(); this.toggleMark(this.schema.marks.bold); }
    else if ((event.metaKey || event.ctrlKey) && event.key === 'i') { event.preventDefault(); this.toggleMark(this.schema.marks.italic); }
    else if ((event.metaKey || event.ctrlKey) && event.key === 's' && event.shiftKey) { event.preventDefault(); this.toggleMark(this.schema.marks.strikethrough); }
  }

  private handleBeforeInput(event: InputEvent): void {
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

  private pasteText(text: string): void {
    if (!this.currentModelSelection) { console.warn("No model selection, cannot paste text."); return; }
    const tr = new Transaction(this.currentViewDoc, this.currentModelSelection);
    const flatAnchor = modelPositionToFlatOffset(this.currentViewDoc, this.currentModelSelection.anchor, this.schema);
    const flatHead = this.arePositionsEqual(this.currentModelSelection.anchor, this.currentModelSelection.head) ? flatAnchor : modelPositionToFlatOffset(this.currentViewDoc, this.currentModelSelection.head, this.schema);
    const from = Math.min(flatAnchor, flatHead); const to = Math.max(flatAnchor, flatHead);
    const lines = text.split(/\r\n|\r|\n/); let nodesToInsert: BaseNode[] = [];
    if (lines.length <= 1) { const marks = this.getMarksAtPosition(this.currentViewDoc, this.currentModelSelection.anchor); nodesToInsert.push(this.schema.text(lines[0] || "", marks));}
    else { lines.forEach((line) => { nodesToInsert.push(this.schema.node(this.schema.nodes.paragraph, {}, [this.schema.text(line)])); });}
    const sliceToInsert = Slice.fromFragment(nodesToInsert); // Here openStart/End will be 0
    tr.replace(from, to, sliceToInsert);
    const endOfPastedContentFlat = from + sliceToInsert.size;
    const endModelPos = flatOffsetToModelPosition(tr.doc, endOfPastedContentFlat, this.schema);
    tr.setSelection({ anchor: endModelPos, head: endModelPos }); tr.scrollIntoView();
    if (tr.stepsApplied) { this.undoManager.add(this.currentViewDoc); this.updateDocument(tr); }
  }

  private handlePaste(dataTransfer: DataTransfer | null): void {
    if (!dataTransfer) return;
    this.updateModelSelectionState();
    const selection = this.currentModelSelection;
    if (!selection) { console.error("Cannot paste: no valid model selection."); return; }

    const html = dataTransfer.getData('text/html');
    const pastedText = dataTransfer.getData('text/plain');
    let modelNodesToInsert: BaseNode[] | null = null;
    let openStart = 0;
    let openEnd = 0;

    if (html && html.length > 0) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        const parsedResult = this.domParser.parseFragment(tempDiv, selection.anchor.path.length > 0 ? nodeAtPath(this.currentViewDoc, selection.anchor.path.slice(0,-1))?.type : this.schema.topNodeType ); // Pass parent type of selection anchor for context
        modelNodesToInsert = parsedResult.nodes;
        openStart = parsedResult.openStart;
        openEnd = parsedResult.openEnd;
    }

    if (modelNodesToInsert && modelNodesToInsert.length > 0) {
        const tr = new Transaction(this.currentViewDoc, selection);
        const fromFlat = modelPositionToFlatOffset(this.currentViewDoc, selection.anchor, this.schema);
        const toFlat = modelPositionToFlatOffset(this.currentViewDoc, selection.head, this.schema);
        const replaceFrom = Math.min(fromFlat, toFlat);
        const replaceTo = Math.max(fromFlat, toFlat);

        const sliceToInsert = new Slice(modelNodesToInsert, openStart, openEnd);
        tr.replace(replaceFrom, replaceTo, sliceToInsert);

        const endOfPastedContentFlat = replaceFrom + sliceToInsert.size;
        const endModelPos = flatOffsetToModelPosition(tr.doc, endOfPastedContentFlat, this.schema);
        tr.setSelection({ anchor: endModelPos, head: endModelPos });
        tr.scrollIntoView();

        if (tr.stepsApplied) {
            if (!this.areDocsEffectivelyEqual(this.currentViewDoc, tr.doc)) { // Use helper
                this.undoManager.add(this.currentViewDoc);
            }
            this.updateDocument(tr);
        } else if (pastedText && pastedText.trim().length > 0) {
            console.log("HTML paste resulted in no steps, trying plain text.");
            this.pasteText(pastedText);
        }
    } else if (pastedText && pastedText.trim().length > 0) {
        console.log("HTML parsing yielded no nodes, or no HTML pasted. Pasting as plain text.");
        this.pasteText(pastedText);
    }
  }

  private applyChange(change: SimpleChange): void {
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

  public updateDocument(trOrDoc: Transaction | DocNode): void {
    this.isProcessingMutations = true; let selToApply: ModelSelection|null=null;
    if(trOrDoc instanceof Transaction){this.currentViewDoc=trOrDoc.doc; selToApply=trOrDoc.selection;}
    else{this.currentViewDoc=trOrDoc; if(this.currentModelSelection){const dS=window.getSelection(); if(dS&&dS.rangeCount>0)selToApply=this.domToModelSelection(dS.getRangeAt(0)); if(!selToApply){const fTI=this.findFirstTextNodePath(this.currentViewDoc); selToApply=fTI?{anchor:{path:fTI.path,offset:0},head:{path:fTI.path,offset:0}}:{anchor:{path:[],offset:0},head:{path:[],offset:0}};}}}
    this.currentViewDoc = this.ensureBlockIds(this.currentViewDoc);
    this.domPatcher.patch(this.currentViewDoc);
    if(selToApply){this.currentModelSelection=selToApply; this.applyModelSelectionToDom(selToApply);} else this.currentModelSelection=null;
    this.isProcessingMutations = false;
  }

  private getModelPathFromDomNode(domNode: Node | null): number[] | null { /* ... as before ... */ if (!domNode) return null; const path: number[] = []; let cDN: Node | null = domNode; while(cDN && cDN !== this.targetElement){ const pN=cDN.parentNode; if(!pN) return null; const idx=Array.from(pN.childNodes).indexOf(cDN as ChildNode); if(idx===-1)return null; path.unshift(idx); cDN=pN; } return cDN===this.targetElement?path:null;}
  private findClosestBlockParentInfo(domNode: Node | null): { element: HTMLElement, path: number[] } | null { /* ... as before ... */ let curr:Node|null=domNode; while(curr&&curr!==this.targetElement){if(curr.nodeType===Node.ELEMENT_NODE){const el=curr as HTMLElement; if(el.id&&el.id.startsWith('ritor-node-')){const pth=this.getModelPathFromDomNode(el); if(pth)return{element:el,path:pth};}else if(this.schema.nodes[el.nodeName.toLowerCase()]?.isBlock){const pth=this.getModelPathFromDomNode(el); if(pth)return{element:el,path:pth};}} curr=curr.parentNode;} return null;}
  private areDocsEffectivelyEqual(docA: DocNode, docB: DocNode): boolean { /* ... as before ... */ if(docA.content.length!==docB.content.length)return false; return JSON.stringify(docA)===JSON.stringify(docB);}
  private handleMutations(mutations: MutationRecord[]): void { /* ... as before, with Promise.resolve().then() ... */
    if(this.isProcessingMutations||this.isComposing)return; this.isProcessingMutations=true;
    let changedBlockInfo:{element:HTMLElement,path:number[]}|null=null; let fullResyncNeeded=false;
    for(const mut of mutations){if(mut.type==='attributes'&&mut.target===this.targetElement)continue; const pBI=this.findClosestBlockParentInfo(mut.target); if(pBI){if(!changedBlockInfo||pBI.path.length<changedBlockInfo.path.length)changedBlockInfo=pBI;}else{fullResyncNeeded=true;break;} if(mut.type==='childList'&&(mut.addedNodes.length>0||mut.removedNodes.length>0)){Array.from(mut.addedNodes).concat(Array.from(mut.removedNodes)).forEach(n=>{if(n.nodeType===Node.ELEMENT_NODE&&this.schema.nodes[(n as HTMLElement).nodeName.toLowerCase()]?.isBlock)fullResyncNeeded=true;}); if(mut.target===this.targetElement)fullResyncNeeded=true;} if(fullResyncNeeded)break;}
    if(!changedBlockInfo&&mutations.length>0&&!fullResyncNeeded){if(mutations.length===1&&mutations[0].target.nodeType===Node.ELEMENT_NODE){const bI=this.findClosestBlockParentInfo(mutations[0].target); if(bI)changedBlockInfo=bI; else fullResyncNeeded=true;}else fullResyncNeeded=true;}
    Promise.resolve().then(()=>{if(fullResyncNeeded){console.warn("RitorVDOM: Full DOM re-parse from complex mutations."); const nMNs=this.domParser.parseFragment(this.targetElement); const nDC:BaseNode[]=[]; let cIG:InlineNode[]=[]; for(const n of nMNs){if(n.type.isBlock){if(cIG.length>0){nDC.push(this.schema.nodes.paragraph.create(null,normalizeInlineArray(cIG,this.schema))); cIG=[];} nDC.push(n);}else cIG.push(n as InlineNode);} if(cIG.length>0)nDC.push(this.schema.nodes.paragraph.create(null,normalizeInlineArray(cIG,this.schema))); const nD=this.schema.node(this.schema.nodes.doc,this.currentViewDoc.attrs,nDC)as DocNode; if(nD&&!this.areDocsEffectivelyEqual(this.currentViewDoc,nD)){this.undoManager.add(this.currentViewDoc); this.updateDocument(nD);}else this.isProcessingMutations=false; return;}
    if(changedBlockInfo){const{element:dCBE,path:mBP}=changedBlockInfo; const oMB=nodeAtPath(this.currentViewDoc,mBP); if(!oMB||oMB.isLeafType){console.error("Mutation handler: No model block or is leaf.",mBP); this.isProcessingMutations=false; return;} const nPINs=this.domParser.parseFragment(dCBE); const nNIC=normalizeInlineArray(nPINs as InlineNode[],this.schema); const nMBlk=this.schema.node(oMB.type,oMB.attrs,nNIC,oMB.marks); const nD=replaceNodeAtPath(this.currentViewDoc,mBP,nMBlk,this.schema)as DocNode|null; if(nD&&!this.areDocsEffectivelyEqual(this.currentViewDoc,nD)){this.undoManager.add(this.currentViewDoc); this.updateDocument(nD);}else this.isProcessingMutations=false; return;}
    this.isProcessingMutations=false;}).catch(e=>{console.error("Error in mutation handling:",e); this.isProcessingMutations=false;});
  }
  public setFocus(): void { /* ... as before ... */ this.targetElement.focus(); if(this.currentModelSelection) this.applyModelSelectionToDom(this.currentModelSelection); else this.ensureInitialSelection(); }
  public undo(): void { /* ... as before ... */ const pS = this.undoManager.undo(); if (pS) this.updateDocument(pS); }
  public redo(): void { /* ... as before ... */ const nS = this.undoManager.redo(); if (nS) this.updateDocument(nS); }
  private _isMarkActiveInSelection(markType: MarkType, attrs: Attrs | undefined, selection: ModelSelection): boolean { /* ... as before ... */
    if(this.arePositionsEqual(selection.anchor,selection.head)){const mAC=this.getMarksAtPosition(this.currentViewDoc,selection.anchor); return mAC.some(m=>m.type===markType&&(!attrs||m.eq(markType.create(attrs))));}
    const fF=modelPositionToFlatOffset(this.currentViewDoc,selection.anchor,this.schema); const fT=modelPositionToFlatOffset(this.currentViewDoc,selection.head,this.schema);
    const tNs=findTextNodesInRange(this.currentViewDoc,Math.min(fF,fT),Math.max(fF,fT),this.schema); if(tNs.length===0)return false;
    for(const seg of tNs){if(seg.startOffsetInNode===seg.endOffsetInNode)continue; const mOS=seg.node.marks||[]; const fM=mOS.some(m=>{if(m.type!==markType)return false; if(attrs){let aAM=true; for(const k in attrs)if(m.attrs[k]!==attrs[k]){aAM=false;break;} return aAM;} return true;}); if(!fM)return false;} return true;
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
    let ch=false; const nC=(doc.content||[]).map(bN=>{let cB=bN; if(!cB.attrs||cB.attrs.id==null){ch=true; const nA={...cB.attrs,id:this.schema.generateNodeId()}; cB=this.schema.node(cB.type,nA,cB.content,cB.marks);} if(cB.content&&(cB.type.name==='list_item'||cB.type.name==='blockquote')){ const tTFR =this.schema.nodes[cB.type.name]||cB.type; const tID={type:tTFR,content:cB.content,attrs:cB.attrs,nodeSize:cB.nodeSize}as DocNode; const nID=this.ensureBlockIds(tID); if(nID.content!==cB.content){ch=true;cB=this.schema.node(cB.type,cB.attrs,nID.content,cB.marks);}} return cB;}); if(ch)return this.schema.node(doc.type,doc.attrs,nC)as DocNode; return doc;
  }
}

console.log("RitorVDOM.ts: Integrated DOMParser into paste handling (using openStart/End) and mutation handling (PoC).");
