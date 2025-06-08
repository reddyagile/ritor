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
    
    this.domPatcher = new DomPatcher(this.targetElement, this.currentViewDoc, this.schema); // FIX: Pass currentViewDoc
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
    if ((node as any).isText && !(node as any).isLeaf) return { path: currentPath, node: node as TextNode }; // FIX: Reverted to direct property (diagnostic)
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
    const domSel = window.getSelection();
    if (domSel && domSel.anchorNode && domSel.focusNode && domSel.rangeCount > 0) {
        const modelAnchor = this.domToModelPosition(domSel.anchorNode, domSel.anchorOffset);
        const modelHead = this.domToModelPosition(domSel.focusNode, domSel.focusOffset);

        if (modelAnchor && modelHead) {
            const newModelSelection: ModelSelection = { anchor: modelAnchor, head: modelHead };
            if (!this.currentModelSelection || !this.areSelectionsEqual(this.currentModelSelection, newModelSelection)) {
                this.currentModelSelection = newModelSelection;
            }
        }
    }
  }

  public domToModelSelection(range: Range): ModelSelection | null { 
    const aP = this.domToModelPosition(range.startContainer, range.startOffset); const hP = this.domToModelPosition(range.endContainer, range.endOffset); if (aP && hP) return { anchor: aP, head: hP }; return null;
  }

  public domToModelPosition(domNode: Node, domOffset: number): ModelPosition | null {
    let effectiveDomNode: Node = domNode;
    let effectiveDomOffset = domOffset;
    let charOffsetInTextNode = -1;

    // 1. Handle Text Node input: Determine char offset and switch to parent element for path finding.
    if (effectiveDomNode.nodeType === Node.TEXT_NODE) {
        charOffsetInTextNode = effectiveDomOffset;
        const parentElement = effectiveDomNode.parentNode;
        if (!parentElement) {
            console.warn("domToModelPosition: Text node has no parent.", effectiveDomNode);
            return null;
        }
        effectiveDomNode = parentElement;
        // effectiveDomOffset becomes the index of the original text node within its parent
        effectiveDomOffset = Array.from(parentElement.childNodes).indexOf(domNode as ChildNode);
        if (effectiveDomOffset === -1) {
            console.warn("domToModelPosition: Original text node not found in its parent's childNodes.", domNode, parentElement);
            return null;
        }
    }

    // 2. Construct DOM path (indices and elements) from effectiveDomNode up to the editor root.
    const domIndexPath: number[] = [];      // Stores DOM child indices.
    const domNodePath: (Node | null)[] = []; // Stores the actual DOM node at each level of domIndexPath.

    let currentClimber: Node | null = effectiveDomNode;
    while (currentClimber && currentClimber !== this.targetElement) {
        const parent = currentClimber.parentNode;
        if (!parent) {
            console.warn("domToModelPosition: Climbed to node with no parent before reaching targetElement.", currentClimber);
            return null;
        }

        const indexInParent = Array.from(parent.childNodes).indexOf(currentClimber as ChildNode);
        if (indexInParent === -1) {
            console.warn("domToModelPosition: Node not found in its parent's childNodes during path construction.", currentClimber, parent);
            return null;
        }
        domIndexPath.unshift(indexInParent);
        domNodePath.unshift(currentClimber); // Store the node itself, aligns with domIndexPath

        currentClimber = parent;
    }

    if (!currentClimber) { // Did not reach targetElement
        console.warn("domToModelPosition: Traversal did not reach targetElement.", effectiveDomNode);
        return null;
    }

    // 3. Traverse the Model using domIndexPath, adjusting for discrepancies.
    let modelPath: number[] = [];
    let currentModelParent: BaseNode = this.currentViewDoc;
    finalModelNode = this.currentViewDoc; // Start with root, path will refine it.
    let modelTraversalShouldStop = false;

    for (let i = 0; i < domIndexPath.length; i++) {
        const domChildIndex = domIndexPath[i];
        const domNodeAtPathSegment = domNodePath[i]; // Corresponding DOM Node for this level

        if (!currentModelParent.content || currentModelParent.content.length === 0) {
            if (charOffsetInTextNode !== -1 && (currentModelParent as any).isTextBlock) {
                finalModelNode = currentModelParent;
                modelTraversalShouldStop = true; // Path to currentModelParent is already set
            } else {
                console.warn("domToModelPosition: Model parent has no content, but DOM path continues.", currentModelParent.type.name, domIndexPath.slice(0, i + 1));
                return null;
            }
        }
        if (modelTraversalShouldStop) break;

        let modelChildNode: BaseNode | undefined = undefined;
        let actualModelChildIndex = -1;

        if (domNodeAtPathSegment && domNodeAtPathSegment.nodeType === Node.ELEMENT_NODE) {
            const el = domNodeAtPathSegment as HTMLElement;
            if (el.id && el.id.startsWith('ritor-node-')) {
                for (let j = 0; j < currentModelParent.content.length; j++) {
                    if (currentModelParent.content[j].attrs?.id === el.id) {
                        modelChildNode = currentModelParent.content[j];
                        actualModelChildIndex = j;
                        break;
                    }
                }
                if (!modelChildNode) {
                     console.warn(`domToModelPosition: DOM Element ${el.id} not found in model parent ${currentModelParent.type.name} children by ID.`);
                }
            }
        }

        if (!modelChildNode) { // No ID match, or not a Ritor-ID'd element
            if (domChildIndex < currentModelParent.content.length) {
                const potentialModelChild = currentModelParent.content[domChildIndex];
                const domIsElement = domNodeAtPathSegment?.nodeType === Node.ELEMENT_NODE;
                const domIsText = domNodeAtPathSegment?.nodeType === Node.TEXT_NODE;
                const modelIsText = (potentialModelChild as any).isText; // Assuming isText property

                if (domIsElement && !modelIsText) {
                    modelChildNode = potentialModelChild;
                    actualModelChildIndex = domChildIndex;
                } else if (domIsText && modelIsText) {
                    modelChildNode = potentialModelChild;
                    actualModelChildIndex = domChildIndex;
                } else { // Type mismatch (e.g., DOM Element <-> Model Text)
                    if (charOffsetInTextNode !== -1 && (currentModelParent as any).isTextBlock) {
                        finalModelNode = currentModelParent; // Path to currentModelParent is already set
                        modelTraversalShouldStop = true;
                    } else {
                        // More complex mismatch, e.g. DOM Text where Model Element is expected, and not a text selection.
                        console.warn("domToModelPosition: Type mismatch between DOM and Model at index.", domNodeAtPathSegment, potentialModelChild);
                        // modelChildNode remains undefined.
                    }
                }
            } else { // DOM index is out of bounds for model children
                if (charOffsetInTextNode !== -1 && (currentModelParent as any).isTextBlock) {
                    finalModelNode = currentModelParent; // Path to currentModelParent is already set
                    modelTraversalShouldStop = true;
                } else {
                    console.warn("domToModelPosition: DOM index out of bounds.", currentModelParent.type.name, domChildIndex);
                    return null;
                }
            }
        }

        if (modelTraversalShouldStop) break;

        if (!modelChildNode) {
            // If, after all attempts, no corresponding model child was found for this DOM segment
            if (i === domIndexPath.length - 1 && charOffsetInTextNode !== -1 && (currentModelParent as any).isTextBlock) {
                // This is the last DOM segment, original selection was text, and current model parent is a text block.
                // This means the DOM path might have been into a non-modelled wrapper of text within this block.
                finalModelNode = currentModelParent; // Path to currentModelParent is already set
            } else {
                console.warn("domToModelPosition: No model child found for DOM segment.", domNodeAtPathSegment, "in parent", currentModelParent.type.name);
                return null;
            }
        } else {
            modelPath.push(actualModelChildIndex);
            finalModelNode = modelChildNode;
            currentModelParent = modelChildNode;
        }
    }
    // After the loop, finalModelNode and modelPath are set.

    if (!finalModelNode) {
        // This case implies that the editor root itself is the target (empty domIndexPath)
        // or something went wrong if domIndexPath was not empty.
        // If domIndexPath is empty, effectiveDomNode was targetElement.
        // finalModelNode was initialized to this.currentViewDoc and modelPath is empty, which is correct.
        // If loop ran, finalModelNode should be set. If not, it means domIndexPath was empty.
        if (domIndexPath.length > 0) { // Should not happen if loop logic is correct
           console.warn("domToModelPosition: Could not determine final model node after model traversal, though domIndexPath was not empty.");
           return null;
        }
        // If domIndexPath is empty, finalModelNode is already this.currentViewDoc.
    }


    if (!finalModelNode) {
        // This case implies that the editor root itself is the target, or path was empty.
        if (domIndexPath.length === 0 && effectiveDomNode === this.targetElement) {
            finalModelNode = this.currentViewDoc;
            modelPath = [];
        } else {
            console.warn("domToModelPosition: Could not determine final model node after model traversal.");
            return null;
        }
    }

    // 4. Calculate final model offset based on finalModelNode and original DOM selection.
    let finalModelOffset = 0;

    if (charOffsetInTextNode !== -1) { // Original input was a Text Node
        // `finalModelNode` is the model node containing the text (either the TextNode itself or its parent block).
        // `modelPath` points to `finalModelNode`.

        if ((finalModelNode as any).isText && !(finalModelNode as any).isLeaf) {
            // finalModelNode is already the target model TextNode.
            finalModelOffset = charOffsetInTextNode;
        } else if ((finalModelNode as any).isTextBlock && finalModelNode.content) {
            // finalModelNode is a block. We need to find which of its model children
            // corresponds to the original DOM text node (represented by `domNode` before it was changed to parent).
            // `effectiveDomNode` is the parent of the original `domNode`.
            // `effectiveDomOffset` is the index of `domNode` within `effectiveDomNode.childNodes`.

            let modelTextChildIndex = -1;
            let currentModelChildIdx = 0; // Tracks the current child index in finalModelNode.content

            // Iterate through the DOM children of effectiveDomNode (parent of original text node)
            // up to the original text node itself.
            for (let domChildWalkerIdx = 0; domChildWalkerIdx < effectiveDomNode.childNodes.length; domChildWalkerIdx++) {
                if (currentModelChildIdx >= finalModelNode.content.length) break; // No more model children to map to

                const currentDomChild = effectiveDomNode.childNodes[domChildWalkerIdx];
                const currentModelChild = finalModelNode.content[currentModelChildIdx];

                let domChildCorrespondsToModelChild = false;
                // Check for correspondence (ID or type heuristic)
                if (currentDomChild.nodeType === Node.ELEMENT_NODE && (currentDomChild as HTMLElement).id?.startsWith('ritor-node-')) {
                    if (currentModelChild.attrs?.id === (currentDomChild as HTMLElement).id) {
                        domChildCorrespondsToModelChild = true;
                    }
                } else if (currentDomChild.nodeType === Node.TEXT_NODE && (currentModelChild as any).isText) {
                    domChildCorrespondsToModelChild = true;
                } else if (currentDomChild.nodeType === Node.ELEMENT_NODE && !(currentModelChild as any).isText && !(currentModelChild as any).isLeaf) {
                    // Heuristic: DOM element maps to model element (non-text, non-leaf) if no IDs used.
                    // This is a simplification. Real mapping might involve skipping non-modelled DOM elements.
                    domChildCorrespondsToModelChild = true;
                }
                // Add more heuristics if needed (e.g. for leaf nodes if they can be direct children of blocks)

                if (domChildCorrespondsToModelChild) {
                    if (domChildWalkerIdx === effectiveDomOffset) { // This is the original text node's position
                        if ((currentModelChild as any).isText && !(currentModelChild as any).isLeaf) {
                            modelTextChildIndex = currentModelChildIdx;
                        } else {
                            // The model child corresponding to the original text node's position is not a text node.
                            // This could happen if the text node was empty and got filtered, or structure mismatch.
                            console.warn("domToModelPosition: DOM text node maps to non-text model child in block.", currentModelChild.type.name);
                            // Fallback: use charOffsetInTextNode with the block's path, hoping it's a simple block.
                            // Or, if it's a leaf node, maybe the offset is 0 relative to it.
                            // For now, this will likely result in using charOffsetInTextNode with the parent block's path.
                        }
                        break;
                    }
                    currentModelChildIdx++; // Advance model child index only if current DOM child maps to one
                }
            }

            if (modelTextChildIndex !== -1) {
                // Found the specific model text node. Adjust path and node.
                modelPath = [...modelPath, modelTextChildIndex]; // Extend path to the text node
                finalModelNode = finalModelNode.content[modelTextChildIndex]; // This is now the actual text node
                finalModelOffset = charOffsetInTextNode;
            } else {
                // Could not find a specific model text child. This can happen if:
                // 1. The text node was at the end of the block, and the block has fewer model children.
                // 2. The text node didn't map cleanly (e.g., it was empty and ignored in model).
                // 3. The block itself is treated as a single text unit in some schemas.
                // Fallback: Assume charOffsetInTextNode applies to the resolved `finalModelNode` (the block).
                // This is only reasonable if the block is simple (e.g., paragraph with only text).
                // A more robust solution might require looking at all text children of the block.
                console.warn("domToModelPosition: Text node selection in block, but couldn't map to a specific model text child. Using offset in block.", finalModelNode.type.name);
                finalModelOffset = charOffsetInTextNode; // Offset within the block
            }

        } else {
            // Original was text, but finalModelNode is neither a TextNode nor a TextBlock.
            console.warn("domToModelPosition: Text node selection, but finalModelNode is not Text or TextBlock.", finalModelNode.type.name);
            // Default to offset 0 of the path found so far.
            finalModelOffset = 0;
        }

    } else { // Original input was an Element Node
        // `effectiveDomNode` is the DOM element.
        // `effectiveDomOffset` is the child index within `effectiveDomNode.childNodes`.
        // `finalModelNode` is the model counterpart of `effectiveDomNode`.
        // `modelPath` points to `finalModelNode`.

        if ((finalModelNode as any).isLeaf) {
            finalModelOffset = 0; // Selections within or around leaf nodes usually map to offset 0 of the leaf itself.
        } else if (!finalModelNode.content || finalModelNode.content.length === 0) {
            finalModelOffset = 0; // Empty element.
        } else {
            // Map `effectiveDomOffset` (a DOM child index) to a model child index.
            if (effectiveDomOffset === 0) {
                finalModelOffset = 0;
            } else if (effectiveDomOffset >= effectiveDomNode.childNodes.length) {
                // Selection is after the last DOM child. Map to after the last model child.
                finalModelOffset = finalModelNode.content.length;
            } else {
                // Iterate through DOM children of `effectiveDomNode` up to `effectiveDomOffset`,
                // counting only those that have a corresponding model node in `finalModelNode.content`.
                let calculatedModelOffset = 0;
                let currentModelChildScanIdx = 0; // Pointer for scanning finalModelNode.content

                for (let domChildIdx = 0; domChildIdx < effectiveDomOffset; domChildIdx++) {
                    const domChild = effectiveDomNode.childNodes[domChildIdx];
                    if (currentModelChildScanIdx >= finalModelNode.content.length) break; // No more model children to map

                    const modelCandidate = finalModelNode.content[currentModelChildScanIdx];
                    let domChildHasModelCounterpart = false;

                    // Heuristic for correspondence:
                    if (domChild.nodeType === Node.ELEMENT_NODE && (domChild as HTMLElement).id?.startsWith('ritor-node-')) {
                        if (modelCandidate.attrs?.id === (domChild as HTMLElement).id) {
                            domChildHasModelCounterpart = true;
                        }
                        // If IDs mismatch, this DOM node might be an unmapped Ritor node, or model is different.
                        // If ID exists on DOM but doesn't match modelCandidate's ID, domChildHasModelCounterpart remains false.
                    } else if (domChild.nodeType === Node.COMMENT_NODE || (domChild.nodeType === Node.TEXT_NODE && !/\S/.test(domChild.textContent || ""))) {
                        // Skip comments and empty/whitespace-only text nodes in DOM for mapping purposes
                        // as they often don't have direct model counterparts or don't affect model offset.
                        continue; // Skips incrementing calculatedModelOffset and currentModelChildScanIdx for this domChild
                    } else {
                        // No Ritor ID on DOM child. Try to map based on general node type compatibility.
                        if (domChild.nodeType === Node.ELEMENT_NODE && !(modelCandidate as any).isText) { // FIX: Reverted
                            domChildHasModelCounterpart = true; // DOM Element maps to Model Element
                        } else if (domChild.nodeType === Node.TEXT_NODE && (modelCandidate as any).isText) { // FIX: Reverted
                            domChildHasModelCounterpart = true; // DOM Text maps to Model Text
                        }
                        // If types are incompatible (e.g. DOM Text where Model Element is expected),
                        // domChildHasModelCounterpart remains false. This means this DOM node is considered
                        // a non-modelled node, and the next DOM node will be compared against the same modelCandidate.
                    }

                    if (domChildHasModelCounterpart) {
                        calculatedModelOffset++; // This DOM child contributes to model offset
                        currentModelChildScanIdx++; // Move to next model child for next DOM child
                    }
                    // If domChildHasModelCounterpart is false (e.g. Ritor ID mismatch, or a type we decide to skip),
                    // calculatedModelOffset is not incremented, and currentModelChildScanIdx is not incremented,
                    // meaning the next DOM child will be compared against the same modelCandidate.
                }
                finalModelOffset = calculatedModelOffset;
            }
        }
    }

    return { path: modelPath, offset: finalModelOffset };
  }

  public modelToDomPosition(modelPos: ModelPosition): { node: Node, offset: number } | null {
    const targetModelNodeInfo = this.findModelNodeAndPath(this.currentViewDoc, modelPos.path);
    if (!targetModelNodeInfo) {
        // console.warn("modelToDomPosition: Could not find target model node for path", modelPos.path);
        return null;
    }
    const { node: targetModelNode, path: resolvedModelPath } = targetModelNodeInfo;

    let domContainer: HTMLElement | null = null;
    let modelNodeForDomLookup: BaseNode = targetModelNode;

    if ((targetModelNode as any).isText && resolvedModelPath.length > 0) { // FIX: Reverted
        const parentPath = resolvedModelPath.slice(0, -1);
        const parentModelNode = nodeAtPath(this.currentViewDoc, parentPath);
        if (!parentModelNode || (parentModelNode as any).isText) { // FIX: Reverted
            // console.warn("modelToDomPosition: Text node's parent not found or is not an element.", resolvedModelPath);
             return null;
        }
        modelNodeForDomLookup = parentModelNode;
    } else if ((targetModelNode as any).isText && resolvedModelPath.length === 0) { // FIX: Reverted
        domContainer = this.targetElement;
    }

    if (!domContainer) {
        if (modelNodeForDomLookup.attrs?.id) {
            domContainer = this.targetElement.querySelector(`[id="${modelNodeForDomLookup.attrs.id}"]`);
        } else {
            let currentDom: Node = this.targetElement;
            let currentModel: BaseNode = this.currentViewDoc;
            const pathToFollow = ((modelNodeForDomLookup as any).isText && resolvedModelPath.length > 0 && modelNodeForDomLookup !== targetModelNode) ? resolvedModelPath.slice(0,-1) : resolvedModelPath; // FIX: Reverted
            for (let i = 0; i < pathToFollow.length; i++) {
                const modelChildIndex = pathToFollow[i];
                if (!currentModel.content || modelChildIndex >= currentModel.content.length) {
                    // console.warn("modelToDomPosition: Invalid model path during DOM lookup (no ID).", pathToFollow);
                    return null;
                }
                const nextModelNode = currentModel.content[modelChildIndex];
                if (nextModelNode.attrs?.id) {
                    const foundById = this.targetElement.querySelector(`[id="${nextModelNode.attrs.id}"]`);
                    if (!foundById) { /*console.warn("modelToDomPosition: ID lookup failed mid-path.", nextModelNode.attrs.id);*/ return null;}
                    currentDom = foundById;
                } else {
                    let domChildCounter = 0;
                    let foundDomChildForModelIndex = false;
                    for (let k = 0; k < currentDom.childNodes.length; k++) {
                        const domChild = currentDom.childNodes[k];
                        if (domChild.nodeType === Node.ELEMENT_NODE || (domChild.nodeType === Node.TEXT_NODE && domChild.textContent?.trim())) {
                            if (domChildCounter === modelChildIndex) {
                                currentDom = domChild;
                                foundDomChildForModelIndex = true;
                                break;
                            }
                            domChildCounter++;
                        }
                    }
                    if (!foundDomChildForModelIndex) {
                        // console.warn("modelToDomPosition: DOM counterpart not found for model index (no ID).", modelChildIndex, currentModel.type.name);
                        return null;
                    }
                }
                currentModel = nextModelNode;
            }
            if (currentDom.nodeType === Node.ELEMENT_NODE) {
                domContainer = currentDom as HTMLElement;
            } else {
                // console.warn("modelToDomPosition: Path traversal (no ID) did not resolve to an HTMLElement.", currentDom);
                 return null;
            }
        }
    }

    if (!domContainer) {
        // console.warn("modelToDomPosition: Could not find DOM container for model node", modelNodeForDomLookup.type.name, modelPos);
        return null;
    }

    if ((targetModelNode as any).isText) { // FIX: Reverted
        let textNodeOffset = modelPos.offset;
        let foundDomTextNode: Node | null = null;
        const modelTextNodeIndexInParent = resolvedModelPath[resolvedModelPath.length - 1];
        let currentModelChildScannedIndex = 0;
        for (let i = 0; i < domContainer.childNodes.length; i++) {
            const domChild = domContainer.childNodes[i];
            if (currentModelChildScannedIndex > modelTextNodeIndexInParent) break;
            const modelChildCandidate = modelNodeForDomLookup.content?.[currentModelChildScannedIndex];
            let isMappedModelNode = false;
            if (modelChildCandidate) {
                if (modelChildCandidate.attrs?.id && (domChild as HTMLElement).id === modelChildCandidate.attrs.id) {
                    isMappedModelNode = true;
                } else if (!((domChild as HTMLElement).id?.startsWith('ritor-node-')) && !modelChildCandidate.attrs?.id) {
                     if ((modelChildCandidate as any).isText && domChild.nodeType === Node.TEXT_NODE) isMappedModelNode = true; // FIX: Reverted
                     else if (!(modelChildCandidate as any).isText && domChild.nodeType === Node.ELEMENT_NODE) isMappedModelNode = true; // FIX: Reverted
                }
            }
            if (isMappedModelNode) {
                if (currentModelChildScannedIndex === modelTextNodeIndexInParent) {
                    if (domChild.nodeType === Node.TEXT_NODE && modelChildCandidate && (modelChildCandidate as any)?.isText) {
                        foundDomTextNode = domChild;
                        break;
                    } else if (domChild.nodeType === Node.ELEMENT_NODE && modelChildCandidate && (modelChildCandidate as any)?.isText && modelChildCandidate.content && modelChildCandidate.content.length === 0) {
                        let innerTextSearch: Node | null = domChild.firstChild;
                        while(innerTextSearch && innerTextSearch.nodeType !== Node.TEXT_NODE) innerTextSearch = innerTextSearch.nextSibling;
                        if (innerTextSearch) { foundDomTextNode = innerTextSearch; break;}
                        else { return { node: domChild, offset: 0}; }
                    }
                }
                currentModelChildScannedIndex++;
            }
        }
        if (foundDomTextNode) {
            return { node: foundDomTextNode, offset: Math.min(textNodeOffset, foundDomTextNode.textContent?.length || 0) };
        } else {
            // console.warn("modelToDomPosition: Specific DOM text node not found for model text.", targetModelNode.type.name, "Using container boundary.");
            if (modelPos.offset === 0) return { node: domContainer, offset: 0 };
            for (let i = domContainer.childNodes.length -1; i>=0; --i) {
                if (domContainer.childNodes[i].nodeType === Node.TEXT_NODE) return { node: domContainer.childNodes[i], offset: domContainer.childNodes[i].textContent?.length || 0};
            }
            return { node: domContainer, offset: domContainer.childNodes.length };
        }
    } else if ((targetModelNode as any).isLeaf) { // FIX: Reverted
        let domLeafNode: HTMLElement = domContainer;
        if (targetModelNode.attrs?.id && domContainer.id !== targetModelNode.attrs.id) {
            const foundLeaf = domContainer.querySelector(`[id="${targetModelNode.attrs.id}"]`);
            if (foundLeaf instanceof HTMLElement) domLeafNode = foundLeaf;
            else { /*console.warn("modelToDomPosition: Leaf node ID not found within supposed parent.", targetModelNode.attrs.id);*/ return null;}
        } else if (!targetModelNode.attrs?.id) {
            const leafModelIndex = resolvedModelPath[resolvedModelPath.length -1];
            let currentModelChildIdx = 0;
            let found = false;
            for(let i=0; i < domContainer.childNodes.length; ++i) {
                const child = domContainer.childNodes[i];
                if (child.nodeType === Node.ELEMENT_NODE || (child.nodeType === Node.TEXT_NODE && child.textContent?.trim())) {
                    if(currentModelChildIdx === leafModelIndex) {
                        if (child instanceof HTMLElement) { domLeafNode = child; found = true; break; }
                        else { /*console.warn("modelToDomPosition: Leaf model maps to non-element DOM node.", child);*/ return null;}
                    }
                    currentModelChildIdx++;
                }
            }
            if(!found) {/*console.warn("modelToDomPosition: Could not find non-ID leaf in parent.", resolvedModelPath);*/ return null;}
        }
        const parentDomNode = domLeafNode.parentNode;
        if (!parentDomNode) { /*console.warn("modelToDomPosition: Leaf DOM node has no parent.", domLeafNode);*/ return null; }
        const indexInParent = Array.from(parentDomNode.childNodes).indexOf(domLeafNode as ChildNode);
        if (indexInParent === -1) { /*console.warn("modelToDomPosition: Leaf DOM node not found in parent's children.", domLeafNode);*/ return null; }
        return { node: parentDomNode, offset: modelPos.offset === 0 ? indexInParent : indexInParent + 1 };
    } else {
        let modelOffset = modelPos.offset;
        if (!targetModelNode.content || targetModelNode.content.length === 0 || modelOffset === 0) {
            return { node: domContainer, offset: 0 };
        }
        if (modelOffset > targetModelNode.content.length) {
            modelOffset = targetModelNode.content.length;
        }
        let domCalculatedOffset = 0;
        let modelChildrenCounted = 0;
        for (let i = 0; i < domContainer.childNodes.length; i++) {
            if (modelChildrenCounted >= modelOffset) break;
            const domChild = domContainer.childNodes[i];
            const currentModelChild = targetModelNode.content[modelChildrenCounted];
            let isModelEquivalent = false;
            if (currentModelChild.attrs?.id && (domChild as HTMLElement).id === currentModelChild.attrs.id) {
                isModelEquivalent = true;
            } else if (!((domChild as HTMLElement).id?.startsWith('ritor-node-')) && !currentModelChild.attrs?.id) {
                if ((currentModelChild as any).isText && domChild.nodeType === Node.TEXT_NODE) isModelEquivalent = true; // FIX: Reverted
                else if (!(currentModelChild as any).isText && domChild.nodeType === Node.ELEMENT_NODE) isModelEquivalent = true; // FIX: Reverted
            }
            if (isModelEquivalent) {
                modelChildrenCounted++;
            }
            domCalculatedOffset = i + 1;
        }
        if (modelChildrenCounted < modelOffset && modelOffset === targetModelNode.content.length) {
            domCalculatedOffset = domContainer.childNodes.length;
        }
        return { node: domContainer, offset: domCalculatedOffset };
    }
  }

  // Helper to find a model node and its full path
  private findModelNodeAndPath(rootNode: BaseNode, path: number[]): { node: BaseNode, path: number[] } | null {
    let current: BaseNode = rootNode;
    const currentPath: number[] = [];
    if (path.length === 0 && rootNode) return { node: rootNode, path: [] }; // Path to root itself

    for (let i = 0; i < path.length; i++) {
        const index = path[i];
        if (!current.content || index < 0 || index >= current.content.length) {
            console.warn("findModelNodeAndPath: Invalid path segment.", path, "at index", i, "on node", current.type.name);
            return null;
        }
        current = current.content[index];
        currentPath.push(index);
    }
    return { node: current, path: currentPath };
  }

  public applyModelSelectionToDom(modelSelection: ModelSelection | null): void {
    if (!modelSelection) {
        return;
    }

    const domAnchorPos = this.modelToDomPosition(modelSelection.anchor);
    const domHeadPos = this.modelToDomPosition(modelSelection.head);

    if (domAnchorPos && domHeadPos) {
        const domSel = window.getSelection();
        if (domSel) {
            this.lastViewModelSelection = modelSelection;

            if (document.activeElement === this.targetElement) {
                try {
                    domSel.setBaseAndExtent(domAnchorPos.node, domAnchorPos.offset, domHeadPos.node, domHeadPos.offset);
                } catch (e) {
                    try {
                        const newRange = document.createRange();
                        newRange.setStart(domAnchorPos.node, domAnchorPos.offset);
                        newRange.setEnd(domHeadPos.node, domHeadPos.offset);
                        domSel.removeAllRanges();
                        domSel.addRange(newRange);
                    } catch (e2) {
                        // console.error("Failed to apply model selection to DOM using both methods:", e2, modelSelection);
                    }
                }
            }
        }
    } else {
        // console.warn("Failed to convert model selection to DOM position for apply. Anchor or Head DOM position is null.", domAnchorPos, domHeadPos);
    }
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
    const tr = new Transaction(this.currentViewDoc, this.currentModelSelection ?? undefined); // FIX: Pass undefined if null
    const flatAnchor = modelPositionToFlatOffset(this.currentViewDoc, this.currentModelSelection.anchor, this.schema);
    const flatHead = this.arePositionsEqual(this.currentModelSelection.anchor, this.currentModelSelection.head) ? flatAnchor : modelPositionToFlatOffset(this.currentViewDoc, this.currentModelSelection.head, this.schema);
    const from = Math.min(flatAnchor, flatHead); const to = Math.max(flatAnchor, flatHead);
    const lines = text.split(/\r\n|\r|\n/); let nodesToInsert: BaseNode[] = [];
    if (lines.length <= 1) { const marks = this.getMarksAtPosition(this.currentViewDoc, this.currentModelSelection.anchor); nodesToInsert.push(this.schema.text(lines[0] || "", marks));}
    else { lines.forEach((line) => { nodesToInsert.push(this.schema.node(this.schema.nodes.paragraph, {}, [this.schema.text(line)])); });}
    const sliceToInsert = Slice.fromFragment(nodesToInsert);
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
    let sliceToInsert: Slice | null = null;

    const currentDebugFlag = (globalThis as any).DEBUG_PASTE_HANDLING || false;

    if (html && html.length > 0) {
        if (currentDebugFlag) console.log("[PasteHandling] HTML content found:", html);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;

        const contextNodeType = selection.anchor.path.length > 0
            ? nodeAtPath(this.currentViewDoc, selection.anchor.path.slice(0,-1))?.type
            : this.schema.topNodeType;

        const parsedResult = this.domParser.parseFragment(tempDiv, contextNodeType || this.schema.topNodeType);

        if (currentDebugFlag) {
            console.log("[PasteHandling] Parsed HTML fragment:", JSON.stringify(parsedResult.nodes.map(n => n.type.name)));
            console.log(`[PasteHandling] Parsed openStart: ${parsedResult.openStart}, openEnd: ${parsedResult.openEnd}`);
        }

        if (parsedResult.nodes && parsedResult.nodes.length > 0) {
            sliceToInsert = new Slice(parsedResult.nodes, parsedResult.openStart, parsedResult.openEnd);
        } else {
            if (currentDebugFlag) console.log("[PasteHandling] HTML parsing yielded no nodes.");
        }
    }

    if (!sliceToInsert && pastedText && pastedText.trim().length > 0) {
        if (currentDebugFlag) console.log("[PasteHandling] No HTML slice, or HTML parsing failed. Using plain text:", pastedText);
        const lines = pastedText.split(/\r\n|\r|\n/);
        const paragraphNodes: BaseNode[] = lines.map(line => {
            return this.schema.node(this.schema.nodes.paragraph, null, [this.schema.text(line)]);
        });
        sliceToInsert = new Slice(paragraphNodes, 0, 0);
        if (currentDebugFlag) console.log("[PasteHandling] Created slice from plain text:", JSON.stringify(sliceToInsert.content.map(n=>n.type.name)));
    }


    if (sliceToInsert && sliceToInsert.content.length > 0) {
        const tr = new Transaction(this.currentViewDoc, selection ?? undefined); // FIX: Pass undefined if null
        const fromFlat = modelPositionToFlatOffset(this.currentViewDoc, selection.anchor, this.schema);
        const toFlat = modelPositionToFlatOffset(this.currentViewDoc, selection.head, this.schema);
        const replaceFrom = Math.min(fromFlat, toFlat);
        const replaceTo = Math.max(fromFlat, toFlat);

        // FIX: Removed line: const sliceToInsert = new Slice(modelNodesToInsert, openStart, openEnd);
        // sliceToInsert is already defined from logic above.
        if (!sliceToInsert) { // Should be redundant due to outer check, but for safety.
             console.error("handlePaste: sliceToInsert became null unexpectedly before tr.replace.");
             return;
        }
        tr.replace(replaceFrom, replaceTo, sliceToInsert);
        
        const endOfPastedContentFlat = replaceFrom + sliceToInsert.size; 
        const endModelPos = flatOffsetToModelPosition(tr.doc, endOfPastedContentFlat, this.schema);
        tr.setSelection({ anchor: endModelPos, head: endModelPos });
        tr.scrollIntoView();

        if (tr.stepsApplied) {
            if (!areNodesEffectivelyEqual(this.currentViewDoc, tr.doc)) { // FIX: Use imported util
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
    this.updateModelSelectionState();
    const selection = this.currentModelSelection;
    if (!selection) {
      console.warn("applyChange called without a currentModelSelection.");
      return;
    }

    const doc = this.currentViewDoc;
    const tr = new Transaction(doc, selection ?? undefined); // FIX: Pass undefined if null, remove schema
    const flatAnchor = modelPositionToFlatOffset(doc, selection.anchor, this.schema); // FIX: Use this.schema
    const flatHead = modelPositionToFlatOffset(doc, selection.head, this.schema); // FIX: Use this.schema

    let newCursorPos: ModelPosition | null = null;

    switch (change.type) {
      case 'insertText':
        if (change.text) {
          const from = Math.min(flatAnchor, flatHead);
          const to = Math.max(flatAnchor, flatHead);
          const marks = this.getMarksAtPosition(doc, selection.anchor);
          const textNode = this.schema.text(change.text, marks); // FIX: Use this.schema
          tr.replace(from, to, Slice.fromFragment([textNode]));
          const newFlatPos = from + textNode.text.length;
          newCursorPos = flatOffsetToModelPosition(tr.doc, newFlatPos, this.schema); // FIX: Use this.schema
          if (newCursorPos) tr.setSelection({ anchor: newCursorPos, head: newCursorPos });
        }
        break;
      
      case 'deleteContentBackward':
        if (flatAnchor !== flatHead) {
          const from = Math.min(flatAnchor, flatHead);
          const to = Math.max(flatAnchor, flatHead);
          tr.delete(from, to);
          newCursorPos = flatOffsetToModelPosition(tr.doc, from, this.schema); // FIX: Use this.schema
          if (newCursorPos) tr.setSelection({ anchor: newCursorPos, head: newCursorPos });
        } else {
          if (flatAnchor === 0) return;

          const modelAnchorPos = flatOffsetToModelPosition(doc, flatAnchor, this.schema); // FIX: Use this.schema
          let blockPath: number[] | null = null;
          let currentBlockNode: BaseNode | null = null;
          let blockNodeIndex = -1;

          if (modelAnchorPos && modelAnchorPos.path.length > 0) {
            const nodeAtPos = nodeAtPath(doc, modelAnchorPos.path);
            if ((nodeAtPos as any)?.isText) { // FIX: Reverted
              blockPath = modelAnchorPos.path.slice(0, -1);
            } else if ((nodeAtPos?.type as any).isBlock) { // FIX: Reverted with type assertion
              blockPath = modelAnchorPos.path;
            }
            if (blockPath && blockPath.length > 0) {
                currentBlockNode = nodeAtPath(doc, blockPath);
                blockNodeIndex = blockPath[blockPath.length-1];
            } else if (blockPath && blockPath.length === 0 && nodeAtPos?.type.name === 'doc') {
            }
          }
          
          if (blockPath && blockPath.length !== 1 && currentBlockNode) { 
            currentBlockNode = null;
          }

          if (currentBlockNode && (currentBlockNode.type as any).isBlock && blockPath && blockNodeIndex > 0 &&
              isPositionAtStartOfBlockContent(doc, modelAnchorPos!, blockPath, this.schema)) { // FIX: Use this.schema & Reverted .isBlock
            
            const prevBlockPath = [blockNodeIndex - 1];
            const prevBlock = nodeAtPath(doc, prevBlockPath);

            if (prevBlock && (prevBlock.type as any).isTextBlock && (currentBlockNode.type as any).isTextBlock && prevBlock.content && currentBlockNode.content) { // FIX: Reverted
              const prevBlockContent = prevBlock.content as ReadonlyArray<BaseNode>;
              const currentBlockContent = currentBlockNode.content as ReadonlyArray<BaseNode>;
              
              let originalPrevBlockContentLength = 0;
              for(const node of prevBlockContent) originalPrevBlockContentLength += node.nodeSize;

              const mergedInlineContent = normalizeInlineArray([...prevBlockContent, ...currentBlockContent], this.schema); // FIX: Use this.schema
              const newPrevBlock = this.schema.node(prevBlock.type, prevBlock.attrs, mergedInlineContent); // FIX: Use this.schema
              
              const startOfPrevBlockFlat = modelPositionToFlatOffset(doc, { path: prevBlockPath, offset: 0 }, this.schema); // FIX: Use this.schema
              const startOfCurrentBlockFlat = modelPositionToFlatOffset(doc, { path: blockPath, offset: 0 }, this.schema); // FIX: Use this.schema
              const endOfCurrentBlockFlat = startOfCurrentBlockFlat + currentBlockNode.nodeSize;

              tr.replace(startOfPrevBlockFlat, endOfCurrentBlockFlat, Slice.fromFragment([newPrevBlock]));
              
              const newCursorFlatPos = startOfPrevBlockFlat + 1 + originalPrevBlockContentLength;
              newCursorPos = flatOffsetToModelPosition(tr.doc, newCursorFlatPos, this.schema); // FIX: Use this.schema
              if (newCursorPos) tr.setSelection({ anchor: newCursorPos, head: newCursorPos });

            } else {
              tr.delete(flatAnchor - 1, flatAnchor);
              newCursorPos = flatOffsetToModelPosition(tr.doc, flatAnchor - 1, this.schema); // FIX: Use this.schema
              if (newCursorPos) tr.setSelection({ anchor: newCursorPos, head: newCursorPos });
            }
          } else {
            tr.delete(flatAnchor - 1, flatAnchor);
            newCursorPos = flatOffsetToModelPosition(tr.doc, flatAnchor - 1, this.schema); // FIX: Use this.schema
            if (newCursorPos) tr.setSelection({ anchor: newCursorPos, head: newCursorPos });
          }
        }
        break;

      case 'deleteContentForward':
        if (flatAnchor !== flatHead) {
          const from = Math.min(flatAnchor, flatHead);
          const to = Math.max(flatAnchor, flatHead);
          tr.delete(from, to);
          newCursorPos = flatOffsetToModelPosition(tr.doc, from, this.schema); // FIX: Use this.schema
          if (newCursorPos) tr.setSelection({ anchor: newCursorPos, head: newCursorPos });
        } else {
          if (flatAnchor === doc.contentSize) return;
          tr.delete(flatAnchor, flatAnchor + 1);
          newCursorPos = flatOffsetToModelPosition(tr.doc, flatAnchor, this.schema); // FIX: Use this.schema
          if (newCursorPos) tr.setSelection({ anchor: newCursorPos, head: newCursorPos });
        }
        break;

      case 'insertParagraph':
        const fromIP = Math.min(flatAnchor, flatHead);
        const toIP = Math.max(flatAnchor, flatHead);
        const newPara = this.schema.node(this.schema.nodes.paragraph, {}, [this.schema.text('')]); // FIX: Use this.schema
        tr.replace(fromIP, toIP, Slice.fromFragment([newPara]));
        const newParaStartFlatPos = fromIP + 1;
        newCursorPos = flatOffsetToModelPosition(tr.doc, newParaStartFlatPos, this.schema); // FIX: Use this.schema
        if (newCursorPos) tr.setSelection({ anchor: newCursorPos, head: newCursorPos });
        break;
        
      default:
        return;
    }

    tr.scrollIntoView();
    if (tr.stepsApplied) {
      if (!areNodesEffectivelyEqual(this.currentViewDoc, tr.doc)) { // FIX: Use imported util
          this.undoManager.add(this.currentViewDoc);
      }
      this.updateDocument(tr);
    }
  }

  public updateDocument(trOrDoc: Transaction | DocNode): void {
    this.isProcessingMutations = true; let selToApply: ModelSelection | null = null;
    if (trOrDoc instanceof Transaction) {
        this.currentViewDoc = trOrDoc.doc; selToApply = trOrDoc.selection;
    } else { // trOrDoc is DocNode
        this.currentViewDoc = trOrDoc;
        if (this.currentModelSelection) {
            const dS = window.getSelection();
            if (dS && dS.rangeCount > 0) selToApply = this.domToModelSelection(dS.getRangeAt(0));
            if (!selToApply) { // Fallback if domToModelSelection failed or no DOM selection
                const fTI = this.findFirstTextNodePath(this.currentViewDoc);
                selToApply = fTI ? { anchor: { path: fTI.path, offset: 0 }, head: { path: fTI.path, offset: 0 } } : { anchor: { path: [], offset: 0 }, head: { path: [], offset: 0 } };
            }
        }
    }
    this.currentViewDoc = this.ensureBlockIds(this.currentViewDoc);
    this.domPatcher.patch(this.currentViewDoc);
    if (selToApply) { this.currentModelSelection = selToApply; this.applyModelSelectionToDom(selToApply); } else this.currentModelSelection = null;
    this.isProcessingMutations = false;
  }
  
  private getModelPathFromDomNode(domNode: Node | null): number[] | null {
    if (!domNode) return null;
    const path: number[] = [];
    let cDN: Node | null = domNode;
    while(cDN && cDN !== this.targetElement){
        const pN: Node | null = cDN.parentNode; // FIX: Add type
        if(!pN) return null;
        const idx=Array.from(pN.childNodes).indexOf(cDN as ChildNode);
        if(idx===-1)return null; path.unshift(idx); cDN=pN;
    }
    return cDN===this.targetElement?path:null;
}
  private findClosestBlockParentInfo(domNode: Node | null): { element: HTMLElement, path: number[], node: BaseNode } | null {
    let curr: Node | null = domNode;
    while (curr && curr !== this.targetElement) {
        if (curr.nodeType === Node.ELEMENT_NODE) {
            const el = curr as HTMLElement;
            const elName = el.nodeName.toLowerCase();
            if (el.id && el.id.startsWith('ritor-node-')) {
                const modelPath = this.getModelPathFromDomNode(el);
                if (modelPath) {
                    const modelNode = nodeAtPath(this.currentViewDoc, modelPath);
                    if (modelNode) return { element: el, path: modelPath, node: modelNode };
                }
            }
            const nodeType = this.schema.nodes[elName];
            if (nodeType?.isBlock) { // This use of isBlock on NodeType should be fine if schema is structured correctly
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
      return areNodesEffectivelyEqual(docA, docB); // FIX: Use imported util (already was)
  }

  private ensureBlocksAtTopLevel(nodes: BaseNode[]): BaseNode[] {
    const result: BaseNode[] = [];
    let currentInlineGroup: InlineNode[] = [];
    for (const node of nodes) {
        if (node.type.isBlock) { // This use of isBlock on NodeType should be fine
            if (currentInlineGroup.length > 0) {
                result.push(this.schema.nodes.paragraph.create(null, normalizeInlineArray(currentInlineGroup, this.schema)));
                currentInlineGroup = [];
            }
            result.push(node);
        } else {
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
    // let mutationsProcessedThisTurn = false; // This variable was unused

    let changedBlockInfo: { element: HTMLElement, path: number[], node: BaseNode } | null = null;
    let fullResyncNeeded = false;

    for (const mut of mutations) {
        if (mut.type === 'attributes' && mut.target === this.targetElement) continue;
        
        const blockInfo = this.findClosestBlockParentInfo(mut.target);
        if (blockInfo) {
            if (!changedBlockInfo) {
                changedBlockInfo = blockInfo;
            } else if (changedBlockInfo.path.join(',') !== blockInfo.path.join(',')) {
                fullResyncNeeded = true;
                break;
            }
        } else {
            fullResyncNeeded = true;
            break;
        }
        if (mut.type === 'childList') {
             const affectedNodes = [...Array.from(mut.addedNodes), ...Array.from(mut.removedNodes)];
             if (affectedNodes.some(n => n.nodeType === Node.ELEMENT_NODE && this.findClosestBlockParentInfo(n))) {
                 fullResyncNeeded = true;
                 break;
             }
        }
    }
    if (mutations.length > 0 && !changedBlockInfo && !fullResyncNeeded) {
        fullResyncNeeded = true;
    }

    Promise.resolve().then(() => {
        if (fullResyncNeeded) {
            console.warn("RitorVDOM: Performing full DOM re-parse and diff due to complex/block-level mutations.");
            const parsedResult = this.domParser.parseFragment(this.targetElement, this.schema.nodes.doc);
            const newDocContentNodesUnwrapped = parsedResult.nodes;
            const newDocContentNodes = this.ensureBlocksAtTopLevel(newDocContentNodesUnwrapped);
            
            const steps = diffFragment(this.currentViewDoc.content, newDocContentNodes, 0); // FIX: schema arg removed

            if (steps.length > 0) {
                this.updateModelSelectionState();
                const tr = new Transaction(this.currentViewDoc, this.currentModelSelection ?? undefined); // FIX: Pass undefined if null
                steps.forEach(step => tr.addStep(step));
                if (!areNodesEffectivelyEqual(this.currentViewDoc, tr.doc)) { // FIX: Use imported util
                    this.undoManager.add(this.currentViewDoc);
                }
                this.updateDocument(tr);
            }
            // mutationsProcessedThisTurn = true; // Unused

        } else if (changedBlockInfo) {
            const { element: domChangedBlockElement, path: modelBlockPath, node: oldModelBlock } = changedBlockInfo;
            if ((oldModelBlock.type as any).isLeafType || !(oldModelBlock.type as any).isTextBlock) { // FIX: Reverted with type assertion
                // console.error("Mutation handler: Identified block is leaf or not a text block. Reverting to full sync for safety.", oldModelBlock.type.name);
                 fullResyncNeeded = true;
                 if (this.isProcessingMutations) {
                    this.isProcessingMutations = false;
                    return;
                 }
                 this.handleMutations(mutations);
                 return;
            }

            const newParsedInlineNodesResult = this.domParser.parseFragment(domChangedBlockElement, oldModelBlock.type);
            const normalizedNewInlineContent = normalizeInlineArray(newParsedInlineNodesResult.nodes as InlineNode[], this.schema);
            const oldInlineContent = (oldModelBlock.content || []) as ReadonlyArray<BaseNode>;

            const blockStartPos: ModelPosition = { path: modelBlockPath, offset: 0 };
            const flatBlockStart = modelPositionToFlatOffset(this.currentViewDoc, blockStartPos, this.schema);
            const blockContentStartFlatOffset = flatBlockStart + ((oldModelBlock.type as any).isLeafType ? 0 : 1); // FIX: Reverted with type assertion

            const steps = diffFragment(oldInlineContent, normalizedNewInlineContent, blockContentStartFlatOffset); // FIX: schema arg removed

            if (steps.length > 0) {
                this.updateModelSelectionState();
                const tr = new Transaction(this.currentViewDoc, this.currentModelSelection ?? undefined); // FIX: Pass undefined if null
                steps.forEach(step => tr.addStep(step));
                
                if (!areNodesEffectivelyEqual(this.currentViewDoc, tr.doc)) { // FIX: Use imported util
                     this.undoManager.add(this.currentViewDoc);
                }
                this.updateDocument(tr);
            }
            // mutationsProcessedThisTurn = true; // Unused
        }

        this.isProcessingMutations = false;
    }).catch(e => {
        console.error("Error in mutation handling:", e);
        this.isProcessingMutations = false;
    });
  }
  public setFocus(): void { this.targetElement.focus(); if(this.currentModelSelection) this.applyModelSelectionToDom(this.currentModelSelection); else this.ensureInitialSelection(); }
  public undo(): void { const pS = this.undoManager.undo(this.currentViewDoc); if (pS) this.updateDocument(pS as DocNode); } // FIX: Added currentViewDoc, cast pS
  public redo(): void { const nS = this.undoManager.redo(this.currentViewDoc); if (nS) this.updateDocument(nS as DocNode); } // FIX: Added currentViewDoc, cast nS

  private _isMarkActiveInSelection(markType: MarkType, attrs: Attrs | undefined, selection: ModelSelection): boolean {
    if(this.arePositionsEqual(selection.anchor,selection.head)){const mAC=this.getMarksAtPosition(this.currentViewDoc,selection.anchor); return mAC.some(m=>m.type===markType&&(!attrs||m.eq(markType.create(attrs))));}
    const fF=modelPositionToFlatOffset(this.currentViewDoc,selection.anchor,this.schema); const fT=modelPositionToFlatOffset(this.currentViewDoc,selection.head,this.schema);
    const tNs=findTextNodesInRange(this.currentViewDoc,Math.min(fF,fT),Math.max(fF,fT),this.schema); if(tNs.length===0)return false;
    for(const seg of tNs){if(seg.startOffsetInNode===seg.endOffsetInNode)continue; const mOS=seg.node.marks||[]; const fM=mOS.some(m=>{if(m.type!==markType)return false; if(attrs){let aAM=true; for(const k in attrs)if(m.attrs?.[k]!==attrs[k]){aAM=false;break;} return aAM;} return true;}); if(!fM)return false;} return true;
  }
  public toggleMark(markTypeOrName: MarkType | string, attrs?: Attrs): void {
    if(!this.currentModelSelection)return; const mT=typeof markTypeOrName==='string'?this.schema.marks[markTypeOrName]:markTypeOrName; if(!mT){console.warn(`Unknown mark type: ${markTypeOrName}`);return;}
    if(this.arePositionsEqual(this.currentModelSelection.anchor,this.currentModelSelection.head)){/*console.log("Toggling mark on collapsed selection - PoC: No change yet.");*/return;}
    const tr=new Transaction(this.currentViewDoc,this.currentModelSelection ?? undefined); // FIX: Pass undefined if null
    const fA=modelPositionToFlatOffset(this.currentViewDoc,this.currentModelSelection.anchor,this.schema); const fH=modelPositionToFlatOffset(this.currentViewDoc,this.currentModelSelection.head,this.schema); const from=Math.min(fA,fH); const to=Math.max(fA,fH);
    const mIA=this._isMarkActiveInSelection(mT,attrs,this.currentModelSelection!); if(mIA){const mTR=attrs?mT.create(attrs):mT; tr.removeMark(from,to,mTR);}else{tr.addMark(from,to,mT.create(attrs||{}));}
    if(tr.stepsApplied){this.undoManager.add(this.currentViewDoc); this.updateDocument(tr);}
  }
  private getMarksAtPosition(doc: BaseNode, pos: ModelPosition): Mark[] {
    if(!pos)return[]; let n:BaseNode|null=nodeAtPath(doc,pos.path); if((n as any)?.isText&&!(n as any).isLeaf){const tN=n as TextNode; if(pos.offset>0||tN.text.length>0){if(tN.marks&&tN.marks.length>0)return[...tN.marks];}return[];} if(n&&!(n as any).isText&&!(n as any).isLeaf&&n.content&&pos.offset>0&&pos.offset<=n.content.length){const cB=n.content[pos.offset-1]; if(cB?.marks&&cB.marks.length>0)return[...cB.marks];} return[]; // FIX: Reverted
  }
  public ensureBlockIds(doc: DocNode): DocNode {
    let ch=false; const nC=(doc.content||[]).map(bN=>{let cB=bN; if(!cB.attrs||cB.attrs.id==null){ch=true; const nA={...cB.attrs,id:this.schema.generateNodeId()}; cB=this.schema.node(cB.type,nA,cB.content,cB.marks);} if(cB.content&&((cB.type as any).name==='list_item'||(cB.type as any).name==='blockquote')){ const tTFR =this.schema.nodes[(cB.type as any).name]||cB.type; const tID={type:tTFR,content:cB.content,attrs:cB.attrs,nodeSize:cB.nodeSize}as DocNode; const nID=this.ensureBlockIds(tID); if(nID.content!==cB.content){ch=true;cB=this.schema.node(cB.type,cB.attrs,nID.content,cB.marks);}} return cB;}); if(ch)return this.schema.node(doc.type,doc.attrs,nC)as DocNode; return doc;
  }
}

console.log("RitorVDOM.ts: Integrated DOMParser into paste handling (using openStart/End) and mutation handling (PoC).");
