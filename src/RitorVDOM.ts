import {
  AnyMark,
  BaseNode,
  TextNode as ModelTextNode,
} from './documentModel.js';
import { DomPatcher } from './domPatcher.js';
import { Schema } from './schema.js';
import { basicNodeSpecs, basicMarkSpecs } from './basicSchema.js';
import { NodeType, MarkType } from './schema.js';
import { ModelUtils } from './modelUtils.js';
import { ModelSelection, ModelPosition } from './selection.js';
import { UndoManager } from './undoManager.js'; // Import UndoManager

// Definition for SimpleChange for PoC selection mapping
type SimpleChange =
  | { type: 'insertText'; path: number[]; offset: number; length: number } // path to text node
  | { type: 'deleteText'; path: number[]; offset: number; length: number } // path to text node
  | { type: 'splitNode'; path: number[]; offset: number; // path to text node being split (or path to para, inline index of split)
      newParaPathIndex: number; // index of the new paragraph in doc.content
    };

export class RitorVDOM {
  public $el: HTMLElement;
  public currentViewDoc: BaseNode;
  private domPatcher: DomPatcher;
  public readonly schema: Schema;
  private modelUtils: ModelUtils;
  private undoManager: UndoManager; // Added UndoManager property
  private isReconciling: boolean = false;
  private observer: MutationObserver;
  public currentModelSelection: ModelSelection | null = null;
  private lastAppliedChange: SimpleChange | null = null;

  constructor(target: string | HTMLElement, schema?: Schema) {
    if (typeof target === 'string') {
      const element = document.querySelector(target) as HTMLElement;
      if (!element) {
        throw new Error(`Target element "${target}" not found.`);
      }
      this.$el = element;
    } else {
      this.$el = target;
    }

    this.schema = schema || new Schema({ nodes: basicNodeSpecs, marks: basicMarkSpecs });
    this.modelUtils = new ModelUtils(this.schema);
    this.undoManager = new UndoManager(); // Instantiate UndoManager

    this.currentViewDoc = this.schema.node("doc", null, [
      this.schema.node("paragraph", null, [
        ...this.modelUtils.normalizeInlineArray([this.schema.text("Hello VDOM world!")])
      ])
    ]);

    if (this.currentViewDoc) { // Add initial state to undo manager
        this.undoManager.add(this.currentViewDoc);
    }

    this.domPatcher = new DomPatcher(this.$el, this.currentViewDoc, this.schema);
    this.$el.contentEditable = 'true';

    this.$el.addEventListener('keydown', (event: KeyboardEvent) => {
      let handled = false;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        if (event.shiftKey) { // Ctrl+Shift+Z or Cmd+Shift+Z for redo
          this.redo();
        } else { // Ctrl+Z or Cmd+Z for undo
          this.undo();
        }
        handled = true;
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
        this.redo();
        handled = true;
      }
      // Removed specific Enter key log here as it's handled by beforeinput.
      // Other specific keydown logic could be added here.

      if (handled) {
        event.preventDefault();
      }
    });

    this.observer = new MutationObserver(this.handleMutations.bind(this));
    this.observer.observe(this.$el, {
      childList: true, characterData: true, subtree: true,
    });

