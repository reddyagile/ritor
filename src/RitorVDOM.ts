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
import { UndoManager } from './undoManager.js';

// Definition for SimpleChange for PoC selection mapping
type SimpleChange =
  | { type: 'insertText'; path: number[]; offset: number; length: number }
  | { type: 'deleteText'; path: number[]; offset: number; length: number }
  | { type: 'splitNode'; path: number[]; offset: number;
      newParaPathIndex: number;
    }
  | { type: 'transformBlock'; path: number[]; newType: NodeType; newAttrs?: any }; // Path to the block

export class RitorVDOM {
  public $el: HTMLElement;
  public currentViewDoc: BaseNode;
  private domPatcher: DomPatcher;
  public readonly schema: Schema;
  private modelUtils: ModelUtils;
  private undoManager: UndoManager;
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
    this.undoManager = new UndoManager();

    this.currentViewDoc = this.schema.node("doc", null, [
      this.schema.node("paragraph", null, [
        ...this.modelUtils.normalizeInlineArray([this.schema.text("Hello VDOM world!")])
      ])
    ]);

    if (this.currentViewDoc) {
        this.undoManager.add(this.currentViewDoc);
    }

    this.domPatcher = new DomPatcher(this.$el, this.currentViewDoc, this.schema);
    this.$el.contentEditable = 'true';

