// src/RitorVDOM.ts
import { Schema, NodeType as RitorNodeType } from './schema.js'; // Renamed NodeType to RitorNodeType to avoid conflict
import { DocNode, BaseNode, TextNode, InlineNode, Mark } from './documentModel.js';
import { DomPatcher } from './domPatcher.js';
import { modelPositionToFlatOffset, flatOffsetToModelPosition, normalizeInlineArray, nodeAtPath, findTextNodesInRange, replaceNodeAtPath, isPositionAtStartOfBlockContent, areNodesEffectivelyEqual } from './modelUtils.js'; // Added isPositionAtStartOfBlockContent and areNodesEffectivelyEqual
import { ModelPosition, ModelSelection } from './selection.js';
import { UndoManager } from './undoManager.js';
import { diffFragment } from './transform/diff.js'; // Added diffFragment import
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
    this.updateModelSelectionState(); // Ensure currentModelSelection is fresh
    const selection = this.currentModelSelection;
    if (!selection) {
      console.warn("applyChange called without a currentModelSelection.");
      return;
    }

    const doc = this.currentViewDoc;
    const schema = this.schema;
    const tr = new Transaction(doc, selection, schema);
    const flatAnchor = modelPositionToFlatOffset(doc, selection.anchor, schema);
    const flatHead = modelPositionToFlatOffset(doc, selection.head, schema);

    let newCursorPos: ModelPosition | null = null;

    switch (change.type) {
      case 'insertText':
        if (change.text) {
          const from = Math.min(flatAnchor, flatHead);
          const to = Math.max(flatAnchor, flatHead);
          const marks = this.getMarksAtPosition(doc, selection.anchor);
          const textNode = schema.text(change.text, marks);
          tr.replace(from, to, Slice.fromFragment([textNode]));
          const newFlatPos = from + textNode.text.length;
          newCursorPos = flatOffsetToModelPosition(tr.doc, newFlatPos, schema);
          if (newCursorPos) tr.setSelection({ anchor: newCursorPos, head: newCursorPos });
        }
        break;
      
      case 'deleteContentBackward':
        if (flatAnchor !== flatHead) { // Non-collapsed selection
          const from = Math.min(flatAnchor, flatHead);
          const to = Math.max(flatAnchor, flatHead);
          tr.delete(from, to);
          newCursorPos = flatOffsetToModelPosition(tr.doc, from, schema);
          if (newCursorPos) tr.setSelection({ anchor: newCursorPos, head: newCursorPos });
        } else { // Collapsed selection
          if (flatAnchor === 0) return; // Cannot delete before start of doc

          const modelAnchorPos = flatOffsetToModelPosition(doc, flatAnchor, schema);
          let blockPath: number[] | null = null;
          let currentBlockNode: BaseNode | null = null;
          let blockNodeIndex = -1;

          if (modelAnchorPos && modelAnchorPos.path.length > 0) {
            // If path points to text node, block path is parent. If points to block (e.g. empty para), it's that path.
            const nodeAtPos = nodeAtPath(doc, modelAnchorPos.path);
            if (nodeAtPos?.isText) {
              blockPath = modelAnchorPos.path.slice(0, -1);
            } else if (nodeAtPos?.type.isBlock) { // Should not happen if cursor is "in" a block.
              blockPath = modelAnchorPos.path;
            }
            if (blockPath && blockPath.length > 0) { // Top-level blocks are children of doc
                currentBlockNode = nodeAtPath(doc, blockPath);
                blockNodeIndex = blockPath[blockPath.length-1]; // This is index in parent (doc.content)
            } else if (blockPath && blockPath.length === 0 && nodeAtPos?.type.name === 'doc') {
                // This means modelAnchorPos.path pointed to the doc node itself.
                // This shouldn't happen for a cursor inside a deletable block.
                // Or if modelAnchorPos.path was empty, meaning cursor in doc, offset based.
                // This needs careful check for what modelAnchorPos looks like for cursor in first child of doc.
                // For now, assume blockPath will be established if cursor is in a block.
            }
          }
          
          // Ensure blockPath is relative to doc.content for blockNodeIndex
          if (blockPath && blockPath.length !== 1 && currentBlockNode) { 
            // If blockPath is deeper, e.g. [0,0] for li in ul, this simple merge won't work.
            // For now, only merge top-level blocks.
            // console.warn("Block merging currently only supports top-level blocks."); // Keep console.warn for now
            currentBlockNode = null; // Disable merge for nested blocks for now
          }


          if (currentBlockNode && currentBlockNode.type.isBlock && blockPath && blockNodeIndex > 0 &&
              isPositionAtStartOfBlockContent(doc, modelAnchorPos!, blockPath, schema)) { // Removed this.modelUtils
            
            const prevBlockPath = [blockNodeIndex - 1];
            const prevBlock = nodeAtPath(doc, prevBlockPath);

            if (prevBlock && prevBlock.type.isTextBlock && currentBlockNode.type.isTextBlock && prevBlock.content && currentBlockNode.content) {
              // Perform Merge
              const prevBlockContent = prevBlock.content as ReadonlyArray<BaseNode>;
              const currentBlockContent = currentBlockNode.content as ReadonlyArray<BaseNode>;
              
              // Store original length of prevBlock's content for cursor positioning
              let originalPrevBlockContentLength = 0;
              for(const node of prevBlockContent) originalPrevBlockContentLength += node.nodeSize;


              const mergedInlineContent = normalizeInlineArray([...prevBlockContent, ...currentBlockContent], schema);
              const newPrevBlock = schema.node(prevBlock.type, prevBlock.attrs, mergedInlineContent);
              
              const startOfPrevBlockFlat = modelPositionToFlatOffset(doc, { path: prevBlockPath, offset: 0 }, schema);
              // End of current block: start of current block + its nodeSize
              const startOfCurrentBlockFlat = modelPositionToFlatOffset(doc, { path: blockPath, offset: 0 }, schema);
              const endOfCurrentBlockFlat = startOfCurrentBlockFlat + currentBlockNode.nodeSize;

              tr.replace(startOfPrevBlockFlat, endOfCurrentBlockFlat, Slice.fromFragment([newPrevBlock]));
              
              // New cursor position: at the end of what was originally prevBlock's content
              const newCursorFlatPos = startOfPrevBlockFlat + 1 /* open tag for newPrevBlock */ + originalPrevBlockContentLength;
              newCursorPos = flatOffsetToModelPosition(tr.doc, newCursorFlatPos, schema);
              if (newCursorPos) tr.setSelection({ anchor: newCursorPos, head: newCursorPos });

            } else { // Not mergeable types or no content, fallback to char delete
              tr.delete(flatAnchor - 1, flatAnchor);
              newCursorPos = flatOffsetToModelPosition(tr.doc, flatAnchor - 1, schema);
              if (newCursorPos) tr.setSelection({ anchor: newCursorPos, head: newCursorPos });
            }
          } else { // Not at start of a mergeable block, or it's the first block
            tr.delete(flatAnchor - 1, flatAnchor);
            newCursorPos = flatOffsetToModelPosition(tr.doc, flatAnchor - 1, schema);
            if (newCursorPos) tr.setSelection({ anchor: newCursorPos, head: newCursorPos });
          }
        }
        break;

      case 'deleteContentForward':
        if (flatAnchor !== flatHead) { // Non-collapsed selection
          const from = Math.min(flatAnchor, flatHead);
          const to = Math.max(flatAnchor, flatHead);
          tr.delete(from, to);
          newCursorPos = flatOffsetToModelPosition(tr.doc, from, schema);
          if (newCursorPos) tr.setSelection({ anchor: newCursorPos, head: newCursorPos });
        } else { // Collapsed selection
          if (flatAnchor === doc.contentSize) return; // Cannot delete after end of doc content
          tr.delete(flatAnchor, flatAnchor + 1);
          newCursorPos = flatOffsetToModelPosition(tr.doc, flatAnchor, schema);
          if (newCursorPos) tr.setSelection({ anchor: newCursorPos, head: newCursorPos });
        }
        break;

      case 'insertParagraph':
        const fromIP = Math.min(flatAnchor, flatHead);
        const toIP = Math.max(flatAnchor, flatHead);
        const newPara = schema.node(schema.nodes.paragraph, {}, [schema.text('')]);
        tr.replace(fromIP, toIP, Slice.fromFragment([newPara]));
        const newParaStartFlatPos = fromIP + 1; // After the opening tag of the new paragraph
        newCursorPos = flatOffsetToModelPosition(tr.doc, newParaStartFlatPos, schema);
        if (newCursorPos) tr.setSelection({ anchor: newCursorPos, head: newCursorPos });
        break;
        
      default:
        return;
    }

    tr.scrollIntoView(); // May need to be conditional or smarter
    if (tr.stepsApplied) {
      if (!this.domPatcher.areNodesEffectivelyEqual(this.currentViewDoc, tr.doc)) { // Check if document actually changed
          this.undoManager.add(this.currentViewDoc);
      }
      this.updateDocument(tr);
    }
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
  private findClosestBlockParentInfo(domNode: Node | null): { element: HTMLElement, path: number[], node: BaseNode } | null {
    let curr: Node | null = domNode;
    while (curr && curr !== this.targetElement) {
        if (curr.nodeType === Node.ELEMENT_NODE) {
            const el = curr as HTMLElement;
            const elName = el.nodeName.toLowerCase();
            // Check if ID indicates a Ritor-managed block node
            if (el.id && el.id.startsWith('ritor-node-')) {
                const modelPath = this.getModelPathFromDomNode(el); // This needs to be robust
                if (modelPath) {
                    const modelNode = nodeAtPath(this.currentViewDoc, modelPath);
                    if (modelNode) return { element: el, path: modelPath, node: modelNode };
                }
            }
            // Fallback: check if tag name is a known block type (less reliable if no IDs)
            const nodeType = this.schema.nodes[elName];
            if (nodeType?.isBlock) {
                const modelPath = this.getModelPathFromDomNode(el);
                if (modelPath) {
                    const modelNode = nodeAtPath(this.currentViewDoc, modelPath);
                    if (modelNode) return { element: el, path: modelPath, node: modelNode };
                }
            }
        }
        curr = curr.parentNode;
    }
    return null;
  }

  private areDocsEffectivelyEqual(docA: DocNode, docB: DocNode): boolean { 
      // This now uses the utility from modelUtils
      return areNodesEffectivelyEqual(docA, docB);
  }

  private ensureBlocksAtTopLevel(nodes: BaseNode[]): BaseNode[] {
    const result: BaseNode[] = [];
    let currentInlineGroup: InlineNode[] = [];
    for (const node of nodes) {
        if (node.type.isBlock) {
            if (currentInlineGroup.length > 0) {
                result.push(this.schema.nodes.paragraph.create(null, normalizeInlineArray(currentInlineGroup, this.schema)));
                currentInlineGroup = [];
            }
            result.push(node);
        } else { // Inline or Text node
            currentInlineGroup.push(node as InlineNode);
        }
    }
    if (currentInlineGroup.length > 0) {
        result.push(this.schema.nodes.paragraph.create(null, normalizeInlineArray(currentInlineGroup, this.schema)));
    }
    return result;
  }

  private handleMutations(mutations: MutationRecord[]): void {
    if (this.isProcessingMutations || this.isComposing) return;
    this.isProcessingMutations = true;
    let mutationsProcessedThisTurn = false;

    // Simplified logic: Try to find a single changed block first.
    // More complex mutation patterns will trigger full resync.
    let changedBlockInfo: { element: HTMLElement, path: number[], node: BaseNode } | null = null;
    let fullResyncNeeded = false;

    for (const mut of mutations) {
        if (mut.type === 'attributes' && mut.target === this.targetElement) continue; // Ignore root attributes
        
        const blockInfo = this.findClosestBlockParentInfo(mut.target);
        if (blockInfo) {
            if (!changedBlockInfo) { // First identified block
                changedBlockInfo = blockInfo;
            } else if (changedBlockInfo.path.join(',') !== blockInfo.path.join(',')) {
                // Mutation spans multiple known blocks or is outside a single identifiable block
                fullResyncNeeded = true;
                break;
            }
        } else { // Mutation target not within a known block structure
            fullResyncNeeded = true;
            break;
        }
        // If childList changes involve adding/removing Ritor block nodes, also trigger full resync
        if (mut.type === 'childList') {
             const affectedNodes = [...Array.from(mut.addedNodes), ...Array.from(mut.removedNodes)];
             if (affectedNodes.some(n => n.nodeType === Node.ELEMENT_NODE && this.findClosestBlockParentInfo(n))) {
                 // If a Ritor block node was added/removed, it's safer to resync the whole content for now
                 fullResyncNeeded = true;
                 break;
             }
        }
    }
    if (mutations.length > 0 && !changedBlockInfo && !fullResyncNeeded) { // No specific block found, but mutations exist
        fullResyncNeeded = true;
    }


    Promise.resolve().then(() => {
        if (fullResyncNeeded) {
            console.warn("RitorVDOM: Performing full DOM re-parse and diff due to complex/block-level mutations.");
            const parsedResult = this.domParser.parseFragment(this.targetElement, this.schema.nodes.doc);
            const newDocContentNodesUnwrapped = parsedResult.nodes;
            const newDocContentNodes = this.ensureBlocksAtTopLevel(newDocContentNodesUnwrapped);
            
            const steps = diffFragment(this.currentViewDoc.content, newDocContentNodes, 0, this.schema);

            if (steps.length > 0) {
                this.updateModelSelectionState();
                const tr = new Transaction(this.currentViewDoc, this.currentModelSelection);
                steps.forEach(step => tr.addStep(step));
                if (!areNodesEffectivelyEqual(this.currentViewDoc, tr.doc)) {
                    this.undoManager.add(this.currentViewDoc);
                }
                this.updateDocument(tr);
            }
            mutationsProcessedThisTurn = true;

        } else if (changedBlockInfo) {
            const { element: domChangedBlockElement, path: modelBlockPath, node: oldModelBlock } = changedBlockInfo;
            if (oldModelBlock.isLeafType || !oldModelBlock.type.isTextBlock) { // was isLeafType
                console.error("Mutation handler: Identified block is leaf or not a text block. Reverting to full sync for safety.", oldModelBlock.type.name);
                // Fallback to full resync for this case.
                // This could be triggered by mutations on e.g. an image block's wrapper.
                // A more robust solution would be to diff based on the block type if it's an atom.
                // For now, using the fullResyncNeeded path.
                 fullResyncNeeded = true; // Trigger the above logic path
                 // To avoid infinite loop if fullResyncNeeded path also fails, ensure we exit:
                 if (this.isProcessingMutations) { // If already processing, this is a fallback from fallback
                    this.isProcessingMutations = false;
                    return;
                 }
                 this.handleMutations(mutations); // Re-call to go into full resync path.
                 return;
            }

            const newParsedInlineNodesResult = this.domParser.parseFragment(domChangedBlockElement, oldModelBlock.type);
            const normalizedNewInlineContent = normalizeInlineArray(newParsedInlineNodesResult.nodes as InlineNode[], this.schema);
            const oldInlineContent = (oldModelBlock.content || []) as ReadonlyArray<BaseNode>;

            const blockStartPos: ModelPosition = { path: modelBlockPath, offset: 0 };
            const flatBlockStart = modelPositionToFlatOffset(this.currentViewDoc, blockStartPos, this.schema);
            // +1 for opening tag of the block itself. Atom nodes have nodeSize 1 but no "content" in this sense.
            const blockContentStartFlatOffset = flatBlockStart + (oldModelBlock.type.isLeafType ? 0 : 1); 

            const steps = diffFragment(oldInlineContent, normalizedNewInlineContent, blockContentStartFlatOffset, this.schema);

            if (steps.length > 0) {
                this.updateModelSelectionState();
                const tr = new Transaction(this.currentViewDoc, this.currentModelSelection);
                steps.forEach(step => tr.addStep(step));
                
                if (!areNodesEffectivelyEqual(this.currentViewDoc, tr.doc)) {
                     this.undoManager.add(this.currentViewDoc);
                }
                this.updateDocument(tr);
            }
            mutationsProcessedThisTurn = true;
        }

        this.isProcessingMutations = false;
    }).catch(e => {
        console.error("Error in mutation handling:", e);
        this.isProcessingMutations = false;
    });
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
