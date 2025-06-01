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
import { Attrs } from './schemaSpec.js';

// Definition for SimpleChange for PoC selection mapping
type SimpleChange =
  | { type: 'insertText'; path: number[]; offset: number; length: number }
  | { type: 'deleteText'; path: number[]; offset: number; length: number }
  | { type: 'splitNode'; path: number[]; offset: number;
      newParaPathIndex: number;
    }
  | { type: 'transformBlock'; path: number[]; newType: NodeType; newAttrs?: any }
  | { type: 'insertNode'; path: number[]; node: BaseNode }
  | { type: 'formatMark'; from: ModelPosition, to: ModelPosition, markType: string, attrs?: Attrs };

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
      if (!element) throw new Error(`Target element "${target}" not found.`);
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
        if (event.shiftKey) { this.redo(); } else { this.undo(); }
        handled = true;
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
        this.redo();
        handled = true;
      } else if (event.altKey && event.key.toLowerCase() === 's') {
        if (this.schema.marks.strikethrough) {
            this.toggleMark(this.schema.marks.strikethrough);
            handled = true;
        }
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        this.promptAndSetLink();
        handled = true;
      }

      if (handled) event.preventDefault();
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

  private getBlockContext(modelPos: ModelPosition | null): {
    blockNode: BaseNode | null,
    blockIndex: number,
    parentOfBlock: BaseNode | null,
    pathFromParentToBlock: number[]
  } | null {
    if (!modelPos || !this.currentViewDoc.content) return null;
    const path = modelPos.path;
    if (path.length === 0) return null;
    let currentParent: BaseNode = this.currentViewDoc;
    let finalBlockNode: BaseNode | null = null;
    let finalBlockIndex = -1;
    let finalParentOfBlock: BaseNode | null = this.currentViewDoc;
    let finalPathInParent : number[] = [];
    for(let i=0; i < path.length; i++) {
        const index = path[i];
        const parentContent = currentParent.content;
        if (!parentContent || index >= parentContent.length) return null;
        const nodeAtPath = parentContent[index];
        const nodeAtPathType = nodeAtPath.type as NodeType;
        if (nodeAtPathType.isBlock) {
            finalParentOfBlock = currentParent;
            finalBlockNode = nodeAtPath;
            finalBlockIndex = index;
            finalPathInParent = [index];
            if (i < path.length -1) { currentParent = nodeAtPath; }
        } else if (nodeAtPathType.isText || nodeAtPathType.spec.inline) {
            finalBlockNode = currentParent;
            if(currentParent !== this.currentViewDoc) {
                let grandParent = this.currentViewDoc;
                let searchPath = path.slice(0, i);
                finalPathInParent = [searchPath[searchPath.length-1]];
                for(let k=0; k < searchPath.length -1; k++) {
                    grandParent = grandParent.content![searchPath[k]];
                }
                finalParentOfBlock = grandParent;
                finalBlockIndex = searchPath[searchPath.length-1];
            } else {
                finalBlockIndex = path[0];
                finalPathInParent = [path[0]];
            }
            break;
        }
    }
    if (!finalBlockNode) return null;
    return { blockNode: finalBlockNode, blockIndex: finalPathInParent[0], parentOfBlock: finalParentOfBlock, pathInParent: finalPathInParent };
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
    let currentPath: number[] = [];
    let domSearchElement: HTMLElement | null = containingElement;
    const pathSegments: {element: HTMLElement, index: number}[] = [];
    while(domSearchElement && domSearchElement !== this.$el) {
        const parentChildren = Array.from(domSearchElement.parentNode?.children || []);
        pathSegments.unshift({element: domSearchElement, index: parentChildren.indexOf(domSearchElement)});
        domSearchElement = domSearchElement.parentNode as HTMLElement | null;
    }
    if (pathSegments.length === 0 && containingElement !== this.$el) return null;
    let modelBlock: BaseNode | null = null;
    if (pathSegments.length > 0) {
        currentPath.push(pathSegments[0].index);
        modelBlock = this.currentViewDoc.content?.[pathSegments[0].index] ?? null;
        for(let i = 1; i < pathSegments.length; i++) {
            if (!modelBlock || !(modelBlock.type as NodeType).isBlock || !modelBlock.content) break;
            currentPath.push(pathSegments[i].index);
            modelBlock = modelBlock.content[pathSegments[i].index] ?? null;
        }
    } else if (containingElement === this.$el) {
        if (domOffset < this.$el.children.length) {
            currentPath.push(domOffset);
            modelBlock = this.currentViewDoc.content?.[domOffset] ?? null;
            charOffsetInElement = 0;
        } else return null;
    }
    if (!modelBlock) return null;
    if (!(modelBlock.type as NodeType).isText && !modelBlock.spec.inline && modelBlock.content) {
        let currentLength = 0;
        for (let i = 0; i < modelBlock.content.length; i++) {
            const inlineNode = modelBlock.content[i];
            const nodeType = inlineNode.type as NodeType;
            if (nodeType.isText) {
                const textLen = (inlineNode as ModelTextNode).text.length;
                if (charOffsetInElement <= currentLength + textLen) {
                    return { path: [...currentPath, i], offset: charOffsetInElement - currentLength };
                }
                currentLength += textLen;
            } else {
                if (charOffsetInElement <= currentLength + 1) {
                    return { path: [...currentPath, i], offset: charOffsetInElement - currentLength };
                }
                currentLength += 1;
            }
        }
        const lastInlineIdx = modelBlock.content.length > 0 ? modelBlock.content.length - 1 : 0;
        const lastInline = modelBlock.content[lastInlineIdx] as ModelTextNode | undefined;
        let offsetInLast = 0;
        if(lastInline) offsetInLast = (lastInline.type as NodeType).isText ? lastInline.text.length : 1;
        if(modelBlock.content.length === 0) return {path: currentPath, offset:0};
        return { path: [...currentPath, lastInlineIdx], offset: offsetInLast };
    } else {
        return { path: currentPath, offset: charOffsetInElement };
    }
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
    let currentDomParent: HTMLElement = this.$el;
    let modelNodeContainer: ReadonlyArray<BaseNode> | undefined = this.currentViewDoc.content;
    let targetModelNode: BaseNode | null = null;
    for(let i=0; i < modelPos.path.length; i++) {
        const index = modelPos.path[i];
        if(!modelNodeContainer || index >= modelNodeContainer.length) return null;
        targetModelNode = modelNodeContainer[index];
        if (i < modelPos.path.length - 1) {
            currentDomParent = currentDomParent.children[index] as HTMLElement;
            if(!currentDomParent) return null;
            modelNodeContainer = targetModelNode.content;
        }
    }
    if (!targetModelNode) return null;
    if ((targetModelNode.type as NodeType).isText) {
        const inlineNodeIndex = modelPos.path[modelPos.path.length -1];
        const domTextNode = currentDomParent.childNodes[inlineNodeIndex];
        if (domTextNode && domTextNode.nodeType === Node.TEXT_NODE) {
            return { node: domTextNode, offset: Math.min(modelPos.offset, (domTextNode.textContent || "").length) };
        } else if (domTextNode) {
             return { node: currentDomParent, offset: inlineNodeIndex + modelPos.offset};
        }
        return { node: currentDomParent, offset: currentDomParent.childNodes.length };
    } else {
        const blockElement = currentDomParent.children[modelPos.path[modelPos.path.length-1]] as HTMLElement;
        if (!blockElement) return {node: currentDomParent, offset: currentDomParent.children.length};
        if (!targetModelNode.content || targetModelNode.content.length === 0) {
            return { node: blockElement, offset: 0 };
        }
        if (modelPos.offset < blockElement.childNodes.length) {
             return { node: blockElement, offset: modelPos.offset };
        }
        return { node: blockElement, offset: blockElement.childNodes.length };
    }
  }

  private applyModelSelectionToDom(modelSelection: ModelSelection | null): void {
    if (!modelSelection) return;
    const domAnchor = this.modelToDomPosition(modelSelection.anchor);
    const domHead = this.modelToDomPosition(modelSelection.head);
    if (!domAnchor || !domHead) { console.error("applyModelSelectionToDom: Could not map model selection points."); return;}
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
        if (['insertText', 'insertParagraph', 'deleteContentBackward', 'deleteContentForward'].includes(event.inputType)) {
            event.preventDefault(); return;
        }
    }
    const currentModelPos = this.currentModelSelection?.anchor;
    if (!currentModelPos) {
        if (['insertText', 'insertParagraph', 'deleteContentBackward', 'deleteContentForward'].includes(event.inputType)) {
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
      if (!currentBlockNode) { return; }
      if (event.data === ' ' && (currentBlockNode.type as NodeType).name === 'paragraph') {
        const inlineContent = currentBlockNode.content || [];
        if (modelInlineNodeIndex === 0 && textOffset === 0 && inlineContent.length > 0 && (inlineContent[0].type as NodeType).name === 'text') {
          const currentTextNode = inlineContent[0] as ModelTextNode;
          const textBeforeSpace = currentTextNode.text;
          let level: number | undefined;
          let listTypeNode: NodeType | undefined;
          let transformToType: NodeType | undefined;
          let newAttrs: any = { ...(currentBlockNode.attrs || {}), id: currentBlockNode.attrs?.id || this.schema.generateNodeId() };
          if (textBeforeSpace === '#') { level = 1; transformToType = this.schema.nodes.heading; }
          else if (textBeforeSpace === '##') { level = 2; transformToType = this.schema.nodes.heading; }
          else if (textBeforeSpace === '###') { level = 3; transformToType = this.schema.nodes.heading; }
          else if (textBeforeSpace === '*' || textBeforeSpace === '-') { listTypeNode = this.schema.nodes.bullet_list; transformToType = listTypeNode; }
          else if (textBeforeSpace === '1.') { listTypeNode = this.schema.nodes.ordered_list; newAttrs.order = 1; transformToType = listTypeNode; }
          else if (textBeforeSpace === '>') { transformToType = this.schema.nodes.blockquote; }
          if (transformToType) {
            event.preventDefault();
            let finalTransformedNode: BaseNode;
            if (transformToType.name === 'heading' && level) {
                newAttrs.level = level;
                finalTransformedNode = this.schema.node(transformToType, newAttrs, [this.schema.text("")]);
            } else if (listTypeNode) {
                const listItemPara = this.schema.node(this.schema.nodes.paragraph, {}, [this.schema.text("")]);
                const listItem = this.schema.node(this.schema.nodes.list_item, {}, [listItemPara]);
                finalTransformedNode = this.schema.node(listTypeNode, newAttrs, [listItem]);
            } else if (transformToType.name === 'blockquote') {
                const emptyParaInBlockquote = this.schema.node(this.schema.nodes.paragraph, {}, [this.schema.text("")]);
                finalTransformedNode = this.schema.node(transformToType, newAttrs, [emptyParaInBlockquote]);
            } else { return; }
            this.lastAppliedChange = { type: 'transformBlock', path: [modelBlockIndex], newType: transformToType, newAttrs };
            const newDocContent = [...(this.currentViewDoc.content || [])];
            newDocContent[modelBlockIndex] = finalTransformedNode;
            newDoc = this.schema.node((this.currentViewDoc.type as NodeType), this.currentViewDoc.attrs, newDocContent);
          }
        }
      }
      if (!newDoc && event.data) {
        event.preventDefault();
        const blockContent = currentBlockNode.content || [];
        let newInlineContent: BaseNode[];
        const targetModelTextNode = blockContent?.[modelInlineNodeIndex] as ModelTextNode | undefined;
        if (targetModelTextNode && targetModelTextNode.type.name === 'text') {
          const newText = targetModelTextNode.text.slice(0, textOffset) + event.data + targetModelTextNode.text.slice(textOffset);
          newInlineContent = [...blockContent];
          newInlineContent[modelInlineNodeIndex] = this.schema.text(newText, targetModelTextNode.marks);
          this.lastAppliedChange = { type: 'insertText', path: [modelBlockIndex, modelInlineNodeIndex], offset: textOffset, length: event.data.length};
        } else if ( (blockContent.length === 0 || modelInlineNodeIndex === -1 || modelInlineNodeIndex === blockContent.length) && textOffset === 0 ) {
          const newTextNode = this.schema.text(event.data || "");
          const targetInlineIdx = (modelInlineNodeIndex === -1 || blockContent.length === 0) ? 0 : modelInlineNodeIndex;
          if(modelInlineNodeIndex === -1 || blockContent.length === 0) {
              newInlineContent = [newTextNode];
          } else {
              newInlineContent = [...blockContent];
              newInlineContent.splice(targetInlineIdx, 0, newTextNode);
          }
          this.lastAppliedChange = { type: 'insertText', path: [modelBlockIndex, targetInlineIdx], offset: 0, length: event.data.length};
        } else { console.warn("InsertText: Unhandled after shortcut."); return; }
        const normalizedInlineContent = this.modelUtils.normalizeInlineArray(newInlineContent);
        const updatedBlock = this.schema.node(currentBlockNode.type as NodeType, currentBlockNode.attrs, normalizedInlineContent);
        const newDocContent = [...(this.currentViewDoc.content || [])];
        newDocContent[modelBlockIndex] = updatedBlock;
        newDoc = this.schema.node(this.currentViewDoc.type as NodeType, this.currentViewDoc.attrs, newDocContent);
      } else if (!newDoc && !event.data && event.inputType === 'insertText'){ return; }
    } else if (event.inputType === 'insertParagraph' && currentModelPos) {
      event.preventDefault();
      const modelBlockIndex = currentModelPos.path[0];
      const modelInlineNodeIndex = currentModelPos.path.length > 1 ? currentModelPos.path[1] : -1;
      const textOffset = currentModelPos.offset;
      const currentBlock = this.currentViewDoc.content?.[modelBlockIndex];
      if (!currentBlock ) { return; }
      const currentBlockType = currentBlock.type as NodeType;
      const blockContext = this.getBlockContext(currentModelPos);
      if (blockContext && blockContext.parentOfBlock && blockContext.blockNode === currentBlock) {
          const parentType = blockContext.parentOfBlock.type as NodeType;
          const parentActual = blockContext.parentOfBlock;
          if (parentType.name === 'list_item' && currentBlockType.name === 'paragraph') {
              const listNodePath = currentModelPos.path.slice(0, currentModelPos.path.length - 2);
              const listItemIndexInList = currentModelPos.path[currentModelPos.path.length - 2];
              let listNode = this.currentViewDoc;
              for(let i=0; i < listNodePath.length; i++) listNode = listNode.content![listNodePath[i]];
              const newEmptyListItemPara = this.schema.node("paragraph", {}, [this.schema.text("")]);
              const newListItem = this.schema.node("list_item", {}, [newEmptyListItemPara]);
              const newListContent = [...(listNode.content || [])];
              newListContent.splice(listItemIndexInList + 1, 0, newListItem);
              const updatedListNode = this.schema.node(listNode.type as NodeType, listNode.attrs, newListContent);
              let tempDoc = this.currentViewDoc;
              let parentRef = tempDoc;
              for(let i=0; i<listNodePath.length -1; i++) parentRef = parentRef.content![listNodePath[i]];
              const newParentContent = [...(parentRef.content || [])];
              newParentContent[listNodePath[listNodePath.length-1]] = updatedListNode;
              const newGrandParent = this.schema.node(parentRef.type as NodeType, parentRef.attrs, newParentContent);
              if (parentRef === tempDoc) { newDoc = newGrandParent; }
              else {
                  const topLevelIndex = listNodePath[0];
                  const newTopLevelContent = [...(this.currentViewDoc.content||[])];
                  newTopLevelContent[topLevelIndex] = newGrandParent;
                  newDoc = this.schema.node(this.currentViewDoc.type as NodeType, this.currentViewDoc.attrs, newTopLevelContent);
              }
              this.lastAppliedChange = { type: 'insertNode', path: [...listNodePath, listItemIndexInList + 1], node: newListItem };
          } else if (parentType.name === 'blockquote' && currentBlockType.name === 'paragraph') {
              const blockquoteNode = parentActual;
              const paraIndexInBlockquote = currentModelPos.path[currentModelPos.path.length -1];
              const newParagraphInBlockquote = this.schema.node("paragraph", {}, [this.schema.text("")]);
              const newBlockquoteContent = [...(blockquoteNode.content || [])];
              newBlockquoteContent.splice(paraIndexInBlockquote + 1, 0, newParagraphInBlockquote);
              const updatedBlockquote = this.schema.node(blockquoteNode.type as NodeType, blockquoteNode.attrs, newBlockquoteContent);
              const newDocContent = [...(this.currentViewDoc.content || [])];
              newDocContent[modelBlockIndex] = updatedBlockquote;
              newDoc = this.schema.node(this.currentViewDoc.type as NodeType, this.currentViewDoc.attrs, newDocContent);
              this.lastAppliedChange = { type: 'insertNode', path: [modelBlockIndex, paraIndexInBlockquote + 1], node: newParagraphInBlockquote};
          }
      }
      if(!newDoc) {
        const currentBlockContent = currentBlock.content || [];
        const targetModelTextNode = currentBlockContent?.[modelInlineNodeIndex] as ModelTextNode | undefined;
        const textBefore = (targetModelTextNode && targetModelTextNode.type.name === 'text') ? targetModelTextNode.text.slice(0, textOffset) : "";
        const textAfter = (targetModelTextNode && targetModelTextNode.type.name === 'text') ? targetModelTextNode.text.slice(textOffset) : "";
        const marksFromSplit = (targetModelTextNode && targetModelTextNode.type.name === 'text') ? targetModelTextNode.marks || [] : [];
        let resolvedInlineIndex = modelInlineNodeIndex === -1 ? 0 : modelInlineNodeIndex;
        let currentBlockInlineNodes: BaseNode[] = [];
        for (let i = 0; i < resolvedInlineIndex; i++) if(currentBlockContent[i]) currentBlockInlineNodes.push(currentBlockContent[i]);
        if (textBefore) currentBlockInlineNodes.push(this.schema.text(textBefore, marksFromSplit));
        const nodeAtSplitPoint = currentBlockContent[resolvedInlineIndex];
        if (nodeAtSplitPoint && (nodeAtSplitPoint.type as NodeType).name !== 'text' && textOffset === 1) {
            currentBlockInlineNodes.push(nodeAtSplitPoint);
        }
        currentBlockInlineNodes = this.modelUtils.normalizeInlineArray(currentBlockInlineNodes);
        let newParaInlineNodes: BaseNode[] = [this.schema.text(textAfter, marksFromSplit)];
        if (nodeAtSplitPoint && (nodeAtSplitPoint.type as NodeType).name !== 'text' && textOffset === 0) {
            newParaInlineNodes = [nodeAtSplitPoint, ...newParaInlineNodes];
        }
        for (let i = resolvedInlineIndex + 1; i < currentBlockContent.length; i++) if(currentBlockContent[i]) newParaInlineNodes.push(currentBlockContent[i]);
        newParaInlineNodes = this.modelUtils.normalizeInlineArray(newParaInlineNodes);
        const updatedCurrentBlock = this.schema.node(currentBlock.type as NodeType, currentBlock.attrs, currentBlockInlineNodes);
        const newGeneratedBlock = this.schema.node("paragraph", null, newParaInlineNodes);
        const newDocContent = [...(this.currentViewDoc.content || [])];
        newDocContent.splice(modelBlockIndex, 1, updatedCurrentBlock, newGeneratedBlock);
        newDoc = this.schema.node(this.currentViewDoc.type as NodeType, this.currentViewDoc.attrs, newDocContent);
        this.lastAppliedChange = { type: 'splitNode', path: [modelBlockIndex, resolvedInlineIndex], offset: textOffset, newParaPathIndex: modelBlockIndex + 1 };
      }
    } else if ((event.inputType === 'deleteContentBackward' || event.inputType === 'deleteContentForward') && currentModelPos) {
      event.preventDefault();
      const modelParaIndex = currentModelPos.path[0];
      const modelInlineNodeIndex = currentModelPos.path.length > 1 ? currentModelPos.path[1] : -1;
      const textOffset = currentModelPos.offset;
      const modelParagraph = this.currentViewDoc.content?.[modelParaIndex];
      if (!modelParagraph || !modelParagraph.content || modelInlineNodeIndex === -1) { return; }
      const targetModelTextNode = modelParagraph.content[modelInlineNodeIndex] as ModelTextNode | undefined;
      if (!targetModelTextNode || targetModelTextNode.type.name !== 'text') { return; }
      let newText: string;
      const originalTextLength = targetModelTextNode.text.length;
      if (event.inputType === 'deleteContentBackward') {
        if (textOffset === 0 && modelInlineNodeIndex === 0) { return; }
        else if (textOffset === 0 && modelInlineNodeIndex > 0) { return; }
        newText = targetModelTextNode.text.slice(0, textOffset - 1) + targetModelTextNode.text.slice(textOffset);
        this.lastAppliedChange = { type: 'deleteText', path: [modelParaIndex, modelInlineNodeIndex], offset: textOffset - 1, length: 1 };
      } else {
        if (textOffset === originalTextLength && modelInlineNodeIndex === modelParagraph.content.length -1) { return; }
        else if (textOffset === originalTextLength) { return; }
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
      if (event.defaultPrevented) {
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
        const blockTags = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'DIV'];
        while(potentialBlock && potentialBlock !== this.$el && !blockTags.includes(potentialBlock.nodeName) ) {
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
            const blockTags = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'DIV'];
            while(potentialBlock && potentialBlock !== this.$el && !blockTags.includes(potentialBlock.nodeName)) {
                 potentialBlock = potentialBlock.parentNode as HTMLElement;
            }
            if (potentialBlock && potentialBlock !== this.$el) {
                domChangedBlock = potentialBlock;
            }
        }
    }
    if (!domChangedBlock && this.$el.children.length === 1 && ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'BLOCKQUOTE', 'DIV'].includes(this.$el.children[0].nodeName) ) {
        domChangedBlock = this.$el.children[0] as HTMLElement;
    }
    if (domChangedBlock) modelBlockIndex = Array.from(this.$el.children).indexOf(domChangedBlock);
    else { this.isReconciling = false; this.lastAppliedChange = null; return; }
    if (modelBlockIndex !== -1 && this.currentViewDoc.content && modelBlockIndex < this.currentViewDoc.content.length) {
      const oldModelBlock = this.currentViewDoc.content[modelBlockIndex];
      const oldModelBlockType = oldModelBlock.type as NodeType;
      if (!['paragraph', 'heading', 'list_item', 'blockquote'].includes(oldModelBlockType.name)) {
          if(['bullet_list', 'ordered_list'].includes(oldModelBlockType.name)) {
              console.warn(`RitorVDOM (MutationObserver): Mutations on list containers (UL/OL) are not deeply reconciled by this PoC.`);
          } else {
            console.warn(`RitorVDOM (MutationObserver): Block type ${oldModelBlockType.name} not handled for detailed reconciliation.`);
          }
          this.isReconciling = false; this.lastAppliedChange = null; return;
      }
      console.log(`RitorVDOM (MutationObserver): Reconciling block ${oldModelBlockType.name} at index ${modelBlockIndex}. DOM Tag: ${domChangedBlock.nodeName}`);
      let newContentForBlock: BaseNode[];
      if (oldModelBlockType.name === 'blockquote') {
          newContentForBlock = [];
          Array.from(domChangedBlock.children).forEach(childElement => {
              if (childElement.nodeName === 'P') {
                  const pInlineNodes: BaseNode[] = [];
                  childElement.childNodes.forEach(pChild => {
                      if (pChild.nodeType === Node.TEXT_NODE) pInlineNodes.push(this.schema.text(pChild.textContent || ''));
                      else if (pChild.nodeType === Node.ELEMENT_NODE) {
                          const el = pChild as HTMLElement;
                          if(el.nodeName === 'STRONG') pInlineNodes.push(this.schema.text(el.textContent || '', [this.schema.marks.bold.create()]));
                          else if(el.nodeName === 'EM') pInlineNodes.push(this.schema.text(el.textContent || '', [this.schema.marks.italic.create()]));
                          else if(el.nodeName === 'S') pInlineNodes.push(this.schema.text(el.textContent || '', [this.schema.marks.strikethrough.create()]));
                          else if(el.nodeName === 'A') {
                            const href = el.getAttribute('href');
                            const title = el.getAttribute('title');
                            const linkMark = this.schema.marks.link;
                            if (linkMark && href) pInlineNodes.push(this.schema.text(el.textContent || '', [linkMark.create({href, title})]));
                            else pInlineNodes.push(this.schema.text(el.textContent || ''));
                          }
                          else if(el.nodeName === 'BR') pInlineNodes.push(this.schema.node("hard_break"));
                          else pInlineNodes.push(this.schema.text(el.textContent || ''));
                      }
                  });
                  newContentForBlock.push(this.schema.node("paragraph", {}, this.modelUtils.normalizeInlineArray(pInlineNodes)));
              } else {
                  console.warn(`Unexpected element ${childElement.nodeName} in blockquote during mutation parse, treating as new P.`);
                  newContentForBlock.push(this.schema.node("paragraph", {}, [this.schema.text(childElement.textContent || "")]));
              }
          });
          if (newContentForBlock.length === 0) {
              newContentForBlock = [this.schema.node("paragraph", {}, [this.schema.text("")])];
          }
      } else {
          const newInlineNodesFromDOM: BaseNode[] = [];
          let nodesToParseInline = domChangedBlock.childNodes;
          if(oldModelBlockType.name === 'list_item' && domChangedBlock.firstElementChild?.nodeName === 'P') {
              nodesToParseInline = domChangedBlock.firstElementChild.childNodes;
          }
          nodesToParseInline.forEach(inlineDomNode => {
            if (inlineDomNode.nodeType === Node.TEXT_NODE) newInlineNodesFromDOM.push(this.schema.text(inlineDomNode.textContent || ''));
            else if (inlineDomNode.nodeType === Node.ELEMENT_NODE) {
              const el = inlineDomNode as HTMLElement; const textContent = el.textContent || '';
              switch (el.nodeName) {
                case 'STRONG': const mB = this.schema.marks.bold; newInlineNodesFromDOM.push(this.schema.text(textContent, mB ? [mB.create()] : [])); break;
                case 'EM': const mI = this.schema.marks.italic; newInlineNodesFromDOM.push(this.schema.text(textContent, mI ? [mI.create()] : [])); break;
                case 'S': case 'DEL': case 'STRIKE': const mS = this.schema.marks.strikethrough; newInlineNodesFromDOM.push(this.schema.text(textContent, mS ? [mS.create()] : [])); break;
                case 'A':
                    const href = el.getAttribute('href');
                    const title = el.getAttribute('title');
                    const linkMark = this.schema.marks.link;
                    if(linkMark && href) newInlineNodesFromDOM.push(this.schema.text(textContent, [linkMark.create({href, title})]));
                    else newInlineNodesFromDOM.push(this.schema.text(textContent));
                    break;
                case 'BR': newInlineNodesFromDOM.push(this.schema.node("hard_break")); break;
                case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6':
                  console.warn(`RitorVDOM (MutationObserver): Found nested block ${el.nodeName} during inline parsing. Taking text only.`);
                  newInlineNodesFromDOM.push(this.schema.text(textContent));
                  break;
                default: newInlineNodesFromDOM.push(this.schema.text(textContent));
              }
            }
          });
          const normalizedInlineContent = this.modelUtils.normalizeInlineArray(newInlineNodesFromDOM);
          if(oldModelBlockType.name === 'list_item') {
              newContentForBlock = [this.schema.node("paragraph", {}, normalizedInlineContent)];
          } else {
              newContentForBlock = normalizedInlineContent;
          }
      }
      const newModelBlock = this.schema.node(oldModelBlockType, oldModelBlock.attrs, newContentForBlock);
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
            if (change.newType.name === 'heading' || change.newType.name === 'blockquote' || change.newType.name.endsWith("_list")) {
                if (change.newType.name.endsWith("_list")) { newPath = [changeBlockIndex, 0, 0, 0]; }
                else if (change.newType.name === 'blockquote') { newPath = [changeBlockIndex, 0, 0]; }
                else { newPath = [changeBlockIndex, 0]; }
                currentOffset = 0;
            }
        }
        return { path: newPath, offset: currentOffset };
    }
    if (changeBlockIndex !== posBlockIndex) {
        if (change.type === 'splitNode') { if (change.newParaPathIndex <= posBlockIndex) { newPath[0] += 1; } }
        else if (change.type === 'insertNode') {
            if (change.path[0] === posBlockIndex) { if (newPath.length > 1 && change.path[1] <= newPath[1]) newPath[1] +=1; }
        }
        return { path: newPath, offset: currentOffset };
    }
    const changeInlineIndex = change.path.length > 1 ? change.path[1] : -1;
    const posInlineIndex = newPath.length > 1 ? newPath[1] : -1;
    if (change.type === 'insertText') {
        if (posInlineIndex === changeInlineIndex && currentOffset >= change.offset) { currentOffset += change.length; }
    } else if (change.type === 'deleteText') {
        if (posInlineIndex === changeInlineIndex) {
            if (currentOffset > change.offset + change.length) { currentOffset -= change.length; }
            else if (currentOffset > change.offset) { currentOffset = change.offset; }
        }
    } else if (change.type === 'splitNode') {
        const splitAtInlineIndex = change.path[1];
        if (posBlockIndex === change.path[0]) {
            if (posInlineIndex === splitAtInlineIndex && currentOffset >= change.offset) {
                newPath[0] = change.newParaPathIndex;
                const newBlockAfterSplit = this.currentViewDoc.content?.[change.newParaPathIndex];
                if (newBlockAfterSplit && (newBlockAfterSplit.type as NodeType).name === 'paragraph' && newBlockAfterSplit.content && newBlockAfterSplit.content[0]?.type.name === 'text') {
                    newPath[1] = 0;
                } else { newPath.length = 1; }
                currentOffset = currentOffset - change.offset;
            } else if (posInlineIndex > splitAtInlineIndex) {
                newPath[0] = change.newParaPathIndex;
                newPath[1] = posInlineIndex - (splitAtInlineIndex + 1);
            }
        }
    } else if (change.type === 'insertNode') {
        if (posBlockIndex === change.path[0] && newPath.length > 1 && change.path.length > 1 && change.path[1] <= newPath[1]) {
             newPath[1] +=1;
        }
    } else if (change.type === 'formatMark') {
        // No change for PoC, assuming no node merging/splitting from simple mark changes.
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
       if (this.isReconciling) { Promise.resolve().then(() => { this.isReconciling = false; }); }
       return;
    }
    if (newDoc.type !== this.schema.topNodeType) {
        console.error(`Invalid document root type. Expected ${this.schema.topNodeType.name}, got ${(newDoc.type as NodeType).name}`);
        if (this.isReconciling) { Promise.resolve().then(() => { this.isReconciling = false; }); }
        return;
    }
    this.currentViewDoc = newDoc;
    this.domPatcher.patch(this.currentViewDoc);
    if (selectionToRestore) { this.applyModelSelectionToDom(selectionToRestore); }
    this.updateModelSelectionState();
    console.log("Document updated successfully.");
    console.log("Current HTML:", this.$el.innerHTML);
    if (this.isReconciling) { Promise.resolve().then(() => { this.isReconciling = false; }); }
  }

  public undo(): void {
    if (!this.undoManager.hasUndo()) { console.log("Nothing to undo"); return; }
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
    if (!this.undoManager.hasRedo()) { console.log("Nothing to redo"); return; }
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
    if (!this.currentViewDoc.content) { return; }
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
    if (!currentContent || paraIndex < 0 || paraIndex >= currentContent.length) return;
    const newContent = currentContent.map((block, index) => {
      if (index === paraIndex && (block.type as NodeType).name === 'paragraph') {
        return this.schema.node("paragraph", null, [this.schema.text(newText)]);
      } return block;
    });
    const newDoc = this.schema.node("doc", null, newContent);
    if (!this.domPatcher.areNodesEffectivelyEqual(this.currentViewDoc, newDoc)) {
        this.undoManager.add(this.currentViewDoc);
    }
    this.updateDocument(newDoc);
  }

  public toggleBoldOnFirstWordInParagraph(paraIndex: number): void {
    const currentContent = this.currentViewDoc.content;
    if (!currentContent || paraIndex < 0 || paraIndex >= currentContent.length) return;
    const newContent = currentContent.map((block, index): BaseNode => {
      if (index === paraIndex && (block.type as NodeType).name === 'paragraph') {
        const paraNode = block;
        if (!paraNode.content || paraNode.content.length === 0) return paraNode;
        const firstInlineNode = paraNode.content[0];
        if ((firstInlineNode.type as NodeType).name !== 'text') return paraNode;
        const textNode = firstInlineNode as ModelTextNode;
        const words = textNode.text.split(/(\s+)/);
        if (words.length === 0 || words[0].length === 0) return paraNode;
        const firstWord = words[0]; const restOfText = words.slice(1).join('');
        const currentMarks = textNode.marks || [];
        const boldMarkTypeFromSchema = this.schema.marks.bold;
        if (!boldMarkTypeFromSchema) return paraNode;
        const isBold = currentMarks.some(mark => mark.type === boldMarkTypeFromSchema);
        let newFirstWordMarks: AnyMark[];
        if (isBold) newFirstWordMarks = currentMarks.filter(mark => mark.type !== boldMarkTypeFromSchema);
        else newFirstWordMarks = [...currentMarks, boldMarkTypeFromSchema.create()];
        const newInlineNodes: BaseNode[] = [ this.schema.text(firstWord, newFirstWordMarks), ];
        if (restOfText) newInlineNodes.push(this.schema.text(restOfText, currentMarks));
        newInlineNodes.push(...paraNode.content.slice(1));
        return this.schema.node("paragraph", null, newInlineNodes);
      } return block;
    });
    const newDoc = this.schema.node("doc", null, newContent);
    if (!this.domPatcher.areNodesEffectivelyEqual(this.currentViewDoc, newDoc)) {
        this.undoManager.add(this.currentViewDoc);
    }
    this.updateDocument(newDoc);
  }

  public toggleMark(markTypeOrName: MarkType | string, attrs?: Attrs): void {
    this.updateModelSelectionState();
    if (!this.currentModelSelection) { console.warn("toggleMark: No selection."); return; }
    const markType = typeof markTypeOrName === 'string' ? this.schema.marks[markTypeOrName] : markTypeOrName;
    if (!markType) { console.error(`toggleMark: MarkType "${markTypeOrName}" not found.`); return; }
    const sel = this.currentModelSelection;
    const isCollapsed = sel.anchor.path.join(',') === sel.head.path.join(',') && sel.anchor.offset === sel.head.offset;
    if (isCollapsed) { console.log("toggleMark: Collapsed selection (TODO: stored marks)."); return; }
    this._applyMarkToRange(sel, markType, attrs);
  }

  private _applyMarkToRange(selection: ModelSelection, markType: MarkType, attrs: Attrs | null = {}): void { // attrs can be null for removal
    const fromPos = this._orderPositions(selection.anchor, selection.head)[0];
    const toPos = this._orderPositions(selection.anchor, selection.head)[1];

    if (fromPos.path[0] !== toPos.path[0]) { // Multi-block not supported for PoC
        console.warn("_applyMarkToRange: Multi-block selection not supported for PoC."); return;
    }
    const blockIndex = fromPos.path[0];
    const targetBlock = this.currentViewDoc.content?.[blockIndex];
    if (!targetBlock || !targetBlock.content || !(targetBlock.type as NodeType).allowsMarkType(markType) ) return;

    let newInlineContent: BaseNode[] = [];
    let markAppliedOrRemoved = false;

    // Determine if we are adding or removing the mark (based on content at start of selection)
    let shouldAddMark = true;
    if (attrs === null) { // Explicit removal
        shouldAddMark = false;
    } else { // Toggle or add with specific attrs
        const firstNodeIndex = fromPos.path[1];
        const firstNode = targetBlock.content[firstNodeIndex];
        if (firstNode && (firstNode.type as NodeType).isText) {
            const textN = firstNode as ModelTextNode;
            const marks = textN.marks || [];
            if(marks.some(m => m.type === markType && JSON.stringify(m.attrs || null) === JSON.stringify(attrs || null))) {
                 shouldAddMark = false; // Mark with same attrs exists, so toggle means remove
            }
        }
    }

    targetBlock.content.forEach((inlineNode, index) => {
      if ((inlineNode.type as NodeType).isText) {
        const textNode = inlineNode as ModelTextNode;
        const nodeStartOffset = 0;
        const nodeEndOffset = textNode.text.length;

        const selStartIndex = fromPos.path.length > 1 && index === fromPos.path[1] ? fromPos.offset : nodeStartOffset;
        const selEndIndex = toPos.path.length > 1 && index === toPos.path[1] ? toPos.offset : nodeEndOffset;

        if (index > fromPos.path[1] && index < toPos.path[1]) { // Node fully selected
          newInlineContent.push(this._updateTextNodeMarks(textNode, markType, attrs, shouldAddMark));
          markAppliedOrRemoved = true;
        } else if (index === fromPos.path[1] && index === toPos.path[1]) { // Selection within this single node
          if (selStartIndex < selEndIndex) { // Range selection
            newInlineContent.push(...this._splitAndApplyMarkToTextNode(textNode, selStartIndex, selEndIndex, markType, attrs, shouldAddMark));
            markAppliedOrRemoved = true;
          } else newInlineContent.push(textNode);
        } else if (index === fromPos.path[1]) { // Start of selection range
          newInlineContent.push(...this._splitAndApplyMarkToTextNode(textNode, selStartIndex, nodeEndOffset, markType, attrs, shouldAddMark));
          markAppliedOrRemoved = true;
        } else if (index === toPos.path[1]) { // End of selection range
          newInlineContent.push(...this._splitAndApplyMarkToTextNode(textNode, nodeStartOffset, selEndIndex, markType, attrs, shouldAddMark));
          markAppliedOrRemoved = true;
        } else { // Node outside selection
          newInlineContent.push(inlineNode);
        }
      } else { // Non-text inline node
        newInlineContent.push(inlineNode);
      }
    });

    if (!markAppliedOrRemoved) return;

    const normalizedNewInlineContent = this.modelUtils.normalizeInlineArray(newInlineContent);
    const newBlock = this.schema.node(targetBlock.type as NodeType, targetBlock.attrs, normalizedNewInlineContent);
    const newDocContent = [...(this.currentViewDoc.content || [])];
    newDocContent[blockIndex] = newBlock;
    const newDoc = this.schema.node(this.currentViewDoc.type as NodeType, this.currentViewDoc.attrs, newDocContent);

    if (!this.domPatcher.areNodesEffectivelyEqual(this.currentViewDoc, newDoc)) {
        this.undoManager.add(this.currentViewDoc);
    }
    this.lastAppliedChange = { type: 'formatMark', from: selection.anchor, to: selection.head, markType: markType.name, attrs };
    this.updateDocument(newDoc);
  }

  private _splitAndApplyMarkToTextNode(textNode: ModelTextNode, start: number, end: number, markType: MarkType, attrs: Attrs | null, shouldAdd: boolean): BaseNode[] {
    const result: BaseNode[] = [];
    const text = textNode.text;
    const marks = textNode.marks || [];

    if (start > 0) result.push(this.schema.text(text.slice(0, start), marks));

    const selectedText = text.slice(start, end);
    if (selectedText) {
        let newMarks = shouldAdd ?
            (marks.some(m => m.type === markType && JSON.stringify(m.attrs || null) === JSON.stringify(attrs || null)) ?
                marks : [...marks, markType.create(attrs || undefined)]) :
            marks.filter(m => !(m.type === markType && (attrs === null || JSON.stringify(m.attrs || null) === JSON.stringify(attrs || null))));

        // Ensure no duplicate mark types if adding (e.g. bold then bold again)
        if (shouldAddMark && attrs !== null) {
            newMarks = newMarks.filter((m, i, self) => i === self.findIndex(t => t.type === m.type));
        }
        result.push(this.schema.text(selectedText, newMarks));
    }

    if (end < text.length) result.push(this.schema.text(text.slice(end), marks));
    return result;
  }

  private _updateTextNodeMarks(textNode: ModelTextNode, markType: MarkType, attrs: Attrs | null, shouldAdd: boolean): BaseNode {
    let currentMarks = textNode.marks || [];
    if (shouldAdd && attrs !== null) { // Add or update mark
        // Remove existing mark of same type, then add new one (to update attrs)
        currentMarks = currentMarks.filter(m => m.type !== markType);
        currentMarks = [...currentMarks, markType.create(attrs)];
    } else { // Remove mark (attrs is null or shouldAdd is false based on prior check)
        currentMarks = currentMarks.filter(m => m.type !== markType);
    }
    return this.schema.text(textNode.text, currentMarks);
  }

  private _getMarkAttrsInSelection(markType: MarkType): Attrs | null {
      if (!this.currentModelSelection) return null;
      // Simplified: check the marks at the start of the selection (anchor)
      const pos = this.currentModelSelection.anchor;
      if (pos.path.length < 2) return null; // Needs to be within inline content

      const block = this.currentViewDoc.content?.[pos.path[0]];
      if (!block || !block.content) return null;
      const inlineNode = block.content[pos.path[1]];

      if (inlineNode && (inlineNode.type as NodeType).isText) {
          const textNode = inlineNode as ModelTextNode;
          const existingMark = (textNode.marks || []).find(m => m.type === markType);
          return existingMark ? existingMark.attrs : null;
      }
      return null;
  }

  private _orderPositions(pos1: ModelPosition, pos2: ModelPosition): [ModelPosition, ModelPosition] {
      // Simplified: assumes paths are comparable by array order and then offset
      if (pos1.path.join(',') < pos2.path.join(',') || (pos1.path.join(',') === pos2.path.join(',') && pos1.offset < pos2.offset)) {
          return [pos1, pos2];
      }
      return [pos2, pos1];
  }

  public promptAndSetLink(): void {
    this.updateModelSelectionState();
    const selection = this.currentModelSelection;
    if (!selection || (selection.anchor.path.join(',') === selection.head.path.join(',') && selection.anchor.offset === selection.head.offset)) {
         alert("Please select text to create or edit a link.");
         return;
    }
    const linkMarkType = this.schema.marks.link;
    if (!linkMarkType) { console.error("Link mark type not defined in schema."); return; }

    const existingAttrs = this._getMarkAttrsInSelection(linkMarkType);
    const currentHref = existingAttrs ? (existingAttrs.href as string || "") : "https://";

    const href = window.prompt("Enter link URL:", currentHref);

    if (href === null) return; // User cancelled
    this.toggleLink(href);
  }

  public toggleLink(href?: string | null): void {
    this.updateModelSelectionState();
    const selection = this.currentModelSelection;
    if (!selection || (selection.anchor.path.join(',') === selection.head.path.join(',') && selection.anchor.offset === selection.head.offset)) {
        console.log("toggleLink: Collapsed selection, no action for PoC.");
        return;
    }
    const linkMarkType = this.schema.marks.link;
    if(!linkMarkType) return;

    if (href && href.trim() !== "") {
        this._applyMarkToRange(selection, linkMarkType, { href });
    } else {
        this._applyMarkToRange(selection, linkMarkType, null);
    }
  }


  public getDocJson(): string {
      return JSON.stringify(this.currentViewDoc, null, 2);
  }
}

console.log("RitorVDOM class defined. Example usage is sketched for browser environment.");
[end of src/RitorVDOM.ts]