    this.$el.addEventListener('keydown', (event: KeyboardEvent) => {
      let handled = false;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        if (event.shiftKey) {
          this.redo();
        } else {
          this.undo();
        }
        handled = true;
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
        this.redo();
        handled = true;
      }

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

    let domBlockElement: HTMLElement | null = containingElement;
    const blockTags = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DIV', 'UL', 'OL', 'LI']; // Include list tags
    while (domBlockElement && domBlockElement !== this.$el && !blockTags.includes(domBlockElement.nodeName) ) {
        if(domBlockElement.parentNode === this.$el) break;
        domBlockElement = domBlockElement.parentNode as HTMLElement;
    }
     if (domBlockElement === this.$el && containingElement !== this.$el) {
        domBlockElement = containingElement;
        while(domBlockElement && domBlockElement.parentNode !== this.$el) {
            domBlockElement = domBlockElement.parentNode as HTMLElement;
        }
    }

    if (!domBlockElement || (domBlockElement === this.$el && !(containingElement === this.$el && this.$el.children[domOffset]))) {
         if (containingElement === this.$el && this.$el.children.length > 0 && domOffset < this.$el.children.length) {
            const targetBlock = this.$el.children[domOffset] as HTMLElement;
            if (targetBlock && blockTags.includes(targetBlock.nodeName)) {
                domBlockElement = targetBlock;
                charOffsetInElement = 0;
            } else { return null; }
        } else { return null; }
    }

    const modelBlockIndex = Array.from(this.$el.children).indexOf(domBlockElement);
    if (modelBlockIndex === -1) return null;

    const modelBlock = this.currentViewDoc.content?.[modelBlockIndex];
    if (!modelBlock || !modelBlock.content) return { path: [modelBlockIndex], offset: 0 };

    let currentLength = 0;
    for (let i = 0; i < modelBlock.content.length; i++) {
        const inlineNode = modelBlock.content[i];
        const nodeType = inlineNode.type as NodeType;
        if (nodeType.isText) {
            const textLen = (inlineNode as ModelTextNode).text.length;
            if (charOffsetInElement <= currentLength + textLen) {
                return { path: [modelBlockIndex, i], offset: charOffsetInElement - currentLength };
            }
            currentLength += textLen;
        } else {
            if (charOffsetInElement <= currentLength + 1) {
                return { path: [modelBlockIndex, i], offset: charOffsetInElement - currentLength };
            }
            currentLength += 1;
        }
    }
    const lastInlineNodeIndex = modelBlock.content.length > 0 ? modelBlock.content.length - 1 : 0;
    const lastInlineNode = modelBlock.content[lastInlineNodeIndex] as ModelTextNode | undefined;
    let offsetInLastNode = 0;
    if (lastInlineNode) {
        if ((lastInlineNode.type as NodeType).isText) {
            offsetInLastNode = lastInlineNode.text.length;
        } else { offsetInLastNode = 1; }
    }
    if (charOffsetInElement > currentLength) {
        return { path: [modelBlockIndex, lastInlineNodeIndex], offset: offsetInLastNode };
    }
    if (modelBlock.content.length === 0) {
        return { path: [modelBlockIndex], offset: 0 };
    }
    return { path: [modelBlockIndex, lastInlineNodeIndex], offset: offsetInLastNode };
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
    const blockIndex = modelPos.path[0];
    const domBlock = this.$el.children[blockIndex] as HTMLElement;
    if (!domBlock) return null;

    if (modelPos.path.length === 1) {
      if (!domBlock.firstChild && modelPos.offset === 0) return { node: domBlock, offset: 0 };
      if (modelPos.offset < domBlock.childNodes.length) return { node: domBlock, offset: modelPos.offset };
      else if (domBlock.childNodes.length === 0 && modelPos.offset === 0) return { node: domBlock, offset: 0 };
      const lastChild = domBlock.lastChild;
      return { node: lastChild || domBlock, offset: lastChild ? (lastChild.textContent || "").length : 0};
    }

    const inlineNodeIndex = modelPos.path[1];
    if (!domBlock.childNodes || inlineNodeIndex >= domBlock.childNodes.length) {
        if (inlineNodeIndex === domBlock.childNodes.length && modelPos.offset === 0) {
            if (domBlock.lastChild) return { node: domBlock.lastChild, offset: (domBlock.lastChild.nodeType === Node.TEXT_NODE ? (domBlock.lastChild.textContent || "").length : 1) };
            else return { node: domBlock, offset: 0 };
        }
        return { node: domBlock, offset: 0 };
    }
    const targetDomInlineNode = domBlock.childNodes[inlineNodeIndex];
    if (!targetDomInlineNode) return { node: domBlock, offset: 0 };
    if (targetDomInlineNode.nodeType === Node.TEXT_NODE) return { node: targetDomInlineNode, offset: Math.min(modelPos.offset, (targetDomInlineNode.textContent || "").length) };
    else return { node: domBlock, offset: inlineNodeIndex + modelPos.offset };
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

  // TODO: COMMENTING - Add detailed comments to this method explaining its sections and PoC limitations.
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
      const modelBlockIndex = currentModelPos.path[0];
      const modelInlineNodeIndex = currentModelPos.path.length > 1 ? currentModelPos.path[1] : -1;
      const textOffset = currentModelPos.offset;
      const currentBlockNode = this.currentViewDoc.content?.[modelBlockIndex];

      if (!currentBlockNode) { console.warn("InsertText: Block not found for currentModelPos"); return; }

      // Heading and List Markdown-like shortcuts
      if (event.data === ' ' && (currentBlockNode.type as NodeType).name === 'paragraph') {
        const inlineContent = currentBlockNode.content || [];
        // Shortcut must be at the beginning of a text node which is the first inline node.
        if (modelInlineNodeIndex === 0 && textOffset === 0 && inlineContent.length > 0 && (inlineContent[0].type as NodeType).name === 'text') {
          const currentTextNode = inlineContent[0] as ModelTextNode;
          const textBeforeSpace = currentTextNode.text;

          let level: number | undefined;
          let listTypeNode: NodeType | undefined;
          let transformToType: NodeType | undefined;
          let newAttrs: any = { ...(currentBlockNode.attrs || {}), id: currentBlockNode.attrs?.id || this.schema.generateNodeId() };
          let newChangeType: 'transformBlock' | null = null;

          if (textBeforeSpace === '#') { level = 1; transformToType = this.schema.nodes.heading; }
          else if (textBeforeSpace === '##') { level = 2; transformToType = this.schema.nodes.heading; }
          else if (textBeforeSpace === '###') { level = 3; transformToType = this.schema.nodes.heading; }
          else if (textBeforeSpace === '*' || textBeforeSpace === '-') { listTypeNode = this.schema.nodes.bullet_list; transformToType = listTypeNode; }
          else if (textBeforeSpace === '1.') { listTypeNode = this.schema.nodes.ordered_list; newAttrs.order = 1; transformToType = listTypeNode; }

          if (transformToType) {
            event.preventDefault();
            let finalTransformedNode: BaseNode;
            if (level && transformToType.name === 'heading') {
                newAttrs.level = level;
                finalTransformedNode = this.schema.node(transformToType, newAttrs, [this.schema.text("")]);
                this.lastAppliedChange = { type: 'transformBlock', path: [modelBlockIndex], newType: transformToType, newAttrs };
            } else if (listTypeNode) {
                const listItemPara = this.schema.node(this.schema.nodes.paragraph, {}, [this.schema.text("")]);
                const listItem = this.schema.node(this.schema.nodes.list_item, {}, [listItemPara]);
                finalTransformedNode = this.schema.node(listTypeNode, newAttrs, [listItem]);
                 this.lastAppliedChange = { type: 'transformBlock', path: [modelBlockIndex], newType: listTypeNode, newAttrs };
            } else { return; /* Should not happen if transformToType is set */ }

            const newDocContent = [...(this.currentViewDoc.content || [])];
            newDocContent[modelBlockIndex] = finalTransformedNode;
            newDoc = this.schema.node((this.currentViewDoc.type as NodeType), this.currentViewDoc.attrs, newDocContent);
          }
        }
      }

      if (!newDoc && event.data) {
        event.preventDefault();
        const paragraphContent = currentBlockNode.content || []; // currentBlockNode is defined if currentModelPos is
        let newInlineContent: BaseNode[];
        const targetModelTextNode = paragraphContent?.[modelInlineNodeIndex] as ModelTextNode | undefined;

        if (targetModelTextNode && targetModelTextNode.type.name === 'text') {
          const newText = targetModelTextNode.text.slice(0, textOffset) + event.data + targetModelTextNode.text.slice(textOffset);
          newInlineContent = [...paragraphContent];
          newInlineContent[modelInlineNodeIndex] = this.schema.text(newText, targetModelTextNode.marks);
          this.lastAppliedChange = { type: 'insertText', path: [modelBlockIndex, modelInlineNodeIndex], offset: textOffset, length: event.data.length};
        } else if ( (paragraphContent.length === 0 || modelInlineNodeIndex === -1 || modelInlineNodeIndex === paragraphContent.length) && textOffset === 0 ) {
          const newTextNode = this.schema.text(event.data || "");
          const targetInlineIdx = (modelInlineNodeIndex === -1 || paragraphContent.length === 0) ? 0 : modelInlineNodeIndex;
          if(modelInlineNodeIndex === -1 || paragraphContent.length === 0) {
              newInlineContent = [newTextNode];
          } else {
              newInlineContent = [...paragraphContent];
              newInlineContent.splice(targetInlineIdx, 0, newTextNode);
          }
          this.lastAppliedChange = { type: 'insertText', path: [modelBlockIndex, targetInlineIdx], offset: 0, length: event.data.length};
        } else { console.warn("InsertText: Unhandled case for text insertion after shortcut check."); return; }

        const normalizedInlineContent = this.modelUtils.normalizeInlineArray(newInlineContent);
        const updatedBlock = this.schema.node(currentBlockNode.type as NodeType, currentBlockNode.attrs, normalizedInlineContent);
        const newDocContent = [...(this.currentViewDoc.content || [])];
        newDocContent[modelBlockIndex] = updatedBlock;
        newDoc = this.schema.node(this.currentViewDoc.type as NodeType, this.currentViewDoc.attrs, newDocContent);
      } else if (!newDoc && !event.data && event.inputType === 'insertText'){
          console.log("RitorVDOM: Empty insertText event, letting mutation observer handle.");
          return;
      }

    } else if (event.inputType === 'insertParagraph' && currentModelPos) {
      event.preventDefault();
      const modelBlockIndex = currentModelPos.path[0];
      const modelInlineNodeIndex = currentModelPos.path.length > 1 ? currentModelPos.path[1] : -1;
      const textOffset = currentModelPos.offset;

      const currentBlock = this.currentViewDoc.content?.[modelBlockIndex];
      if (!currentBlock ) { console.warn("InsertParagraph: Current block not found"); return; }

      // Handle Enter in list item
      if ((currentBlock.type as NodeType).name === 'paragraph' && currentModelPos.path.length > 1) {
          // Check if this paragraph is inside a list_item
          const parentListPath = currentModelPos.path.slice(0, -2); // Path to potential list node
          const listItemIndex = currentModelPos.path[currentModelPos.path.length -2]; // Potential list_item index in list

          let parentNode = this.currentViewDoc;
          for(let i=0; i < parentListPath.length; i++) parentNode = parentNode.content![parentListPath[i]];

          if(parentNode && parentNode.content && (parentNode.content[listItemIndex]?.type as NodeType)?.name === 'list_item' ) {
              const listNode = parentNode;
              const listNodeContent = listNode.content!; // listNode is UL/OL, content is LIs
              const currentListItemModelIndex = listItemIndex; // Index of current LI in UL/OL

              // For PoC: always create a new empty list item after the current one.
              // Does not handle splitting current list item's content.
              const newEmptyListItemParagraph = this.schema.node(this.schema.nodes.paragraph, {}, [this.schema.text("")]);
              const newListItem = this.schema.node(this.schema.nodes.list_item, {}, [newEmptyListItemParagraph]);

              const newListContent = [...listNodeContent];
              newListContent.splice(currentListItemModelIndex + 1, 0, newListItem);

              const updatedListNode = this.schema.node(listNode.type as NodeType, listNode.attrs, newListContent);

              let docContent = [...(this.currentViewDoc.content || [])];
              // This assumes list is a direct child of doc for now. Needs robust path replacement.
              if(parentListPath.length === 1) { // List is direct child of doc
                 docContent[parentListPath[0]] = updatedListNode;
              } else { /* TODO: Handle nested lists */ console.warn("Enter in nested list not fully supported for path update"); }

              newDoc = this.schema.node(this.currentViewDoc.type as NodeType, this.currentViewDoc.attrs, docContent);
              // TODO: Define a more specific SimpleChange for adding list item
              this.lastAppliedChange = { type: 'splitNode', path: [modelBlockIndex, modelInlineNodeIndex], offset: textOffset, newParaPathIndex: modelBlockIndex + 1 }; // Placeholder change type
          }
      }

      if(!newDoc) { // Default paragraph split if not handled by list logic
        const currentParaContent = currentBlock.content || [];
        const targetModelTextNode = currentParaContent?.[modelInlineNodeIndex] as ModelTextNode | undefined;
        const textBefore = (targetModelTextNode && targetModelTextNode.type.name === 'text') ? targetModelTextNode.text.slice(0, textOffset) : "";
        const textAfter = (targetModelTextNode && targetModelTextNode.type.name === 'text') ? targetModelTextNode.text.slice(textOffset) : "";
        const marksFromSplit = (targetModelTextNode && targetModelTextNode.type.name === 'text') ? targetModelTextNode.marks || [] : [];
        let resolvedInlineIndex = modelInlineNodeIndex === -1 ? 0 : modelInlineNodeIndex;

        let currentParaInlineNodes: BaseNode[] = [];
        for (let i = 0; i < resolvedInlineIndex; i++) if(currentParaContent[i]) currentParaInlineNodes.push(currentParaContent[i]);
        if (textBefore) currentParaInlineNodes.push(this.schema.text(textBefore, marksFromSplit));
        const nodeAtSplitPoint = currentParaContent[resolvedInlineIndex];
        if (nodeAtSplitPoint && (nodeAtSplitPoint.type as NodeType).name !== 'text' && textOffset === 1) {
            currentParaInlineNodes.push(nodeAtSplitPoint);
        }
        currentParaInlineNodes = this.modelUtils.normalizeInlineArray(currentParaInlineNodes);

        let newParaInlineNodes: BaseNode[] = [this.schema.text(textAfter, marksFromSplit)];
        if (nodeAtSplitPoint && (nodeAtSplitPoint.type as NodeType).name !== 'text' && textOffset === 0) {
            newParaInlineNodes = [nodeAtSplitPoint, ...newParaInlineNodes];
        }
        for (let i = resolvedInlineIndex + 1; i < currentParaContent.length; i++) if(currentParaContent[i]) newParaInlineNodes.push(currentParaContent[i]);
        newParaInlineNodes = this.modelUtils.normalizeInlineArray(newParaInlineNodes);

        const updatedCurrentBlock = this.schema.node(currentBlock.type as NodeType, currentBlock.attrs, currentParaInlineNodes);
        // By default, new block is a paragraph. If splitting a heading, it becomes a paragraph.
        const newGeneratedBlock = this.schema.node("paragraph", null, newParaInlineNodes);
        const newDocContent = [...(this.currentViewDoc.content || [])];
        newDocContent.splice(modelBlockIndex, 1, updatedCurrentBlock, newGeneratedBlock);
        newDoc = this.schema.node(this.currentViewDoc.type as NodeType, this.currentViewDoc.attrs, newDocContent);
        this.lastAppliedChange = {
          type: 'splitNode',
          path: [modelBlockIndex, resolvedInlineIndex],
          offset: textOffset,
          newParaPathIndex: modelBlockIndex + 1
        };
      }

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
      if (!this.domPatcher.areNodesEffectivelyEqual(this.currentViewDoc, newDoc)) {
        this.undoManager.add(this.currentViewDoc);
      }
      this.updateDocument(newDoc);
    } else {
      if (event.defaultPrevented) { // If we prevented default but didn't make a doc change
          this.lastAppliedChange = null;
      }
    }
  }

  private handleMutations(mutations: MutationRecord[], observer: MutationObserver): void {
    if (this.isReconciling) return;
    this.isReconciling = true;
    console.log("RitorVDOM: Handling mutations:", mutations);
    let domChangedBlock: HTMLElement | null = null;
    let modelBlockIndex = -1;

    const charMutation = mutations.find(m => m.type === 'characterData');
    if (charMutation && charMutation.target.parentNode) {
        let potentialBlock = charMutation.target.parentNode as HTMLElement;
        // Updated to include list related tags and general DIV for doc root
        while(potentialBlock && potentialBlock !== this.$el && !['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'DIV'].includes(potentialBlock.nodeName) ) {
            potentialBlock = potentialBlock.parentNode as HTMLElement;
        }
        if (potentialBlock && potentialBlock !== this.$el) {
            domChangedBlock = potentialBlock;
        }
    }

    if (!domChangedBlock) {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
            let container = selection.getRangeAt(0).commonAncestorContainer;
            if (container.nodeType === Node.TEXT_NODE) container = container.parentNode!;
            let potentialBlock = container as HTMLElement;
            while(potentialBlock && potentialBlock !== this.$el && !['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'DIV'].includes(potentialBlock.nodeName)) {
                 potentialBlock = potentialBlock.parentNode as HTMLElement;
            }
            if (potentialBlock && potentialBlock !== this.$el) {
                domChangedBlock = potentialBlock;
            }
        }
    }

    if (!domChangedBlock && this.$el.children.length === 1 && ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'DIV'].includes(this.$el.children[0].nodeName) ) {
        domChangedBlock = this.$el.children[0] as HTMLElement;
    }

    if (domChangedBlock) modelBlockIndex = Array.from(this.$el.children).indexOf(domChangedBlock);
    else { this.isReconciling = false; this.lastAppliedChange = null; return; }

    if (modelBlockIndex !== -1 && this.currentViewDoc.content && modelBlockIndex < this.currentViewDoc.content.length) {
      const oldModelBlock = this.currentViewDoc.content[modelBlockIndex];
      const oldModelBlockType = oldModelBlock.type as NodeType;

      // Allow reconciliation for paragraph, heading, and list items (which contain paragraphs)
      if (!['paragraph', 'heading', 'list_item'].includes(oldModelBlockType.name)) {
          // If it's a UL or OL itself, its direct content is LIs, not inline.
          // Reconciling whole lists based on text content is too naive.
          // For now, only reconcile content of blocks that are expected to have direct inline content or paragraphs (like LI).
          if(['bullet_list', 'ordered_list'].includes(oldModelBlockType.name)) {
              console.warn(`RitorVDOM (MutationObserver): Mutations on list containers (UL/OL) are not deeply reconciled by this PoC. Re-rendering based on textContent might be lossy.`);
              // Potentially, one could try to parse all LIs here. For PoC, this is too complex.
              // A simple textContent approach for the whole list would destroy its structure.
              // We might just let it be, or if structure changed (e.g. LI added/removed), it's a childList mutation on UL/OL.
          } else {
            console.warn(`RitorVDOM (MutationObserver): Block type ${oldModelBlockType.name} not handled for detailed reconciliation.`);
          }
          this.isReconciling = false; this.lastAppliedChange = null; return;
      }

      console.log(`RitorVDOM (MutationObserver): Reconciling block ${oldModelBlockType.name} at index ${modelBlockIndex}. DOM Tag: ${domChangedBlock.nodeName}`);

      const newInlineNodesFromDOM: BaseNode[] = [];
      // If the block is a list_item, its children are paragraphs. We need to reconcile those paragraphs.
      // This simplified version will take all childNodes of the LI (which should be P according to schema)
      // and make them one flat array of inline content for a *single* new paragraph. This is wrong for multi-para LIs.
      // TODO: If oldModelBlockType.name === 'list_item', need to iterate its child paragraphs from DOM and reconcile each.
      if (domChangedBlock && domChangedBlock.childNodes) {
          domChangedBlock.childNodes.forEach(childDomNode => { // If LI, childDomNode is P. We need P's children.
            // This needs to be recursive or smarter for list_item > paragraph > inline content.
            // For now, if childDomNode is P (inside LI), take its children. Otherwise, assume it's inline.
            let nodesToParseForInline: NodeListOf<ChildNode> | ChildNode[] = [childDomNode];
            if(oldModelBlockType.name === 'list_item' && childDomNode.nodeName === 'P') {
                nodesToParseForInline = childDomNode.childNodes;
            } else if (oldModelBlockType.name === 'list_item' && childDomNode.nodeName !== 'P') {
                // Stray node inside LI that's not a P, treat as text for now.
            }


            nodesToParseForInline.forEach(inlineDomNode => {
                if (inlineDomNode.nodeType === Node.TEXT_NODE) newInlineNodesFromDOM.push(this.schema.text(inlineDomNode.textContent || ''));
                else if (inlineDomNode.nodeType === Node.ELEMENT_NODE) {
                  const el = inlineDomNode as HTMLElement; const textContent = el.textContent || '';
                  switch (el.nodeName) {
                    case 'STRONG': const mB = this.schema.marks.bold; newInlineNodesFromDOM.push(this.schema.text(textContent, mB ? [mB.create()] : [])); break;
                    case 'EM': const mI = this.schema.marks.italic; newInlineNodesFromDOM.push(this.schema.text(textContent, mI ? [mI.create()] : [])); break;
                    case 'BR': newInlineNodesFromDOM.push(this.schema.node("hard_break")); break;
                    case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6':
                      console.warn(`RitorVDOM (MutationObserver): Found nested block ${el.nodeName} during inline parsing. Taking text only.`);
                      newInlineNodesFromDOM.push(this.schema.text(textContent));
                      break;
                    default: newInlineNodesFromDOM.push(this.schema.text(textContent));
                  }
                }
            });

          });
      }
      const normalizedInlineContent = this.modelUtils.normalizeInlineArray(newInlineNodesFromDOM);
      // Re-create the block with its original type and attributes, but new content
      // If oldModelBlock was list_item, its content should be paragraphs.
      let finalContentForBlock: BaseNode[];
      if(oldModelBlockType.name === 'list_item') {
          finalContentForBlock = [this.schema.node("paragraph", {}, normalizedInlineContent)]; // Wrap in a paragraph
      } else {
          finalContentForBlock = normalizedInlineContent;
      }

      const newModelBlock = this.schema.node(oldModelBlockType, oldModelBlock.attrs, finalContentForBlock);
      const newDocContent = [...(this.currentViewDoc.content || [])];
      newDocContent[modelBlockIndex] = newModelBlock;
      const newDoc = this.schema.node(this.currentViewDoc.type as NodeType, this.currentViewDoc.attrs, newDocContent);

      if (!this.domPatcher.areNodesEffectivelyEqual(this.currentViewDoc, newDoc)) {
        this.undoManager.add(this.currentViewDoc);
      }
      this.updateDocument(newDoc);
    } else console.warn("RitorVDOM: Changed block not found in model or model out of sync.");

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

    const changeBlockIndex = change.path[0];
    const posBlockIndex = newPath[0];

    if (change.type === 'transformBlock') {
        if (changeBlockIndex === posBlockIndex) {
            if (change.newType.name === 'heading' || change.newType.name === 'bullet_list' || change.newType.name === 'ordered_list' ) {
                // When transforming a P to a list or heading, selection often goes to start.
                // If new node has content (e.g. a list_item > paragraph > textnode), path needs to reflect that.
                if (change.newType.name.endsWith("_list")) { // bullet_list or ordered_list
                    // Path should be [blockIdx, 0 (list_item), 0 (paragraph), 0 (textnode)]
                    newPath = [changeBlockIndex, 0, 0, 0];
                } else { // heading
                    newPath = [changeBlockIndex, 0]; // Path to first (empty) text node in heading
                }
                currentOffset = 0;
            }
        }
        return { path: newPath, offset: currentOffset };
    }

    if (changeBlockIndex !== posBlockIndex) {
        if (change.type === 'splitNode') {
            if (change.newParaPathIndex <= posBlockIndex) {
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
            // If new paragraph is part of a list item, path needs to be longer
            const newBlock = this.currentViewDoc.content?.[change.newParaPathIndex]; // This is state *before* update, not good
                                                                                // Need to inspect the structure of the *newly created* block
                                                                                // For this PoC, assume it's a simple paragraph for offset calculation.
            newPath[1] = 0; // Content after split starts at inline index 0 of new para's content
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
       if (this.isReconciling) {
           Promise.resolve().then(() => { this.isReconciling = false; });
       }
       return;
    }

    if (newDoc.type !== this.schema.topNodeType) {
        console.error(`Invalid document root type. Expected ${this.schema.topNodeType.name}, got ${(newDoc.type as NodeType).name}`);
        if (this.isReconciling) {
            Promise.resolve().then(() => { this.isReconciling = false; });
        }
        return;
    }

    this.currentViewDoc = newDoc;
    this.domPatcher.patch(this.currentViewDoc);

    if (selectionToRestore) {
        this.applyModelSelectionToDom(selectionToRestore);
    }
    this.updateModelSelectionState();

    console.log("Document updated successfully.");
    console.log("Current HTML:", this.$el.innerHTML);

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
        this.isReconciling = true;
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
        this.isReconciling = true;
        this.currentViewDoc = nextState;
        this.domPatcher.patch(this.currentViewDoc);
        this.lastAppliedChange = null;
        this.updateModelSelectionState();
        console.log("Redo performed.");
        Promise.resolve().then(() => { this.isReconciling = false; });
    }
  }

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

console.log("RitorVDOM class defined. Example usage is sketched for browser environment.");
[end of src/RitorVDOM.ts]