    this.$el.addEventListener('beforeinput', this.handleBeforeInput.bind(this));
    this.$el.addEventListener('focus', this.updateModelSelectionState.bind(this));
    this.$el.addEventListener('mouseup', this.updateModelSelectionState.bind(this));
    this.$el.addEventListener('keyup', this.updateModelSelectionState.bind(this));
  }

  // ... (domToModelPosition, mapDomSelectionToModel, updateModelSelectionState, modelToDomPosition, applyModelSelectionToDom remain unchanged from previous correct state)
  // TODO: SELECTION MAPPING - CRITICAL FOR ROBUSTNESS (domToModelPosition)
  private domToModelPosition(domNode: globalThis.Node, domOffset: number): ModelPosition | null {
    let containingElement: HTMLElement | null = null;
    let charOffsetInElement = 0;

    if (domNode.nodeType === Node.TEXT_NODE) {
      containingElement = domNode.parentNode as HTMLElement;
      charOffsetInElement = domOffset;
      let previousSibling = domNode.previousSibling;
      while (previousSibling) {
        charOffsetInElement += (previousSibling.textContent || '').length;
        previousSibling = previousSibling.previousSibling;
      }
    } else if (domNode.nodeType === Node.ELEMENT_NODE) {
      containingElement = domNode as HTMLElement;
      charOffsetInElement = domOffset;
    }

    if (!containingElement) return null;

    let domParagraphElement: HTMLElement | null = containingElement;
    while (domParagraphElement && domParagraphElement !== this.$el && domParagraphElement.nodeName !== 'P') {
      domParagraphElement = domParagraphElement.parentNode as HTMLElement;
    }

    if (!domParagraphElement || domParagraphElement.nodeName !== 'P') {
        if (containingElement === this.$el && this.$el.children.length > 0 && domOffset < this.$el.children.length) {
            const targetPara = this.$el.children[domOffset] as HTMLElement;
            if (targetPara && targetPara.nodeName === 'P') {
                domParagraphElement = targetPara;
                charOffsetInElement = 0;
            } else { return null; }
        } else { return null; }
    }

    const modelParaIndex = Array.from(this.$el.children).indexOf(domParagraphElement);
    if (modelParaIndex === -1) return null;

    const modelParagraph = this.currentViewDoc.content?.[modelParaIndex];
    if (!modelParagraph || !modelParagraph.content) return { path: [modelParaIndex], offset: 0 };

    let currentLength = 0;
    for (let i = 0; i < modelParagraph.content.length; i++) {
        const inlineNode = modelParagraph.content[i];
        const nodeType = inlineNode.type as NodeType;
        if (nodeType.isText) {
            const textLen = (inlineNode as ModelTextNode).text.length;
            if (charOffsetInElement <= currentLength + textLen) {
                return { path: [modelParaIndex, i], offset: charOffsetInElement - currentLength };
            }
            currentLength += textLen;
        } else {
            if (charOffsetInElement <= currentLength + 1) {
                return { path: [modelParaIndex, i], offset: charOffsetInElement - currentLength };
            }
            currentLength += 1;
        }
    }
    const lastInlineNodeIndex = modelParagraph.content.length > 0 ? modelParagraph.content.length - 1 : 0;
    const lastInlineNode = modelParagraph.content[lastInlineNodeIndex] as ModelTextNode | undefined;
    let offsetInLastNode = 0;
    if (lastInlineNode) {
        if ((lastInlineNode.type as NodeType).isText) {
            offsetInLastNode = lastInlineNode.text.length;
        } else { offsetInLastNode = 1; }
    }
    if (charOffsetInElement > currentLength) {
        return { path: [modelParaIndex, lastInlineNodeIndex], offset: offsetInLastNode };
    }
    if (modelParagraph.content.length === 0) {
        return { path: [modelParaIndex], offset: 0 };
    }
    return { path: [modelParaIndex, lastInlineNodeIndex], offset: offsetInLastNode };
  }

  private mapDomSelectionToModel(): ModelSelection | null {
    const domSel = window.getSelection();
    if (!domSel || domSel.rangeCount === 0) return null;
    const anchorPos = this.domToModelPosition(domSel.anchorNode!, domSel.anchorOffset);
    const headPos = this.domToModelPosition(domSel.focusNode!, domSel.focusOffset);
    if (anchorPos && headPos) return { anchor: anchorPos, head: headPos };
    return null;
  }

  private updateModelSelectionState(): void {
    if (this.isReconciling) return;
    this.currentModelSelection = this.mapDomSelectionToModel();
  }

  private modelToDomPosition(modelPos: ModelPosition): { node: globalThis.Node; offset: number } | null {
    if (!this.currentViewDoc.content || modelPos.path.length === 0) return null;
    const paraIndex = modelPos.path[0];
    const domParagraph = this.$el.children[paraIndex] as HTMLElement;
    if (!domParagraph) return null;

    if (modelPos.path.length === 1) {
      if (!domParagraph.firstChild && modelPos.offset === 0) return { node: domParagraph, offset: 0 };
      if (modelPos.offset < domParagraph.childNodes.length) return { node: domParagraph, offset: modelPos.offset };
      else if (domParagraph.childNodes.length === 0 && modelPos.offset === 0) return { node: domParagraph, offset: 0 };
      const lastChild = domParagraph.lastChild;
      return { node: lastChild || domParagraph, offset: lastChild ? (lastChild.textContent || "").length : 0};
    }

    const inlineNodeIndex = modelPos.path[1];
    if (!domParagraph.childNodes || inlineNodeIndex >= domParagraph.childNodes.length) {
        if (inlineNodeIndex === domParagraph.childNodes.length && modelPos.offset === 0) {
            if (domParagraph.lastChild) return { node: domParagraph.lastChild, offset: (domParagraph.lastChild.nodeType === Node.TEXT_NODE ? (domParagraph.lastChild.textContent || "").length : 1) };
            else return { node: domParagraph, offset: 0 };
        }
        return { node: domParagraph, offset: 0 };
    }
    const targetDomInlineNode = domParagraph.childNodes[inlineNodeIndex];
    if (!targetDomInlineNode) return { node: domParagraph, offset: 0 };
    if (targetDomInlineNode.nodeType === Node.TEXT_NODE) return { node: targetDomInlineNode, offset: Math.min(modelPos.offset, (targetDomInlineNode.textContent || "").length) };
    else return { node: domParagraph, offset: inlineNodeIndex + modelPos.offset };
  }

  private applyModelSelectionToDom(modelSelection: ModelSelection | null): void {
    if (!modelSelection) return;
    const domAnchor = this.modelToDomPosition(modelSelection.anchor);
    const domHead = this.modelToDomPosition(modelSelection.head);
    if (!domAnchor || !domHead) return;
    const domSel = window.getSelection();
    if (!domSel) return;
    try {
      domSel.removeAllRanges();
      const range = document.createRange();
      range.setStart(domAnchor.node, domAnchor.offset);
      range.setEnd(domHead.node, domHead.offset);
      domSel.addRange(range);
    } catch (e) {
      console.error("applyModelSelectionToDom: Error setting DOM selection:", e, {domAnchor, domHead});
    }
  }


  private handleBeforeInput(event: InputEvent): void {
    this.updateModelSelectionState();
    if (this.isReconciling) return;

    if (!this.currentModelSelection) {
        console.warn("RitorVDOM: Could not map DOM selection for beforeinput.");
        if (['insertText', 'insertParagraph', 'deleteContentBackward', 'deleteContentForward'].includes(event.inputType)) {
            event.preventDefault(); return;
        }
    }
    const currentModelPos = this.currentModelSelection?.anchor;
    if (!currentModelPos) {
        if (['insertText', 'insertParagraph', 'deleteContentBackward', 'deleteContentForward'].includes(event.inputType)) {
            console.warn(`RitorVDOM: No valid model position for ${event.inputType}.`);
            event.preventDefault(); return;
        }
    }

    let newDoc: BaseNode | null = null;
    this.lastAppliedChange = null;

    if (event.inputType === 'insertText' && event.data && currentModelPos) {
      event.preventDefault();
      const modelParaIndex = currentModelPos.path[0];
      const modelInlineNodeIndex = currentModelPos.path.length > 1 ? currentModelPos.path[1] : -1;
      const textOffset = currentModelPos.offset;
      const modelParagraph = this.currentViewDoc.content?.[modelParaIndex];
      if (!modelParagraph ) { console.warn("InsertText: Para not found"); return; }
      const paragraphContent = modelParagraph.content || [];
      let newInlineContent: BaseNode[];
      const targetModelTextNode = paragraphContent?.[modelInlineNodeIndex] as ModelTextNode | undefined;

      if (targetModelTextNode && targetModelTextNode.type.name === 'text') {
        const newText = targetModelTextNode.text.slice(0, textOffset) + event.data + targetModelTextNode.text.slice(textOffset);
        newInlineContent = [...paragraphContent];
        newInlineContent[modelInlineNodeIndex] = this.schema.text(newText, targetModelTextNode.marks);
        this.lastAppliedChange = { type: 'insertText', path: [modelParaIndex, modelInlineNodeIndex], offset: textOffset, length: event.data.length};
      } else if ( (paragraphContent.length === 0 || modelInlineNodeIndex === -1 || modelInlineNodeIndex === paragraphContent.length) && textOffset === 0 ) {
        const newTextNode = this.schema.text(event.data || "");
        const targetInlineIdx = (modelInlineNodeIndex === -1 || paragraphContent.length === 0) ? 0 : modelInlineNodeIndex;
        if(modelInlineNodeIndex === -1 || paragraphContent.length === 0) { // Empty paragraph
            newInlineContent = [newTextNode];
        } else {
            newInlineContent = [...paragraphContent];
            newInlineContent.splice(targetInlineIdx, 0, newTextNode);
        }
        this.lastAppliedChange = { type: 'insertText', path: [modelParaIndex, targetInlineIdx], offset: 0, length: event.data.length};
      } else { console.warn("InsertText: Unhandled case for text insertion."); return; }

      const normalizedInlineContent = this.modelUtils.normalizeInlineArray(newInlineContent);
      const updatedParagraph = this.schema.node(modelParagraph.type as NodeType, modelParagraph.attrs, normalizedInlineContent);
      const newDocContent = [...(this.currentViewDoc.content || [])];
      newDocContent[modelParaIndex] = updatedParagraph;
      newDoc = this.schema.node(this.currentViewDoc.type as NodeType, this.currentViewDoc.attrs, newDocContent);

    } else if (event.inputType === 'insertParagraph' && currentModelPos) {
      event.preventDefault();
      const modelParaIndex = currentModelPos.path[0];
      const modelInlineNodeIndex = currentModelPos.path.length > 1 ? currentModelPos.path[1] : -1;
      const textOffset = currentModelPos.offset;
      const modelParagraph = this.currentViewDoc.content?.[modelParaIndex];
      if (!modelParagraph ) { console.warn("InsertParagraph: Para not found"); return; }
      const currentParaContent = modelParagraph.content || [];
      const targetModelTextNode = currentParaContent?.[modelInlineNodeIndex] as ModelTextNode | undefined;
      const textBefore = (targetModelTextNode && targetModelTextNode.type.name === 'text') ? targetModelTextNode.text.slice(0, textOffset) : "";
      const textAfter = (targetModelTextNode && targetModelTextNode.type.name === 'text') ? targetModelTextNode.text.slice(textOffset) : "";
      const marksFromSplit = (targetModelTextNode && targetModelTextNode.type.name === 'text') ? targetModelTextNode.marks || [] : [];
      let resolvedInlineIndex = modelInlineNodeIndex === -1 ? 0 : modelInlineNodeIndex;

      let currentParaInlineNodes: BaseNode[] = [];
      for (let i = 0; i < resolvedInlineIndex; i++) if(currentParaContent[i]) currentParaInlineNodes.push(currentParaContent[i]);
      if (textBefore) currentParaInlineNodes.push(this.schema.text(textBefore, marksFromSplit));
      const nodeAtSplitPoint = currentParaContent[resolvedInlineIndex];
      if (nodeAtSplitPoint && (nodeAtSplitPoint.type as NodeType).name !== 'text' && textOffset === 1) { // Split after an atom node
          currentParaInlineNodes.push(nodeAtSplitPoint);
      }
      currentParaInlineNodes = this.modelUtils.normalizeInlineArray(currentParaInlineNodes);

      let newParaInlineNodes: BaseNode[] = [this.schema.text(textAfter, marksFromSplit)];
      if (nodeAtSplitPoint && (nodeAtSplitPoint.type as NodeType).name !== 'text' && textOffset === 0) { // Split before an atom node
          newParaInlineNodes = [nodeAtSplitPoint, ...newParaInlineNodes];
      }
      for (let i = resolvedInlineIndex + 1; i < currentParaContent.length; i++) if(currentParaContent[i]) newParaInlineNodes.push(currentParaContent[i]);
      newParaInlineNodes = this.modelUtils.normalizeInlineArray(newParaInlineNodes);

      const updatedCurrentParagraph = this.schema.node(modelParagraph.type as NodeType, modelParagraph.attrs, currentParaInlineNodes);
      const newGeneratedParagraph = this.schema.node("paragraph", null, newParaInlineNodes);
      const newDocContent = [...(this.currentViewDoc.content || [])];
      newDocContent.splice(modelParaIndex, 1, updatedCurrentParagraph, newGeneratedParagraph);
      newDoc = this.schema.node(this.currentViewDoc.type as NodeType, this.currentViewDoc.attrs, newDocContent);
      this.lastAppliedChange = {
        type: 'splitNode',
        path: [modelParaIndex, resolvedInlineIndex],
        offset: textOffset,
        newParaPathIndex: modelParaIndex + 1
      };

    } else if ((event.inputType === 'deleteContentBackward' || event.inputType === 'deleteContentForward') && currentModelPos) {
      event.preventDefault();
      const modelParaIndex = currentModelPos.path[0];
      const modelInlineNodeIndex = currentModelPos.path.length > 1 ? currentModelPos.path[1] : -1;
      const textOffset = currentModelPos.offset;
      const modelParagraph = this.currentViewDoc.content?.[modelParaIndex];
      if (!modelParagraph || !modelParagraph.content || modelInlineNodeIndex === -1) { console.warn("Delete: Invalid para/content/inlineIdx"); return; }
      const targetModelTextNode = modelParagraph.content[modelInlineNodeIndex] as ModelTextNode | undefined;
      if (!targetModelTextNode || targetModelTextNode.type.name !== 'text') { console.warn("Delete: Target not text"); return; }
      let newText: string;
      const originalTextLength = targetModelTextNode.text.length;
      if (event.inputType === 'deleteContentBackward') {
        if (textOffset === 0 && modelInlineNodeIndex === 0) { console.log("TODO: Merge on backspace at para start."); return; }
        else if (textOffset === 0 && modelInlineNodeIndex > 0) { console.log("TODO: Merge on backspace at inline start."); return; }
        newText = targetModelTextNode.text.slice(0, textOffset - 1) + targetModelTextNode.text.slice(textOffset);
        this.lastAppliedChange = { type: 'deleteText', path: [modelParaIndex, modelInlineNodeIndex], offset: textOffset - 1, length: 1 };
      } else {
        if (textOffset === originalTextLength && modelInlineNodeIndex === modelParagraph.content.length -1) { console.log("TODO: Merge on delete at para end."); return; }
        else if (textOffset === originalTextLength) { console.log("TODO: Merge on delete at inline end."); return; }
        newText = targetModelTextNode.text.slice(0, textOffset) + targetModelTextNode.text.slice(textOffset + 1);
        this.lastAppliedChange = { type: 'deleteText', path: [modelParaIndex, modelInlineNodeIndex], offset: textOffset, length: 1 };
      }
      const updatedTextNode = this.schema.text(newText, targetModelTextNode.marks);
      let updatedInlineContent = [...modelParagraph.content];
      updatedInlineContent[modelInlineNodeIndex] = updatedTextNode;
      const normalizedInlineContent = this.modelUtils.normalizeInlineArray(updatedInlineContent);
      const updatedParagraph = this.schema.node(modelParagraph.type as NodeType, modelParagraph.attrs, normalizedInlineContent);
      const newDocContent = [...(this.currentViewDoc.content || [])];
      newDocContent[modelParaIndex] = updatedParagraph;
      newDoc = this.schema.node(this.currentViewDoc.type as NodeType, this.currentViewDoc.attrs, newDocContent);
    }

    if (newDoc) {
      this.isReconciling = true;
      // Add to undo stack *before* currentViewDoc is updated
      if (!this.domPatcher.areNodesEffectivelyEqual(this.currentViewDoc, newDoc)) {
        this.undoManager.add(this.currentViewDoc);
      }
      this.updateDocument(newDoc);
    } else {
      this.lastAppliedChange = null;
    }
  }

  private handleMutations(mutations: MutationRecord[], observer: MutationObserver): void {
    if (this.isReconciling) return;
    this.isReconciling = true;
    console.log("RitorVDOM: Handling mutations:", mutations);
    let domChangedParagraph: HTMLElement | null = null;
    let modelParaIndex = -1;
    const charMutation = mutations.find(m => m.type === 'characterData');
    if (charMutation && charMutation.target.parentNode) {
        let potentialPara = charMutation.target.parentNode as HTMLElement;
        while(potentialPara && potentialPara !== this.$el && potentialPara.nodeName !== 'P') potentialPara = potentialPara.parentNode as HTMLElement;
        if (potentialPara && potentialPara !== this.$el && potentialPara.nodeName === 'P') domChangedParagraph = potentialPara;
    }
    if (!domChangedParagraph) {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
            let container = selection.getRangeAt(0).commonAncestorContainer;
            if (container.nodeType === Node.TEXT_NODE) container = container.parentNode!;
            let potentialPara = container as HTMLElement;
            while(potentialPara && potentialPara !== this.$el && potentialPara.nodeName !== 'P') potentialPara = potentialPara.parentNode as HTMLElement;
            if (potentialPara && potentialPara !== this.$el && potentialPara.nodeName === 'P') domChangedParagraph = potentialPara;
        }
    }
    if (!domChangedParagraph && this.$el.children.length === 1 && this.$el.children[0].nodeName === 'P') domChangedParagraph = this.$el.children[0] as HTMLElement;

    if (domChangedParagraph) modelParaIndex = Array.from(this.$el.children).indexOf(domChangedParagraph);
    else { this.isReconciling = false; this.lastAppliedChange = null; return; }

    if (modelParaIndex !== -1 && this.currentViewDoc.content && modelParaIndex < this.currentViewDoc.content.length) {
      const oldModelParagraph = this.currentViewDoc.content[modelParaIndex];
      const oldModelParagraphType = oldModelParagraph.type as NodeType;
      if (oldModelParagraphType.name !== 'paragraph') { this.isReconciling = false; this.lastAppliedChange = null; return; }
      const newInlineNodesFromDOM: BaseNode[] = [];
      if (domChangedParagraph && domChangedParagraph.childNodes) {
          domChangedParagraph.childNodes.forEach(childDomNode => {
            if (childDomNode.nodeType === Node.TEXT_NODE) newInlineNodesFromDOM.push(this.schema.text(childDomNode.textContent || ''));
            else if (childDomNode.nodeType === Node.ELEMENT_NODE) {
              const el = childDomNode as HTMLElement; const textContent = el.textContent || '';
              switch (el.nodeName) {
                case 'STRONG': const m = this.schema.marks.bold; newInlineNodesFromDOM.push(this.schema.text(textContent, m ? [m.create()] : [])); break;
                case 'EM': const mI = this.schema.marks.italic; newInlineNodesFromDOM.push(this.schema.text(textContent, mI ? [mI.create()] : [])); break;
                case 'BR': newInlineNodesFromDOM.push(this.schema.node("hard_break")); break;
                default: newInlineNodesFromDOM.push(this.schema.text(textContent));
              }
            }
          });
      }
      const normalizedInlineContent = this.modelUtils.normalizeInlineArray(newInlineNodesFromDOM);
      const newModelParagraph = this.schema.node(oldModelParagraphType, oldModelParagraph.attrs, normalizedInlineContent);
      const newDocContent = [...(this.currentViewDoc.content || [])];
      newDocContent[modelParaIndex] = newModelParagraph;
      const newDoc = this.schema.node(this.currentViewDoc.type as NodeType, this.currentViewDoc.attrs, newDocContent);

      if (!this.domPatcher.areNodesEffectivelyEqual(this.currentViewDoc, newDoc)) {
        this.undoManager.add(this.currentViewDoc);
      }
      this.updateDocument(newDoc);
    } else console.warn("RitorVDOM: Changed paragraph not found in model or model out of sync.");

    Promise.resolve().then(() => {
        this.isReconciling = false;
        this.updateModelSelectionState();
        this.lastAppliedChange = null;
    });
  }

  // Simple position mapping - PoC
  private mapModelPosition(pos: ModelPosition, change: SimpleChange): ModelPosition {
    let { path: currentPath, offset: currentOffset } = pos;
    let newPath = [...currentPath];

    if (!currentPath || currentPath.length === 0 || !change.path || change.path.length === 0) {
      return { path: newPath, offset: currentOffset };
    }

    const changeParaIndex = change.path[0];
    const posParaIndex = newPath[0];

    if (changeParaIndex !== posParaIndex) {
        if (change.type === 'splitNode') {
            if (change.newParaPathIndex <= posParaIndex) {
                newPath[0] += 1;
            }
        }
        return { path: newPath, offset: currentOffset };
    }

    const changeInlineIndex = change.path.length > 1 ? change.path[1] : -1;
    const posInlineIndex = newPath.length > 1 ? newPath[1] : -1;

    if (change.type === 'insertText') {
        if (posInlineIndex === changeInlineIndex && currentOffset >= change.offset) {
            currentOffset += change.length;
        }
    } else if (change.type === 'deleteText') {
        if (posInlineIndex === changeInlineIndex) {
            if (currentOffset > change.offset + change.length) {
                currentOffset -= change.length;
            } else if (currentOffset > change.offset) {
                currentOffset = change.offset;
            }
        }
    } else if (change.type === 'splitNode') {
        const splitAtInlineIndex = change.path[1];
        if (posInlineIndex === splitAtInlineIndex && currentOffset >= change.offset) {
            newPath[0] = change.newParaPathIndex;
            newPath[1] = 0;
            currentOffset = currentOffset - change.offset;
        } else if (posInlineIndex > splitAtInlineIndex) {
            newPath[0] = change.newParaPathIndex;
            newPath[1] = posInlineIndex - (splitAtInlineIndex + 1);
        }
    }
    return { path: newPath, offset: currentOffset };
  }


  public updateDocument(newDoc: BaseNode): void {
    let selectionToRestore = this.currentModelSelection;

    if (selectionToRestore && this.lastAppliedChange) {
        const mappedAnchor = this.mapModelPosition(selectionToRestore.anchor, this.lastAppliedChange);
        const mappedHead = this.mapModelPosition(selectionToRestore.head, this.lastAppliedChange);
        selectionToRestore = { anchor: mappedAnchor, head: mappedHead };
    }

    this.lastAppliedChange = null;

    if (this.currentViewDoc && (this.currentViewDoc === newDoc || this.domPatcher.areNodesEffectivelyEqual(this.currentViewDoc, newDoc))) {
       if(selectionToRestore) this.applyModelSelectionToDom(selectionToRestore);
       this.updateModelSelectionState();
       // If isReconciling was true because of a beforeinput that resulted in an effectively same doc,
       // we need to ensure it's reset.
       if (this.isReconciling) { // Check if we were in a reconcile cycle from beforeinput
           Promise.resolve().then(() => { this.isReconciling = false; });
       }
       return;
    }

    if (newDoc.type !== this.schema.topNodeType) {
        console.error(`Invalid document root type. Expected ${this.schema.topNodeType.name}, got ${(newDoc.type as NodeType).name}`);
        if (this.isReconciling) { // Ensure isReconciling is reset even on error
            Promise.resolve().then(() => { this.isReconciling = false; });
        }
        return;
    }

    // const oldDocForUndo = this.currentViewDoc; // This is moved to handleBeforeInput/handleMutations

    this.currentViewDoc = newDoc;
    this.domPatcher.patch(this.currentViewDoc);

    if (selectionToRestore) {
        this.applyModelSelectionToDom(selectionToRestore);
    }
    this.updateModelSelectionState();

    console.log("Document updated successfully.");
    console.log("Current HTML:", this.$el.innerHTML);

    // Ensure isReconciling is reset after a successful patch cycle initiated by handleBeforeInput or handleMutations
    if (this.isReconciling) {
        Promise.resolve().then(() => { this.isReconciling = false; });
    }
  }

  public undo(): void {
    if (!this.undoManager.hasUndo()) {
        console.log("Nothing to undo");
        return;
    }
    const prevState = this.undoManager.undo(this.currentViewDoc);
    if (prevState) {
        this.isReconciling = true; // Prevent mutations during undo/redo patch
        this.currentViewDoc = prevState;
        this.domPatcher.patch(this.currentViewDoc);
        this.lastAppliedChange = null;
        this.updateModelSelectionState();
        console.log("Undo performed.");
        Promise.resolve().then(() => { this.isReconciling = false; });
    }
  }

  public redo(): void {
    if (!this.undoManager.hasRedo()) {
        console.log("Nothing to redo");
        return;
    }
    const nextState = this.undoManager.redo(this.currentViewDoc);
    if (nextState) {
        this.isReconciling = true; // Prevent mutations during undo/redo patch
        this.currentViewDoc = nextState;
        this.domPatcher.patch(this.currentViewDoc);
        this.lastAppliedChange = null;
        this.updateModelSelectionState();
        console.log("Redo performed.");
        Promise.resolve().then(() => { this.isReconciling = false; });
    }
  }

  // ... (Example Modification Methods: addParagraph, changeParagraphText, toggleBoldOnFirstWordInParagraph, getDocJson)
  // These methods also need to call undoManager.add

  public addParagraph(text: string): void {
    if (!this.currentViewDoc.content) {
        console.error("Current document has no content array to add to.");
        return;
    }
    const newParagraph = this.schema.node("paragraph", null, [this.schema.text(text)]);
    const newContent = [...this.currentViewDoc.content, newParagraph];
    const newDoc = this.schema.node("doc", null, newContent);
    if (!this.domPatcher.areNodesEffectivelyEqual(this.currentViewDoc, newDoc)) {
        this.undoManager.add(this.currentViewDoc);
    }
    this.updateDocument(newDoc);
  }

  public changeParagraphText(paraIndex: number, newText: string): void {
    const currentContent = this.currentViewDoc.content;
    if (!currentContent || paraIndex < 0 || paraIndex >= currentContent.length) {
      console.warn(`Paragraph index ${paraIndex} out of bounds or document has no content.`);
      return;
    }

    const newContent = currentContent.map((block, index) => {
      const blockNodeType = block.type as NodeType;
      if (index === paraIndex && blockNodeType.name === 'paragraph') {
        return this.schema.node("paragraph", null, [this.schema.text(newText)]);
      }
      return block;
    });

    const newDoc = this.schema.node("doc", null, newContent);
    if (!this.domPatcher.areNodesEffectivelyEqual(this.currentViewDoc, newDoc)) {
        this.undoManager.add(this.currentViewDoc);
    }
    this.updateDocument(newDoc);
  }

  public toggleBoldOnFirstWordInParagraph(paraIndex: number): void {
    const currentContent = this.currentViewDoc.content;
    if (!currentContent || paraIndex < 0 || paraIndex >= currentContent.length) {
      console.warn(`Paragraph index ${paraIndex} out of bounds or document has no content.`);
      return;
    }

    const newContent = currentContent.map((block, index): BaseNode => {
      const blockNodeType = block.type as NodeType;
      if (index === paraIndex && blockNodeType.name === 'paragraph') {
        const paraNode = block;
        if (!paraNode.content || paraNode.content.length === 0) return paraNode;
        const firstInlineNode = paraNode.content[0];
        const firstInlineNodeType = firstInlineNode.type as NodeType;
        if (firstInlineNodeType.name !== 'text') return paraNode;
        const textNode = firstInlineNode as ModelTextNode;
        const words = textNode.text.split(/(\s+)/);
        if (words.length === 0 || words[0].length === 0) return paraNode;
        const firstWord = words[0];
        const restOfText = words.slice(1).join('');
        const currentMarks = textNode.marks || [];
        const boldMarkTypeFromSchema = this.schema.marks.bold;
        if (!boldMarkTypeFromSchema) { console.warn("Bold mark type not defined in schema."); return paraNode; }
        const isBold = currentMarks.some(mark => mark.type === boldMarkTypeFromSchema);
        let newFirstWordMarks: AnyMark[];
        if (isBold) newFirstWordMarks = currentMarks.filter(mark => mark.type !== boldMarkTypeFromSchema);
        else newFirstWordMarks = [...currentMarks, boldMarkTypeFromSchema.create()];
        const newInlineNodes: BaseNode[] = [ this.schema.text(firstWord, newFirstWordMarks), ];
        if (restOfText) newInlineNodes.push(this.schema.text(restOfText, currentMarks));
        newInlineNodes.push(...paraNode.content.slice(1));
        return this.schema.node("paragraph", null, newInlineNodes);
      }
      return block;
    });
    const newDoc = this.schema.node("doc", null, newContent);
    if (!this.domPatcher.areNodesEffectivelyEqual(this.currentViewDoc, newDoc)) {
        this.undoManager.add(this.currentViewDoc);
    }
    this.updateDocument(newDoc);
  }

  public getDocJson(): string {
      return JSON.stringify(this.currentViewDoc, null, 2);
  }
}

// --- Conceptual HTML and Script for testing ---
/*
... (HTML sketch remains the same)
*/

console.log("RitorVDOM class defined. Example usage is sketched for browser environment.");
[end of src/RitorVDOM.ts]
