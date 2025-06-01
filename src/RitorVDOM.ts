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
import { DOMParser as RitorDOMParser } from './domParser.js'; // Added import

type SimpleChange =
  | { type: 'insertText'; path: number[]; offset: number; length: number }
  | { type: 'deleteText'; path: number[]; offset: number; length: number }
  | { type: 'splitNode'; path: number[]; offset: number;
      newParaPathIndex: number;
    }
  | { type: 'transformBlock'; path: number[]; newType: NodeType; newAttrs?: any }
  | { type: 'insertNode'; path: number[]; node: BaseNode }
  | { type: 'formatMark'; from: ModelPosition, to: ModelPosition, markType: string, attrs?: Attrs }
  | { type: 'paste'; path: number[]; offset: number; numBlocksInserted?: number; inlineContentLength?: number }; // For paste

export class RitorVDOM {
  public $el: HTMLElement;
  public currentViewDoc: BaseNode;
  private domPatcher: DomPatcher;
  public readonly schema: Schema;
  private modelUtils: ModelUtils;
  private undoManager: UndoManager;
  private domParser: RitorDOMParser; // Added domParser instance
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
    this.domParser = new RitorDOMParser(this.schema); // Initialize domParser

    this.currentViewDoc = this.schema.node("doc", null, [
      this.schema.node("paragraph", {id: this.schema.generateNodeId()}, [ // Ensure initial nodes have IDs
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

  // TODO: SELECTION MAPPING - CRITICAL FOR ROBUSTNESS (domToModelPosition)
  private _domToModelPositionRecursive(
    targetDomNode: globalThis.Node,
    targetDomOffset: number,
    currentModelParentNode: BaseNode,
    currentDomParentMatchingModel: HTMLElement,
    modelPathToCurrentParent: number[]
  ): ModelPosition | null {
    if (!currentModelParentNode.content) {
      if ((currentModelParentNode.type as NodeType).isText && currentDomParentMatchingModel === targetDomNode.parentNode && targetDomNode.nodeType === Node.TEXT_NODE) {
        return { path: modelPathToCurrentParent, offset: targetDomOffset };
      }
      console.warn("_domToModelPositionRecursive: currentModelParentNode has no content or is not a direct text match.", currentModelParentNode, targetDomNode);
      return null;
    }

    let currentDomChildNode: globalThis.Node | null = currentDomParentMatchingModel.firstChild;
    let modelCharOffsetAccumulator = 0; // Accumulates char length of *previous model siblings*

    for (let modelChildIndex = 0; modelChildIndex < currentModelParentNode.content.length; modelChildIndex++) {
      const childModelNode = currentModelParentNode.content[modelChildIndex];
      const childModelNodeType = childModelNode.type as NodeType;
      const currentModelPathSegment = [...modelPathToCurrentParent, modelChildIndex];

      if (!currentDomChildNode) {
        break;
      }

      const advanceToNextMeaningfulDomSibling = (startNode: globalThis.Node | null): globalThis.Node | null => {
          let node = startNode;
          while(node && node.nodeType === Node.TEXT_NODE && (node.textContent || "").trim() === "") {
              node = node.nextSibling;
          }
          return node;
      };

      currentDomChildNode = advanceToNextMeaningfulDomSibling(currentDomChildNode);
      if (!currentDomChildNode) break;

      let domNodeProcessedForThisModelChild = currentDomChildNode;

      if (childModelNodeType.isText) {
        const modelTextNode = childModelNode as ModelTextNode;

        // findTextRecursive explores the DOM structure corresponding to *this single modelTextNode*.
        // It needs to determine if targetDomNode is within this structure.
        // `modelCharOffsetAccumulator` is the offset *before* this modelTextNode.
        const findTextRecursive = (
            currentSearchDomNode: globalThis.Node, // Current DOM node being explored (text or element mark)
            baseModelOffsetForNode: number // Model offset corresponding to the start of currentSearchDomNode's text content
        ): ModelPosition | null => { // Returns full ModelPosition if target found
            if (currentSearchDomNode.nodeType === Node.TEXT_NODE) {
                if (currentSearchDomNode === targetDomNode) {
                    // Target found. baseModelOffsetForNode is char offset up to this text node's start.
                    // targetDomOffset is char offset within this specific targetDomNode.
                    return { path: currentModelPathSegment, offset: baseModelOffsetForNode + targetDomOffset };
                }
                return null; // Target not this text node
            }

            if (currentSearchDomNode.nodeType === Node.ELEMENT_NODE) { // Mark element
                if (currentSearchDomNode === targetDomNode) { // Selection is ON the mark element itself
                    // targetDomOffset is the child index within this mark element.
                    // Calculate the character length of children before targetDomOffset-th child.
                    let charLengthBeforeTargetChild = 0;
                    for (let k = 0; k < targetDomOffset; k++) {
                        charLengthBeforeTargetChild += currentSearchDomNode.childNodes[k]?.textContent?.length || 0;
                    }
                    // The model offset is the base offset + this character length.
                    return { path: currentModelPathSegment, offset: baseModelOffsetForNode + charLengthBeforeTargetChild };
                }

                // Recursively search within this mark element's children
                let accumulatedCharLengthWithinMark = 0;
                for (let k = 0; k < currentSearchDomNode.childNodes.length; k++) {
                    const innerDomNode = currentSearchDomNode.childNodes[k];
                    const result = findTextRecursive(innerDomNode, baseModelOffsetForNode + accumulatedCharLengthWithinMark);
                    if (result) return result; // Target found in recursion
                    accumulatedCharLengthWithinMark += innerDomNode.textContent?.length || 0;
                }
            }
            return null; // Target not found in this branch
        };

        const resultInTextNodeOrMarks = findTextRecursive(currentDomChildNode, modelCharOffsetAccumulator);
        if (resultInTextNodeOrMarks) return resultInTextNodeOrMarks;

        modelCharOffsetAccumulator += modelTextNode.text.length;

      } else if (childModelNodeType.spec.atom) {
        if (currentDomChildNode === targetDomNode) {
          return { path: currentModelPathSegment, offset: targetDomOffset === 0 ? 0 : 1 };
        }
        if (currentDomChildNode.parentNode === targetDomNode) {
            const atomIndexInParent = Array.from(targetDomNode.childNodes).indexOf(currentDomChildNode as ChildNode);
            if (targetDomOffset === atomIndexInParent) return { path: currentModelPathSegment, offset: 0 }; // Before atom
            if (targetDomOffset === atomIndexInParent + 1) return { path: currentModelPathSegment, offset: 1 }; // After atom
        }
        modelCharOffsetAccumulator += 1;
      } else {
        console.warn("Unhandled nested non-atom inline model node in _domToModelPositionRecursive", childModelNode);
      }
      currentDomChildNode = domNodeProcessedForThisModelChild.nextSibling;
    }

    // If selection is on the block element itself (e.g., empty paragraph)
    if (currentDomParentMatchingModel === targetDomNode) {
        if (currentModelParentNode.content.length === 0 && targetDomOffset === 0) { // Empty block
            return { path: modelPathToCurrentParent, offset: 0 };
        }
        // If targetDomOffset refers to a child index within the block element
        if (targetDomOffset < currentModelParentNode.content.length) { // map to start of that model child
             return {path: [...modelPathToCurrentParent, targetDomOffset], offset: 0};
        }
        if (targetDomOffset >= currentModelParentNode.content.length && currentModelParentNode.content.length > 0) { // after last child
            const lastChildIdx = currentModelParentNode.content.length -1;
            const lastChild = currentModelParentNode.content[lastChildIdx];
            const offsetInLast = (lastChild.type as NodeType).isText ? (lastChild as ModelTextNode).text.length : 1;
            return {path: [...modelPathToCurrentParent, lastChildIdx], offset: offsetInLast};
        }
        console.warn("_domToModelPositionRecursive: Selection on block element, offset unhandled", targetDomNode, targetDomOffset);
        return { path: modelPathToCurrentParent, offset: targetDomOffset }; // Fallback
    }

    // Fallback for text nodes directly under the block, not matched via model's inline structure.
    // This implies the DOM text node doesn't correspond to any specific model inline node.
    // In such cases, it's difficult to map accurately. Returning null is safer.
    if (targetDomNode.parentNode === currentDomParentMatchingModel && targetDomNode.nodeType === Node.TEXT_NODE) {
        console.warn("_domToModelPositionRecursive: Unmapped text node directly under block.", targetDomNode);
        // Option 1: Try to place cursor relative to the end of the last known model child.
        // This is complex because targetDomOffset is within the unmapped text node.
        // Option 2: Return null to indicate inability to map this specific scenario.
        return null;
    }
    return null;
  }

  private domToModelPosition(selectionDomNode: globalThis.Node, selectionDomOffset: number): ModelPosition | null {
    let targetDomNode = selectionDomNode;
    let targetDomOffset = selectionDomOffset;

    // 1. Normalize targetDomNode and targetDomOffset
    // If selection is on an element, domOffset is child index.
    // If selection is in a text node, domOffset is char offset.
    if (targetDomNode.nodeType === Node.ELEMENT_NODE) {
      // If offset points to a child node, make that child the target.
      // This simplifies logic as we mostly care about char offsets in text or positions relative to atoms.
      if (targetDomNode.childNodes.length > 0 && targetDomOffset < targetDomNode.childNodes.length) {
        targetDomNode = targetDomNode.childNodes[targetDomOffset];
        targetDomOffset = 0; // Offset is now 0 within this new targetDomNode (or at its start)
      } else if (targetDomNode.childNodes.length > 0 && targetDomOffset >= targetDomNode.childNodes.length) {
        // Selection is after the last child of this element
        targetDomNode = targetDomNode.childNodes[targetDomOffset -1];
        targetDomOffset = (targetDomNode.nodeType === Node.TEXT_NODE) ? (targetDomNode.textContent?.length || 0) : 1;
      }
      // If element is empty, targetDomOffset remains 0 relative to the element itself.
    }

    // 2. Find the parent block DOM element and its model representation.
    let currentDomElem: HTMLElement | null = targetDomNode.nodeType === Node.TEXT_NODE ?
                                            targetDomNode.parentNode as HTMLElement :
                                            targetDomNode as HTMLElement;
    let modelBlockNode: BaseNode | null = null;
    let modelBlockPath: number[] = [];

    while (currentDomElem && currentDomElem !== this.$el) {
      const id = currentDomElem.id;
      if (id && this.currentViewDoc.content) {
        const blockIndex = this.currentViewDoc.content.findIndex(n => n.attrs?.id === id);
        if (blockIndex !== -1) {
          modelBlockNode = this.currentViewDoc.content[blockIndex];
          modelBlockPath = [blockIndex];
          break;
        }
      }
      currentDomElem = currentDomElem.parentNode as HTMLElement | null;
    }

    if (!modelBlockNode || !currentDomElem) {
      // Special case: selection is directly in $el or $el has no identifiable blocks
      if (selectionDomNode === this.$el) return { path: [], offset: selectionDomOffset }; // Path to root
      console.warn("domToModelPosition: Containing block not found or not identifiable by ID.");
      // Fallback: try to find based on direct children of $el if no ID matched
      if (this.currentViewDoc.content && this.currentViewDoc.content.length > 0) {
          let blockIndex = -1;
          if (currentDomElem && currentDomElem.parentNode === this.$el) {
              blockIndex = Array.from(this.$el.children).indexOf(currentDomElem);
          } else if (targetDomNode.parentNode === this.$el) { // e.g. text node directly in $el
              blockIndex = Array.from(this.$el.childNodes).indexOf(targetDomNode);
          } else if (targetDomNode === this.$el && this.$el.children.length > 0) {
              // If selection is on $el, and domOffset points to a block child
              if (selectionDomOffset < this.$el.children.length) {
                 const childBlock = this.$el.children[selectionDomOffset] as HTMLElement;
                 const childBlockId = childBlock.id;
                 if (childBlockId) {
                    blockIndex = this.currentViewDoc.content.findIndex(n => n.attrs?.id === childBlockId);
                 }
                 if (blockIndex === -1) blockIndex = selectionDomOffset; // Fallback to index
              }
          }


          if (blockIndex !== -1 && blockIndex < this.currentViewDoc.content.length) {
              modelBlockNode = this.currentViewDoc.content[blockIndex];
              modelBlockPath = [blockIndex];
              currentDomElem = this.$el.children[blockIndex] as HTMLElement; // This is the identified block's DOM
          } else {
            console.warn("domToModelPosition: Fallback to find block by index failed or out of bounds.");
            return null;
          }
      } else {
        return null; // No content in doc, or other unhandled scenarios
      }
    }

    // 3. Recursively find position within the block
    const result = this._domToModelPositionRecursive(targetDomNode, targetDomOffset, modelBlockNode, currentDomElem, modelBlockPath);
    if (!result) {
        console.warn(`domToModelPosition: _domToModelPositionRecursive failed to find precise position within block.`);
        // If recursive step fails, it means a precise inline position wasn't found.
        // Returning null is safer than a potentially incorrect broad fallback to the block level
        // with an offset that might not make sense in that context.
        return null;
    }
    return result;
  }


  private _mapModelToDomInline(
    targetModelNode: BaseNode, // The specific inline model node (e.g. TextNode, HardBreakNode)
    targetModelOffset: number, // Offset within this targetModelNode
    parentDomElement: HTMLElement, // The DOM element corresponding to the parent of targetModelNode
    parentModelNode: BaseNode // The parent model node containing targetModelNode
  ): { node: globalThis.Node; offset: number } | null {
    if (!parentModelNode.content) return null;

    let currentDomChild: globalThis.Node | null = parentDomElement.firstChild;
    // cumulativeModelCharOffset is not strictly needed here as in domToModel,
    // because we are finding a specific targetModelNode first.

    const advanceToNextMeaningfulDomSibling = (startNode: globalThis.Node | null): globalThis.Node | null => {
        let node = startNode;
        while(node && node.nodeType === Node.TEXT_NODE && (node.textContent || "").trim() === "") {
            node = node.nextSibling;
        }
        return node;
    };

    for (const modelChild of parentModelNode.content) {
      currentDomChild = advanceToNextMeaningfulDomSibling(currentDomChild);
      if (!currentDomChild) {
        console.error("_mapModelToDomInline: Ran out of DOM children while searching for model child.", modelChild, parentDomElement);
        return null;
      }

      if (modelChild === targetModelNode) { // Found the target model node in parent's content
        if ((targetModelNode.type as NodeType).isText) {
          // Target is a TextNode. currentDomChild should be its DOM representation (text or mark element).
          // We need to find the actual text node and apply targetModelOffset.

          const findDomTextNodeRecursive = (
            seekerDomNode: globalThis.Node, // current DOM node we are looking into
            offsetToReachInModel: number // char offset we need to reach in model text
          ): { node: globalThis.Node; offset: number } | null => {
            if (seekerDomNode.nodeType === Node.TEXT_NODE) {
              const textLength = seekerDomNode.textContent?.length || 0;
              if (offsetToReachInModel <= textLength) {
                return { node: seekerDomNode, offset: offsetToReachInModel };
              }
              // This specific DOM text node is shorter than offsetToReachInModel.
              // This implies offsetToReachInModel is in a *subsequent* DOM text node
              // that is part of the same model TextNode (e.g. due to browser splitting, though less common with our rendering).
              // Or, offset is out of bounds. For robustness, cap at end of current node.
              console.warn(`_mapModelToDomInline (findDomTextNodeRecursive): offset ${offsetToReachInModel} is beyond text node length ${textLength}.`);
              return { node: seekerDomNode, offset: textLength };
            }

            if (seekerDomNode.nodeType === Node.ELEMENT_NODE) { // Mark element
              let accumulatedCharLengthWithinMark = 0;
              for (let k = 0; k < seekerDomNode.childNodes.length; k++) {
                const innerDomNode = seekerDomNode.childNodes[k];
                // The offset to reach in the recursive call is relative to the start of innerDomNode's content
                const offsetForNextRecursion = Math.max(0, offsetToReachInModel - accumulatedCharLengthWithinMark);
                const result = findDomTextNodeRecursive(innerDomNode, offsetForNextRecursion);

                if (result) { // If a valid text node and offset was found by the recursive call
                    return result; // Propagate the valid result upwards
                }
                // If no result from recursion, it means target is not in this innerDomNode,
                // OR target *was* in it, but offsetToReachInModel was < 0 for it (handled by Math.max(0, ...)).
                // So, we add this innerDomNode's length to accumulatedCharLengthWithinMark and continue to the next sibling.
                accumulatedCharLengthWithinMark += innerDomNode.textContent?.length || 0;

                // If the original offsetToReachInModel falls within the character span of THIS innerDomNode,
                // but it wasn't a text node itself and recursive call didn't find a text node (e.g. it's an empty mark or other element),
                // then the position is effectively at the boundary.
                // This is for cases like <em>|</em> where | is model offset 0 inside an empty em.
                if (offsetToReachInModel >= accumulatedCharLengthWithinMark - (innerDomNode.textContent?.length ||0) && offsetToReachInModel < accumulatedCharLengthWithinMark ) {
                    // Position is likely at the end of the previous node or start of this one, relative to seekerDomNode
                    return { node: seekerDomNode, offset: k + 1};
                }
              }
              // If offsetToReachInModel is beyond all children's text content, place at end of this mark element
              if (offsetToReachInModel >= accumulatedCharLengthWithinMark) {
                return { node: seekerDomNode, offset: seekerDomNode.childNodes.length };
              }
            }
            return null;
          };

          const result = findDomTextNodeRecursive(currentDomChild, targetModelOffset);
          if (result) return result;

          console.warn("_mapModelToDomInline: Text node not found precisely, falling back to parentDomElement.", targetModelNode, targetModelOffset);
          return { node: parentDomElement, offset: parentDomElement.childNodes.length }; // Fallback

        } else if ((targetModelNode.type as NodeType).spec.atom) { // Atom node (e.g., hard_break)
          // currentDomChild is the <br> (or similar).
          // targetModelOffset is 0 (before) or 1 (after).
          // The DOM selection offset is relative to parentDomElement.
          const atomIndex = Array.from(parentDomElement.childNodes).indexOf(currentDomChild as ChildNode);
          if (atomIndex === -1) { console.error("Atom DOM node not found in parent"); return null; }
          return { node: parentDomElement, offset: atomIndex + targetModelOffset };
        }
      }
      // If not the targetModelNode, advance currentDomChild to its next sibling for the next modelChild.
      currentDomChild = currentDomChild.nextSibling;
    }
    console.error("_mapModelToDomInline: Target model node not found among parent's children.", targetModelNode, parentModelNode);
    return null;
  }


  // Overhauled modelToDomPosition
  private modelToDomPosition(modelPos: ModelPosition): { node: globalThis.Node; offset: number } | null {
    if (!modelPos || !modelPos.path || modelPos.path.length === 0) {
        console.warn("modelToDomPosition: Invalid ModelPosition provided.", modelPos);
        if (modelPos && modelPos.path && modelPos.path.length === 0) { // Path to doc itself
            const firstChild = this.$el.firstChild;
            if (firstChild) { // Position at start of first child of editor
                return { node: firstChild.nodeType === Node.TEXT_NODE ? firstChild : this.$el, offset: 0 };
            }
            return { node: this.$el, offset: 0}; // Empty editor
        }
        return null;
    }

    let currentModelParent: BaseNode = this.currentViewDoc;
    let currentDomParent: HTMLElement = this.$el;
    // targetModelNode will be identified at the end of the loop, or if path has only 1 segment.

    // 1. Traverse path to find the DOM element for the direct parent of the target model node.
    // Example: modelPos path [b, i, t], b=blockIdx, i=inlineParentIdx, t=textNodeIdx
    // Loop runs for b and i. currentModelParent becomes model.content[b].content[i]. currentDomParent becomes its DOM.
    // Target will be currentModelParent.content[t].
    for (let depth = 0; depth < modelPos.path.length - 1; depth++) {
      const modelNodeIndex = modelPos.path[depth];
      if (!currentModelParent.content || modelNodeIndex >= currentModelParent.content.length) {
        console.error("modelToDomPosition: Invalid model path segment (parent traversal).", modelPos, depth);
        return null;
      }
      const nextModelNodeAsParent = currentModelParent.content[modelNodeIndex];
      let nextDomElementAsParent: HTMLElement | null = null;

      // Find DOM element for nextModelNodeAsParent, which is a child of currentDomParent
      let domChild = currentDomParent.firstChild;
      let modelSiblingCounter = 0;
      let foundDomForNextModelParent = false;
      while(domChild) {
        // This simple counter assumes direct model-to-DOM element mapping at block/list_item level
        // TODO: This needs to be more robust for complex list structures or nested blocks if ever introduced.
        if (domChild.nodeType === Node.ELEMENT_NODE) {
            // Check if this DOM element corresponds to nextModelNodeAsParent
            // Priority for ID match if available
            if ((nextModelNodeAsParent.type as NodeType).isBlock && nextModelNodeAsParent.attrs?.id && (domChild as HTMLElement).id === nextModelNodeAsParent.attrs.id) {
                nextDomElementAsParent = domChild as HTMLElement;
                foundDomForNextModelParent = true;
                break;
            }
            // Fallback to index if no ID or ID didn't match this one
            if (modelSiblingCounter === modelNodeIndex && !nextModelNodeAsParent.attrs?.id) { // Only use index if no ID on model
                 nextDomElementAsParent = domChild as HTMLElement;
                 foundDomForNextModelParent = true;
                 // Don't break, continue to see if an ID match is found later (stronger)
            }
            modelSiblingCounter++;
        }
        domChild = domChild.nextSibling;
      }
      // If after checking all children, we relied on an indexed match (and no ID match was found or applicable)
      if (!foundDomForNextModelParent && nextDomElementAsParent) {
          foundDomForNextModelParent = true;
      }
      // If still no match, and model had ID, try querySelector as last resort (if DOM isn't flat)
      if (!foundDomForNextModelParent && (nextModelNodeAsParent.type as NodeType).isBlock && nextModelNodeAsParent.attrs?.id) {
          const foundById = currentDomParent.querySelector(`#${nextModelNodeAsParent.attrs.id}`);
          if (foundById && foundById.parentNode === currentDomParent) { // Must be direct child
              nextDomElementAsParent = foundById as HTMLElement;
              foundDomForNextModelParent = true;
          }
      }


      if (!foundDomForNextModelParent || !nextDomElementAsParent) {
        console.error(`modelToDomPosition: DOM element for model parent node at path segment ${depth} not found.`);
        return null;
      }
      currentModelParent = nextModelNodeAsParent;
      currentDomParent = nextDomElementAsParent;
    }

    // 2. Identify the actual target model node (the last segment in path)
    const targetNodeIndex = modelPos.path[modelPos.path.length - 1];
    if (!currentModelParent.content || targetNodeIndex >= currentModelParent.content.length) {
      console.error("modelToDomPosition: Invalid target node index in path.", modelPos, targetNodeIndex, currentModelParent);
      return null;
    }
    const targetModelNode = currentModelParent.content[targetNodeIndex];

    // 3. If targetModelNode is a block, currentDomParent should be its DOM element.
    // (This case implies modelPos.path had only one segment, e.g. [0] for the first block)
    if ((targetModelNode.type as NodeType).isBlock) {
      // The loop for parent traversal (length-1) would not have run if path is [idx].
      // So currentDomParent is $el, currentModelParent is doc.
      // We need to find the DOM element for targetModelNode (which is currentModelParent.content[targetNodeIndex])
      let targetBlockDom: HTMLElement | null = null;
      if (targetModelNode.attrs?.id) {
        targetBlockDom = currentDomParent.querySelector(`#${targetModelNode.attrs.id}`) as HTMLElement;
         if (targetBlockDom && targetBlockDom.parentNode !== currentDomParent) targetBlockDom = null; // Must be direct child
      }
      if (!targetBlockDom) { // Fallback to index
          let count = 0;
          let child = currentDomParent.firstChild;
          while(child){
              if(child.nodeType === Node.ELEMENT_NODE){
                  if(count === targetNodeIndex) { targetBlockDom = child as HTMLElement; break;}
                  count++;
              }
              child = child.nextSibling;
          }
      }

      if (!targetBlockDom) {
        console.error("modelToDomPosition: Target block DOM element not found.", targetModelNode);
        return null;
      }
      // modelPos.offset is usually a child index within this block or 0.
      if (modelPos.offset <= targetBlockDom.childNodes.length) {
        return { node: targetBlockDom, offset: modelPos.offset };
      }
      return { node: targetBlockDom, offset: targetBlockDom.childNodes.length }; // Cap at end
    } else { // Target is inline (TextNode, HardBreakNode)
      // currentDomParent is the DOM element of the block/element containing this inline node.
      // currentModelParent is the model block/element containing this inline node.
      return this._mapModelToDomInline(targetModelNode, modelPos.offset, currentDomParent, currentModelParent);
    }
  }

  // ... (rest of RitorVDOM: applyModelSelectionToDom, handleBeforeInput, handleMutations, updateDocument, undo/redo, example methods)
  // ... (ensure mapDomSelectionToModel is called in relevant places, and applyModelSelectionToDom in updateDocument)
  // ... (SimpleChange and mapModelPosition are also present from previous step)

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

    // Handle word deletion first as they are specific cases of text deletion
    if (event.inputType === 'deleteWordBackward' && currentModelPos) {
      event.preventDefault();
      const { path: modelPath, offset: textOffset } = currentModelPos;
      if (modelPath.length < 2) { console.warn("deleteWordBackward: Path too short for text node."); return; }
      const modelBlockIndex = modelPath[0];
      const modelInlineNodeIndex = modelPath[1];
      const currentBlockNode = this.currentViewDoc.content?.[modelBlockIndex];
      const targetModelTextNode = currentBlockNode?.content?.[modelInlineNodeIndex] as ModelTextNode | undefined;

      if (targetModelTextNode && targetModelTextNode.type.name === 'text' && textOffset > 0) {
        const text = targetModelTextNode.text;
        let deleteFrom = textOffset -1;
        while(deleteFrom > 0 && text[deleteFrom -1] !== ' ') { // Find start of word or text
            deleteFrom--;
        }
        const newText = text.slice(0, deleteFrom) + text.slice(textOffset);
        const deletedLength = textOffset - deleteFrom;
        this.lastAppliedChange = { type: 'deleteText', path: [...modelPath], offset: deleteFrom, length: deletedLength };

        const newInlineContent = [...(currentBlockNode!.content || [])];
        newInlineContent[modelInlineNodeIndex] = this.schema.text(newText, targetModelTextNode.marks);
        const normalizedNewInlineContent = this.modelUtils.normalizeInlineArray(newInlineContent);
        const updatedBlock = this.schema.node(currentBlockNode!.type as NodeType, currentBlockNode!.attrs, normalizedNewInlineContent);
        const newDocContent = [...(this.currentViewDoc.content || [])];
        newDocContent[modelBlockIndex] = updatedBlock;
        newDoc = this.schema.node(this.currentViewDoc.type as NodeType, this.currentViewDoc.attrs, newDocContent);
      }
    } else if (event.inputType === 'deleteWordForward' && currentModelPos) {
      event.preventDefault();
      const { path: modelPath, offset: textOffset } = currentModelPos;
      if (modelPath.length < 2) { console.warn("deleteWordForward: Path too short for text node."); return; }
      const modelBlockIndex = modelPath[0];
      const modelInlineNodeIndex = modelPath[1];
      const currentBlockNode = this.currentViewDoc.content?.[modelBlockIndex];
      const targetModelTextNode = currentBlockNode?.content?.[modelInlineNodeIndex] as ModelTextNode | undefined;

      if (targetModelTextNode && targetModelTextNode.type.name === 'text' && textOffset < targetModelTextNode.text.length) {
        const text = targetModelTextNode.text;
        let deleteTo = textOffset;
        while(deleteTo < text.length && text[deleteTo] !== ' ') { // Find end of word or text
            deleteTo++;
        }
        const newText = text.slice(0, textOffset) + text.slice(deleteTo);
        const deletedLength = deleteTo - textOffset;
        this.lastAppliedChange = { type: 'deleteText', path: [...modelPath], offset: textOffset, length: deletedLength };

        const newInlineContent = [...(currentBlockNode!.content || [])];
        newInlineContent[modelInlineNodeIndex] = this.schema.text(newText, targetModelTextNode.marks);
        const normalizedNewInlineContent = this.modelUtils.normalizeInlineArray(newInlineContent);
        const updatedBlock = this.schema.node(currentBlockNode!.type as NodeType, currentBlockNode!.attrs, normalizedNewInlineContent);
        const newDocContent = [...(this.currentViewDoc.content || [])];
        newDocContent[modelBlockIndex] = updatedBlock;
        newDoc = this.schema.node(this.currentViewDoc.type as NodeType, this.currentViewDoc.attrs, newDocContent);
      }
    } else if (event.inputType === 'formatBold') {
        event.preventDefault();
        if (this.schema.marks.bold) this.toggleMark(this.schema.marks.bold);
        return; // toggleMark handles doc update and undo
    } else if (event.inputType === 'formatItalic') {
        event.preventDefault();
        if (this.schema.marks.italic) this.toggleMark(this.schema.marks.italic);
        return;
    } else if (event.inputType === 'formatStrikeThrough') { // Note: standard inputType is 'strikethrough'
        event.preventDefault();
        if (this.schema.marks.strikethrough) this.toggleMark(this.schema.marks.strikethrough);
        return;
    } else if (event.inputType === 'strikethrough') { // Handling the standard event type
        event.preventDefault();
        if (this.schema.marks.strikethrough) this.toggleMark(this.schema.marks.strikethrough);
        return;
    } else if (event.inputType === 'insertReplacementText' && currentModelPos) {
        event.preventDefault();
        const textToInsert = (event.dataTransfer?.getData('text/plain') || event.data || '');
        const targetRanges = event.getTargetRanges();
        if (targetRanges && targetRanges.length > 0 && textToInsert) {
            const domRange = targetRanges[0];
            const fromDomPos = { node: domRange.startContainer, offset: domRange.startOffset };
            const toDomPos = { node: domRange.endContainer, offset: domRange.endOffset };

            const modelFrom = this.domToModelPosition(fromDomPos.node, fromDomPos.offset);
            const modelTo = this.domToModelPosition(toDomPos.node, toDomPos.offset);

            if (modelFrom && modelTo) {
                // Simplified PoC: Assume same block, replace range with text
                if (modelFrom.path[0] !== modelTo.path[0] || modelFrom.path.length < 2 || modelTo.path.length < 2) {
                    console.warn("insertReplacementText: Range spans multiple blocks or is not in text, not supported for PoC. Inserting at start of range.");
                     // Fallback: insert at modelFrom if it's valid
                    const modelBlockIndex = modelFrom.path[0];
                    const modelInlineNodeIndex = modelFrom.path[1];
                    const textOffset = modelFrom.offset;
                    const currentBlockNode = this.currentViewDoc.content?.[modelBlockIndex];
                    const targetModelTextNode = currentBlockNode?.content?.[modelInlineNodeIndex] as ModelTextNode | undefined;
                    if (targetModelTextNode && targetModelTextNode.type.name === 'text') {
                        const newText = targetModelTextNode.text.slice(0, textOffset) + textToInsert + targetModelTextNode.text.slice(textOffset);
                        this.lastAppliedChange = { type: 'insertText', path: modelFrom.path, offset: textOffset, length: textToInsert.length };
                        const newInlineContent = [...(currentBlockNode!.content || [])];
                        newInlineContent[modelInlineNodeIndex] = this.schema.text(newText, targetModelTextNode.marks);
                        const norm = this.modelUtils.normalizeInlineArray(newInlineContent);
                        const updatedBlock = this.schema.node(currentBlockNode!.type as NodeType, currentBlockNode!.attrs, norm);
                        const newDocContent = [...(this.currentViewDoc.content || [])];
                        newDocContent[modelBlockIndex] = updatedBlock;
                        newDoc = this.schema.node(this.currentViewDoc.type as NodeType, this.currentViewDoc.attrs, newDocContent);
                    } else { return; } // Cannot insert
                } else {
                    // Proper same-block replacement
                    const blockIndex = modelFrom.path[0];
                    const blockNode = this.currentViewDoc.content?.[blockIndex];
                    if (!blockNode || !blockNode.content) return;

                    let newInlineArray: BaseNode[] = [];
                    const fromInlineIdx = modelFrom.path[1];
                    const fromInlineOffset = modelFrom.offset;
                    const toInlineIdx = modelTo.path[1];
                    const toInlineOffset = modelTo.offset;

                    for(let i=0; i < blockNode.content.length; i++) {
                        const currentInlineNode = blockNode.content[i];
                        if (i < fromInlineIdx) {
                            newInlineArray.push(currentInlineNode);
                        } else if (i === fromInlineIdx) {
                            if ((currentInlineNode.type as NodeType).isText) {
                                const textNode = currentInlineNode as ModelTextNode;
                                if (fromInlineOffset > 0) newInlineArray.push(this.schema.text(textNode.text.slice(0, fromInlineOffset), textNode.marks));
                            }
                            // If fromInlineIdx === toInlineIdx, the replacement happens within this single node.
                            if (fromInlineIdx === toInlineIdx) {
                                newInlineArray.push(this.schema.text(textToInsert, (currentInlineNode as ModelTextNode).marks)); // Use marks of current node
                                if ((currentInlineNode.type as NodeType).isText) {
                                     const textNode = currentInlineNode as ModelTextNode;
                                     if(toInlineOffset < textNode.text.length) newInlineArray.push(this.schema.text(textNode.text.slice(toInlineOffset), textNode.marks));
                                }
                            } else {
                                // Replacement spans multiple inline nodes, add the textToInsert now
                                newInlineArray.push(this.schema.text(textToInsert, (currentInlineNode as ModelTextNode).marks));
                            }
                        } else if (i > fromInlineIdx && i < toInlineIdx) {
                            // Skip nodes fully within the replacement range
                        } else if (i === toInlineIdx) {
                            // This is the end node of the range (only if different from start node)
                            if ((currentInlineNode.type as NodeType).isText) {
                                const textNode = currentInlineNode as ModelTextNode;
                                if(toInlineOffset < textNode.text.length) newInlineArray.push(this.schema.text(textNode.text.slice(toInlineOffset), textNode.marks));
                            }
                        } else if (i > toInlineIdx) {
                            newInlineArray.push(currentInlineNode);
                        }
                    }
                    this.lastAppliedChange = { type: 'insertText', path: [blockIndex, fromInlineIdx], offset: fromInlineOffset, length: textToInsert.length }; // Approximate change
                    const norm = this.modelUtils.normalizeInlineArray(newInlineArray);
                    const updatedBlock = this.schema.node(blockNode.type as NodeType, blockNode.attrs, norm);
                    const newDocContent = [...(this.currentViewDoc.content || [])];
                    newDocContent[blockIndex] = updatedBlock;
                    newDoc = this.schema.node(this.currentViewDoc.type as NodeType, this.currentViewDoc.attrs, newDocContent);
                }
            } else { console.warn("insertReplacementText: Could not map DOM range to model.")}
        } else { return; } // No text to insert or no target ranges
    } else if (event.inputType === 'insertFromPaste' && currentModelPos) {
        event.preventDefault();
        const pastedHtml = event.dataTransfer?.getData('text/html');
        const pastedText = event.dataTransfer?.getData('text/plain') || '';

        console.log("Pasted HTML:", pastedHtml);
        console.log("Pasted Text:", pastedText);

        if (pastedHtml) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = pastedHtml;
            const modelFragmentNodes = this.domParser.parseSlice(tempDiv);
            console.log("Parsed from HTML:", modelFragmentNodes);
            // TODO: Logic to insert these modelNodes into currentViewDoc at currentModelPos
            // This would involve splitting nodes, replacing selection, etc.
            // For now, we will still fall back to pasting plain text for simplicity in this PoC phase.
        }

        // Fallback to plain text insertion (current PoC behavior)
        if (pastedText) {
            // Simplified: assumes collapsed selection for paste.
            // A real paste would replace selection if not collapsed.
            // TODO: If selection is not collapsed, delete content in selection first.
            const { path: modelPath, offset: textOffset } = currentModelPos;
            if (modelPath.length < 2) { console.warn("insertFromPaste: Path too short for text node for plain text paste."); return; }
            const modelBlockIndex = modelPath[0];
            const modelInlineNodeIndex = modelPath[1];
            const currentBlockNode = this.currentViewDoc.content?.[modelBlockIndex];
            const targetModelTextNode = currentBlockNode?.content?.[modelInlineNodeIndex] as ModelTextNode | undefined;

            if (targetModelTextNode && targetModelTextNode.type.name === 'text') {
                const newText = targetModelTextNode.text.slice(0, textOffset) + pastedText + targetModelTextNode.text.slice(textOffset);
                this.lastAppliedChange = { type: 'insertText', path: [...modelPath], offset: textOffset, length: pastedText.length };
                const newInlineContent = [...(currentBlockNode!.content || [])];
                newInlineContent[modelInlineNodeIndex] = this.schema.text(newText, targetModelTextNode.marks);
                const norm = this.modelUtils.normalizeInlineArray(newInlineContent);
                const updatedBlock = this.schema.node(currentBlockNode!.type as NodeType, currentBlockNode!.attrs, norm);
                const newDocContent = [...(this.currentViewDoc.content || [])];
                newDocContent[modelBlockIndex] = updatedBlock;
                newDoc = this.schema.node(this.currentViewDoc.type as NodeType, this.currentViewDoc.attrs, newDocContent);
            } else { console.warn("insertFromPaste: Target for plain text paste not a text node."); return; }
        } else { return; }
    } else if (event.inputType === 'insertText' && event.data && currentModelPos) {
      const modelBlockIndex = currentModelPos.path[0];
      const modelInlineNodeIndex = currentModelPos.path.length > 1 ? currentModelPos.path[1] : -1;
      const textOffset = currentModelPos.offset;
      const currentBlockNode = this.currentViewDoc.content?.[modelBlockIndex];

      if (!currentBlockNode) { console.warn("InsertText: Block not found for currentModelPos"); return; }

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
            let newContentForTransformedNode: BaseNode[];

            if (transformToType.name === 'heading') {
                newAttrs.level = level;
                newContentForTransformedNode = [this.schema.text("")];
                finalTransformedNode = this.schema.node(transformToType, newAttrs, newContentForTransformedNode);
            } else if (listTypeNode) {
                const listItemPara = this.schema.node(this.schema.nodes.paragraph, {}, [this.schema.text("")]);
                const listItem = this.schema.node(this.schema.nodes.list_item, {}, [listItemPara]);
                newContentForTransformedNode = [listItem];
                finalTransformedNode = this.schema.node(listTypeNode, newAttrs, newContentForTransformedNode);
            } else if (transformToType.name === 'blockquote') {
                const emptyParaInBlockquote = this.schema.node(this.schema.nodes.paragraph, {}, [this.schema.text("")]);
                newContentForTransformedNode = [emptyParaInBlockquote];
                finalTransformedNode = this.schema.node(transformToType, newAttrs, newContentForTransformedNode);
            }
             else { return; }

            this.lastAppliedChange = { type: 'transformBlock', path: [modelBlockIndex], newType: transformToType, newAttrs };
            const newDocContent = [...(this.currentViewDoc.content || [])];
            newDocContent[modelBlockIndex] = finalTransformedNode;
            newDoc = this.schema.node((this.currentViewDoc.type as NodeType), this.currentViewDoc.attrs, newDocContent);
          }
        }
      }

      if (!newDoc && event.data) {
        event.preventDefault();
        const paragraphContent = currentBlockNode.content || [];
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

      const currentBlockType = currentBlock.type as NodeType;
      const blockContext = this.getBlockContext(currentModelPos);

      if (blockContext && blockContext.parentOfBlock && blockContext.blockNode === currentBlock) {
          const parentType = blockContext.parentOfBlock.type as NodeType;
          const parentActual = blockContext.parentOfBlock;
          const currentBlockIndexInParent = blockContext.pathInParent[0];

          if (parentType.name === 'list_item' && currentBlockType.name === 'paragraph') {
              const listItemNode = parentActual;
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

              if (parentRef === tempDoc) {
                  newDoc = newGrandParent;
              } else {
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
      console.warn(`RitorVDOM (MutationObserver): The inline content reconciliation below is a basic PoC fallback and does not use a full schema-driven parser. Complex HTML changes might not be perfectly preserved.`);

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

    if (!currentPath || currentPath.length === 0 || !change || !change.path || change.path.length === 0) {
      return { path: newPath, offset: currentOffset };
    }

    const changeBlockIndex = change.path[0];
    const posBlockIndex = newPath[0];

    // Type-specific transformation logic
    if (change.type === 'transformBlock') {
      if (changeBlockIndex === posBlockIndex) {
        // Default behavior: try to keep path and offset if block type doesn't imply content reset
        // Specific cases for content reset:
        if (change.newType.name === 'heading' || change.newType.name === 'blockquote' || change.newType.name.endsWith("_list")) {
          const currentBlock = this.currentViewDoc.content?.[changeBlockIndex];
          if (currentBlock && currentBlock.content && currentBlock.content.length > 0 && (currentBlock.content[0].type as NodeType).isText) {
            // Path to the first text node (or equivalent) within the new structure
            if (change.newType.name.endsWith("_list")) { // list -> list_item -> paragraph -> text_node
              newPath = [changeBlockIndex, 0, 0, 0];
            } else if (change.newType.name === 'blockquote') { // blockquote -> paragraph -> text_node
              newPath = [changeBlockIndex, 0, 0];
            } else { // heading -> text_node
              newPath = [changeBlockIndex, 0];
            }
          } else { // Block becomes empty or has no text content at start
            newPath = [changeBlockIndex]; // Path to the block itself
          }
          currentOffset = 0; // Cursor to start
        }
        // If not one of these types, path/offset might be preserved by default if inline structure is compatible.
      }
      // If transform is on a different block, current position is unaffected.
      return { path: newPath, offset: currentOffset };
    }

    // Handling changes that affect block indices (split, insert block)
    if (change.type === 'splitNode' && change.newParaPathIndex <= posBlockIndex && changeBlockIndex < posBlockIndex) {
      // Only increment if the split happened strictly before the current block, and the new block is also before or at current.
      newPath[0] += 1;
    } else if (change.type === 'insertNode' && change.path.length === 1 && change.path[0] <= posBlockIndex) {
      // A new block was inserted at or before the current position's block.
      newPath[0] += 1;
    }

    // If change was in a different block and not handled above, position is generally unaffected.
    if (changeBlockIndex !== posBlockIndex) {
      return { path: newPath, offset: currentOffset };
    }

    // Change is within the same block as the position.
    // Ensure path arrays are long enough before accessing inline indices.
    const changePathLength = change.path.length;
    const currentPathLength = newPath.length;

    const changeInlineIndex = changePathLength > 1 ? change.path[1] : -1;
    let posInlineIndex = currentPathLength > 1 ? newPath[1] : -1;


    if (change.type === 'insertText') {
      // Path must be to a text node for both change and position for this to apply.
      if (currentPathLength > 1 && changePathLength > 1 && posInlineIndex === changeInlineIndex && currentOffset >= change.offset) {
        currentOffset += change.length;
      }
    } else if (change.type === 'deleteText') {
      // Path must be to a text node.
      if (currentPathLength > 1 && changePathLength > 1 && posInlineIndex === changeInlineIndex) {
        if (currentOffset > change.offset + change.length) {
          currentOffset -= change.length;
        } else if (currentOffset > change.offset) {
          currentOffset = change.offset;
        }
      }
    } else if (change.type === 'splitNode') { // Split happened in *this* block (changeBlockIndex === posBlockIndex)
      const splitFromInlineIndex = change.path.length > 1 ? change.path[1] : -1; // Where the split occurred
      const splitFromOffset = change.path.length > 1 ? change.offset : 0; // Offset in that inline node

      if (posInlineIndex === -1 && currentPathLength === 1) { // Position is at block level e.g. empty para offset 0
          // If split happens, this block-level position might need to move to new block if offset was > 0 (which it isn't here)
          // Or stay if split was "at start" (offset 0). For simplicity, assume it stays unless explicitly moved.
      } else if (currentPathLength > 1 && splitFromInlineIndex !== -1) {
          if (posInlineIndex > splitFromInlineIndex || (posInlineIndex === splitFromInlineIndex && currentOffset >= splitFromOffset)) {
            // Position was in the part that moved to the new block.
            newPath[0] = change.newParaPathIndex; // Block index changes.
            if (posInlineIndex === splitFromInlineIndex) { // Cursor was in the same inline node that got split
              newPath[1] = 0; // Assumes content after split starts at inline index 0 in new block
              currentOffset = currentOffset - splitFromOffset;
            } else { // Cursor was in a subsequent inline node
              newPath[1] = posInlineIndex - splitFromInlineIndex -1 + 0; // TODO: this assumes first node after split is text node
                                                                    // More accurately: newPath[1] = posInlineIndex - (splitFromInlineIndex + 1);
                                                                    // And assumes these nodes are now at the start of the new block.
              // A safer mapping for subsequent nodes: map to the start of the new block or start of first new text node
              newPath[1] = 0; // Simplified: move to start of first element in new block
              // currentOffset remains same relative to start of that moved inline node, but now that node is at index 0
            }
          }
          // If position was before the split point, it remains in the original block, path/offset unchanged by this logic here.
      }
    } else if (change.type === 'insertNode' && changePathLength > 1) { // Inline node insertion
        const insertAtInlineIndex = change.path[1];
        if (currentPathLength > 1 && posInlineIndex >= insertAtInlineIndex) {
            newPath[1] += 1;
        } else if (currentPathLength === 1 && insertAtInlineIndex === 0 && currentOffset > 0) {
            // Position was at block level (e.g. empty para, offset 0), node inserted at start.
            // This case is tricky. If currentOffset > 0 for a block-level path, it's ambiguous.
            // Assume if path is to block, offset is 0. If text is inserted, path should become path to text.
            // This transformation might better be handled by domToModel after render.
        }
    } else if (change.type === 'formatMark') {
      // No path/offset change for this PoC's mark formatting.
    }
    return { path: newPath, offset: currentOffset };
  }

  private _insertModelFragment(fragment: BaseNode[], selection: ModelSelection | null): BaseNode {
    if (!selection) {
        console.error("_insertModelFragment: No selection provided for insertion.");
        return this.currentViewDoc;
    }

    let insertionPos = selection.anchor; // Simplified: always use anchor for collapsed point
    let doc = this.currentViewDoc;

    if (selection.anchor.path.join(',') !== selection.head.path.join(',') ||
        selection.anchor.offset !== selection.head.offset) {
        // TODO: Implement range deletion first, then insert at collapsed 'from'.
        // For now, just use the anchor and overwrite/insert.
        console.warn("_insertModelFragment: Non-collapsed selection deletion not yet implemented, inserting at anchor.");
        // Potentially, call a hypothetical _deleteRange method here to update doc and insertionPos
        // For PoC, we proceed with insertionPos = selection.anchor
    }

    if (!doc.content) { // Should not happen with a valid doc node
        console.error("_insertModelFragment: Current document has no content array.");
        return doc;
    }

    const isBlockFragment = fragment.some(n => (n.type as NodeType).isBlock);
    const targetBlockPath = insertionPos.path; // Path to the block (or inline node within block)

    if (isBlockFragment) {
        // --- Block Fragment Insertion ---
        let currentBlocks = [...doc.content];
        const insertionBlockIndex = targetBlockPath[0]; // Index of the block where insertion occurs

        if (targetBlockPath.length > 1 && insertionPos.offset > 0) {
            // Cursor is inside an existing block that needs to be split
            const blockToSplit = currentBlocks[insertionBlockIndex];
            const inlineContent = blockToSplit.content || [];
            const modelInlineNodeIndex = targetBlockPath.length > 1 ? targetBlockPath[1] : (inlineContent.length > 0 ? 0 : -1);
            const textOffset = insertionPos.offset;

            let partBeforeInline: BaseNode[] = [];
            let partAfterInline: BaseNode[] = [];

            if (modelInlineNodeIndex !== -1 && (inlineContent[modelInlineNodeIndex]?.type as NodeType)?.isText) {
                const textNode = inlineContent[modelInlineNodeIndex] as ModelTextNode;
                for(let i=0; i < modelInlineNodeIndex; i++) partBeforeInline.push(inlineContent[i]);
                partBeforeInline.push(this.schema.text(textNode.text.slice(0, textOffset), textNode.marks));

                partAfterInline.push(this.schema.text(textNode.text.slice(textOffset), textNode.marks));
                for(let i=modelInlineNodeIndex + 1; i < inlineContent.length; i++) partAfterInline.push(inlineContent[i]);
            } else { // Splitting at block boundary or non-text inline node, put all existing content before
                partBeforeInline = [...inlineContent];
            }

            const blockBefore = partBeforeInline.length > 0 ?
                this.schema.node(blockToSplit.type as NodeType, blockToSplit.attrs, this.modelUtils.normalizeInlineArray(partBeforeInline)) : null;
            const blockAfter = partAfterInline.length > 0 ?
                this.schema.node(blockToSplit.type as NodeType, {}, this.modelUtils.normalizeInlineArray(partAfterInline)) : null; // New ID for blockAfter

            const newBlocks = [];
            if (blockBefore) newBlocks.push(blockBefore);
            newBlocks.push(...fragment);
            if (blockAfter) newBlocks.push(blockAfter);

            currentBlocks.splice(insertionBlockIndex, 1, ...newBlocks);
            this.lastAppliedChange = { type: 'paste', path: [insertionBlockIndex], offset: 0, numBlocksInserted: fragment.length };

        } else { // Insert blocks at block boundary (e.g., cursor at start of empty paragraph)
            currentBlocks.splice(insertionBlockIndex, 0, ...fragment);
             // If original block at insertionBlockIndex was empty and fragment is inserted before it, it might be removed or shifted.
            // This simplified splice might need adjustment if replacing an empty placeholder block.
            this.lastAppliedChange = { type: 'paste', path: [insertionBlockIndex], offset: 0, numBlocksInserted: fragment.length };
        }
        return this.schema.node(doc.type as NodeType, doc.attrs, currentBlocks);

    } else {
        // --- Inline Fragment Insertion ---
        if (targetBlockPath.length === 0) { // Should not happen if selection is valid
             console.error("_insertModelFragment: Cannot insert inline content at document root path."); return doc;
        }
        const targetBlockIndex = targetBlockPath[0];
        const targetBlock = doc.content[targetBlockIndex];

        if (!targetBlock || !(targetBlock.type as NodeType).spec.content?.match(/inline|text/i) ) {
            console.warn("_insertModelFragment: Target block does not accept inline content. Wrapping fragment in a paragraph.");
            // Attempt to wrap inline fragment in a new paragraph and insert that as a block fragment
            const newPara = this.schema.node("paragraph", {}, fragment);
            // This becomes a block insertion. Recurse or duplicate block insertion logic.
            // For PoC, let's try a simplified block insertion here.
            const currentBlocks = [...doc.content];
            currentBlocks.splice(targetBlockIndex + 1, 0, newPara); // Insert after current block
            this.lastAppliedChange = { type: 'paste', path: [targetBlockIndex + 1], offset: 0, numBlocksInserted: 1 };
            return this.schema.node(doc.type as NodeType, doc.attrs, currentBlocks);
        }

        let currentInlineContent = [...(targetBlock.content || [])];
        // Path: [blockIdx, inlineIdx, (optional) charOffset if deeper in text]
        // For inline insertion, path[1] is inline node index, offset is char offset in text node.
        const modelInlineNodeIndex = targetBlockPath.length > 1 ? targetBlockPath[1] : (currentInlineContent.length); // Default to end if path is to block
        const textOffset = insertionPos.offset;

        let finalInlineContent: BaseNode[] = [];
        let inserted = false;

        if (currentInlineContent.length === 0) { // Empty block
            finalInlineContent = fragment;
            inserted = true;
        } else {
            for (let i = 0; i < currentInlineContent.length; i++) {
                if (i === modelInlineNodeIndex) {
                    const inlineNode = currentInlineContent[i];
                    if ((inlineNode.type as NodeType).isText) {
                        const textNode = inlineNode as ModelTextNode;
                        finalInlineContent.push(this.schema.text(textNode.text.slice(0, textOffset), textNode.marks));
                        finalInlineContent.push(...fragment);
                        finalInlineContent.push(this.schema.text(textNode.text.slice(textOffset), textNode.marks));
                        inserted = true;
                    } else { // Atom node or other non-text inline
                        finalInlineContent.push(inlineNode); // Push the atom/element itself
                        if (textOffset === 0) { // Insert before atom
                            finalInlineContent.splice(finalInlineContent.length -1, 0, ...fragment);
                        } else { // Insert after atom
                            finalInlineContent.push(...fragment);
                        }
                         inserted = true;
                    }
                } else {
                    finalInlineContent.push(currentInlineContent[i]);
                }
            }
        }
        if (!inserted) { // If loop didn't insert (e.g. modelInlineNodeIndex was at the end)
            finalInlineContent.push(...fragment);
        }

        const normalizedContent = this.modelUtils.normalizeInlineArray(finalInlineContent);
        const updatedBlock = this.schema.node(targetBlock.type as NodeType, targetBlock.attrs, normalizedContent);
        const newDocContent = [...doc.content];
        newDocContent[targetBlockIndex] = updatedBlock;

        const inlineContentLength = fragment.reduce((sum, node) => sum + ((node as ModelTextNode).text?.length || 1),0);
        this.lastAppliedChange = { type: 'paste', path: targetBlockPath, offset: textOffset, inlineContentLength };
        return this.schema.node(doc.type as NodeType, doc.attrs, newDocContent);
    }
}

  public updateDocument(newDoc: BaseNode): void {
    let selectionToRestore = this.currentModelSelection;
    if (selectionToRestore && this.lastAppliedChange) {
        // For 'paste', selection mapping is more complex.
        // A simple approach: try to place cursor at the end of pasted content.
        if (this.lastAppliedChange.type === 'paste') {
            let newPath = [...this.lastAppliedChange.path];
            let newOffset = this.lastAppliedChange.offset;
            if (this.lastAppliedChange.numBlocksInserted && this.lastAppliedChange.numBlocksInserted > 0) {
                newPath[0] += this.lastAppliedChange.numBlocksInserted -1; // Go to last inserted block
                // Find last inline node of last inserted block
                const lastBlock = newDoc.content?.[newPath[0]];
                if (lastBlock && lastBlock.content && lastBlock.content.length > 0) {
                    newPath.push(lastBlock.content.length -1);
                    const lastInline = lastBlock.content[lastBlock.content.length-1];
                    newOffset = (lastInline.type as NodeType).isText ? (lastInline as ModelTextNode).text.length : 1;
                } else { newOffset = 0;} // Empty block
            } else if (this.lastAppliedChange.inlineContentLength) {
                if (newPath.length > 1) newOffset += this.lastAppliedChange.inlineContentLength;
                else newPath.push(0); newOffset = this.lastAppliedChange.inlineContentLength; // Needs better path if only block path given
            }
             selectionToRestore = { anchor: {path: newPath, offset: newOffset}, head: {path: newPath, offset: newOffset}};
        } else {
            const mappedAnchor = this.mapModelPosition(selectionToRestore.anchor, this.lastAppliedChange);
            const mappedHead = this.mapModelPosition(selectionToRestore.head, this.lastAppliedChange);
            selectionToRestore = { anchor: mappedAnchor, head: mappedHead };
        }
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

  private _orderPositions(pos1: ModelPosition, pos2: ModelPosition): [ModelPosition, ModelPosition] {
      for(let i=0; i < Math.min(pos1.path.length, pos2.path.length); i++) {
          if (pos1.path[i] < pos2.path[i]) return [pos1, pos2];
          if (pos1.path[i] > pos2.path[i]) return [pos2, pos1];
      }
      if (pos1.path.length < pos2.path.length) return [pos1, pos2];
      if (pos1.path.length > pos2.path.length) return [pos2, pos1];
      if (pos1.offset < pos2.offset) return [pos1, pos2];
      return [pos2, pos1];
  }

  private _applyMarkToRange(selection: ModelSelection, markType: MarkType, attrs: Attrs | null = {}): void {
    const [fromPos, toPos] = this._orderPositions(selection.anchor, selection.head);

    if (fromPos.path[0] !== toPos.path[0]) {
        console.warn("_applyMarkToRange: Multi-block selection not supported for PoC."); return;
    }
    const blockIndex = fromPos.path[0];
    const targetBlock = this.currentViewDoc.content?.[blockIndex];
    if (!targetBlock || !targetBlock.content || !(targetBlock.type as NodeType).allowsMarkType(markType) ) return;

    let newInlineContent: BaseNode[] = [];
    let markAppliedOrRemovedInSelection = false;

    let shouldAddMark = true;
    if (attrs === null) {
        shouldAddMark = false;
    } else {
        // Check if the entire selected range (or first part of it) already has this exact mark.
        // This is a simplified check focusing on the first node.
        // A more robust check would see if *all* parts of the selection have the mark.
        const firstNodeIndex = fromPos.path[1];
        const firstNode = targetBlock.content[firstNodeIndex];
        if (firstNode && (firstNode.type as NodeType).isText) {
            const textN = firstNode as ModelTextNode;
            const marks = textN.marks || [];
            if(marks.some(m => m.type === markType && JSON.stringify(m.attrs || null) === JSON.stringify(attrs || null))) {
                 shouldAddMark = false;
            }
        }
    }

    targetBlock.content.forEach((inlineNode, index) => {
      if ((inlineNode.type as NodeType).isText) {
        const textNode = inlineNode as ModelTextNode;
        const nodeIsFullySelected = (index > fromPos.path[1] && index < toPos.path[1]);
        const nodeIsPartiallySelected = (index === fromPos.path[1] || index === toPos.path[1]);

        let startOffset = 0;
        let endOffset = textNode.text.length;

        if (index === fromPos.path[1]) startOffset = fromPos.offset;
        if (index === toPos.path[1]) endOffset = toPos.offset;

        if (nodeIsFullySelected || (nodeIsPartiallySelected && startOffset < endOffset) ) {
          if (startOffset > 0) newInlineContent.push(this.schema.text(textNode.text.slice(0, startOffset), textNode.marks));

          const selectedText = textNode.text.slice(startOffset, endOffset);
          if (selectedText) {
            let currentMarks = textNode.marks || [];
            if (shouldAddMark && attrs !== null) {
                currentMarks = currentMarks.filter(m => m.type !== markType);
                currentMarks = [...currentMarks, markType.create(attrs)];
            } else {
                currentMarks = currentMarks.filter(m => !(m.type === markType && (attrs === null || JSON.stringify(m.attrs || null) === JSON.stringify(attrs || null))));
            }
            newInlineContent.push(this.schema.text(selectedText, currentMarks));
            markAppliedOrRemovedInSelection = true;
          }
          if (endOffset < textNode.text.length) newInlineContent.push(this.schema.text(textNode.text.slice(endOffset), textNode.marks));
        } else {
          newInlineContent.push(inlineNode);
        }
      } else {
        newInlineContent.push(inlineNode);
      }
    });

    if (!markAppliedOrRemovedInSelection && attrs !== null) {
        console.warn("_applyMarkToRange: No text found in selection to apply mark.");
        return;
    }

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

  private _getMarkAttrsInSelection(markType: MarkType): Attrs | null {
      if (!this.currentModelSelection) return null;
      const [fromPos, ] = this._orderPositions(this.currentModelSelection.anchor, this.currentModelSelection.head);

      if (fromPos.path.length < 2) return null;

      const block = this.currentViewDoc.content?.[fromPos.path[0]];
      if (!block || !block.content) return null;
      // For PoC, check the node at the start of selection.
      // A more robust version would check if the entire range has the mark, or what's common.
      const inlineNode = block.content[fromPos.path[1]];

      if (inlineNode && (inlineNode.type as NodeType).isText) {
          const textNode = inlineNode as ModelTextNode;
          // Check marks at the character `fromPos.offset`.
          // If offset is at end of node, it might not have the mark "active".
          // This needs more robust logic to check marks *covering* the offset.
          // For now, just check if the node has the mark.
          const existingMark = (textNode.marks || []).find(m => m.type === markType);
          return existingMark ? existingMark.attrs : null;
      }
      return null;
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
    } else { // Remove link
        this._applyMarkToRange(selection, linkMarkType, null);
    }
  }

  public getDocJson(): string {
      return JSON.stringify(this.currentViewDoc, null, 2);
  }
}

console.log("RitorVDOM class defined. Example usage is sketched for browser environment.");
[end of src/RitorVDOM.ts]
