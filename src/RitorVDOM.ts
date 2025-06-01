// src/RitorVDOM.ts
import { Schema } from './schema.js';
import { DocNode, BaseNode, TextNode, InlineNode } from './documentModel.js';
import { DomPatcher } from './domPatcher.js';
import { modelPositionToFlatOffset, flatOffsetToModelPosition, normalizeInlineArray } from './modelUtils.js';
import { ModelPosition, ModelSelection } from './selection.js';
import { UndoManager } from './undoManager.js';
import { basicNodeSpecs, basicMarkSpecs } from './basicSchema.js'; // For default schema
import { DOMParser as RitorDOMParser } from './domParser.js'; // Ritor's DOMParser
import { Transaction } from './transform/transaction.js';
import { Slice } from './transform/slice.js';
import { MarkType } from './schema.js';


// Define SimpleChange interface if not already defined elsewhere
interface SimpleChange {
  type: 'insertText' | 'deleteContentBackward' | 'insertParagraph' | 'formatBold' | 'formatItalic' | 'formatStrikeThrough' | 'paste' | 'undo' | 'redo' | 'ensureBlockId';
  text?: string;
  character?: string;
  dataTransfer?: DataTransfer | null;
  markType?: string; // for formatting like 'bold', 'italic'
}


export class RitorVDOM {
  public currentViewDoc: DocNode;
  private domPatcher: DomPatcher;
  private targetElement: HTMLElement;
  private currentModelSelection: ModelSelection | null = null;
  private lastViewModelSelection: ModelSelection | null = null; // Store the last selection applied to the model
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
      // Create a default document: a doc with one empty paragraph
      const p = this.schema.node('paragraph', {}, [this.schema.text('')]);
      this.currentViewDoc = this.schema.node('doc', {}, [p]) as DocNode;
    }

    this.domPatcher = new DomPatcher(this.targetElement, this.schema);
    this.undoManager = new UndoManager();
    this.undoManager.add(this.currentViewDoc); // Initial state for undo

    this.domPatcher.patch(this.currentViewDoc); // Initial render
    this.setupEventHandlers();

    this.mutationObserver = new MutationObserver(this.handleMutations.bind(this));
    this.mutationObserver.observe(this.targetElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true, // Observe attributes if needed for your model (e.g. list item indentation)
      // characterDataOldValue: true // If you need to compare old vs new text content
    });

    this.ensureInitialSelection();
    this.setFocus();
  }

  private ensureInitialSelection() {
    if (!this.currentModelSelection) {
        // Default to the start of the first text-like node, or start of doc if empty
        const firstTextNodeInfo = this.findFirstTextNodePath(this.currentViewDoc);
        if (firstTextNodeInfo) {
            this.currentModelSelection = {
                anchor: { path: firstTextNodeInfo.path, offset: 0 },
                head: { path: firstTextNodeInfo.path, offset: 0 }
            };
        } else { // Empty doc or doc with no text nodes
            this.currentModelSelection = { anchor: { path: [], offset: 0 }, head: { path: [], offset: 0 } };
        }
        this.applyModelSelectionToDom(this.currentModelSelection);
    }
  }

  private findFirstTextNodePath(node: BaseNode, currentPath: number[] = []): { path: number[], node: TextNode } | null {
    if (node.isText && !node.isLeaf) { // Found a text node
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

    // Selection change handling
    document.addEventListener('selectionchange', this.handleSelectionChange.bind(this));
    this.targetElement.addEventListener('focus', this.handleFocus.bind(this));
    // Keydown for non-input events like Enter, Backspace, Arrows if not handled by beforeinput
    this.targetElement.addEventListener('keydown', this.handleKeyDown.bind(this));
  }

  private handleFocus(): void {
    // When editor gains focus, re-evaluate selection if needed.
    // This helps ensure the model selection is in sync if focus occurred via non-standard means.
    this.updateModelSelectionState();
  }

  private handleSelectionChange(): void {
    if (document.activeElement === this.targetElement) {
      this.updateModelSelectionState();
    }
  }

  private updateModelSelectionState(): void {
    if (this.isProcessingMutations) return; // Avoid race conditions during mutation processing

    const domSelection = window.getSelection();
    if (domSelection && domSelection.rangeCount > 0) {
      const range = domSelection.getRangeAt(0);
      const newModelSelection = this.domToModelSelection(range);

      if (newModelSelection &&
          (!this.currentModelSelection ||
           !this.areSelectionsEqual(this.currentModelSelection, newModelSelection))) {
        this.currentModelSelection = newModelSelection;
        // console.log("Model selection updated from DOM:", JSON.stringify(this.currentModelSelection));
      }
    }
  }

  private domToModelSelection(range: Range): ModelSelection | null {
    const anchorPos = this.domToModelPosition(range.startContainer, range.startOffset);
    const headPos = this.domToModelPosition(range.endContainer, range.endOffset);

    if (anchorPos && headPos) {
        return { anchor: anchorPos, head: headPos };
    }
    return null;
  }

  // DOM position to ModelPosition (simplified, needs to be robust)
  public domToModelPosition(domNode: Node, domOffset: number): ModelPosition | null {
    const path: number[] = [];
    let currentDomNode: Node | null = domNode;

    // If domNode is text node and offset is within its length, find its parent element for path start
    let charOffsetInText = 0;
    if (currentDomNode.nodeType === Node.TEXT_NODE) {
        charOffsetInText = domOffset;
        currentDomNode = currentDomNode.parentNode; // Start path from the element containing the text
        if (!currentDomNode) return null;
    } else if (currentDomNode.nodeType === Node.ELEMENT_NODE && domOffset > 0 && domOffset <= currentDomNode.childNodes.length) {
        // If offset points to a child, make currentDomNode that child and charOffsetInText 0
        // This helps if selection is "between" two child elements of currentDomNode
        const childNodeAtOffset = currentDomNode.childNodes[domOffset -1]; // -1 because domOffset is like "after child at index domOffset-1"
        if (childNodeAtOffset && childNodeAtOffset.nodeType === Node.ELEMENT_NODE) {
            // TODO: this logic might need to be more nuanced if selection is around block vs inline elements
            // currentDomNode = childNodeAtOffset;
            // charOffsetInText = 0;
        }
    }


    // Traverse up to the targetElement to build the path
    while (currentDomNode && currentDomNode !== this.targetElement) {
        const parent = currentDomNode.parentNode;
        if (!parent) return null; // Should not happen if currentDomNode is within targetElement
        const index = Array.from(parent.childNodes).indexOf(currentDomNode as ChildNode);
        path.unshift(index);
        currentDomNode = parent;
    }

    if (!currentDomNode) return null; // Path could not be built to targetElement

    // Now, map this DOM path to model path and resolve offset
    let modelNode: BaseNode | undefined = this.currentViewDoc;
    let finalPath = [];
    for (let i = 0; i < path.length; i++) {
        const domChildIndex = path[i];
        if (!modelNode || !modelNode.content || domChildIndex >= modelNode.content.length) {
            // console.warn("DOM path segment out of bounds in model:", path, i, modelNode);
            return null; // Path mismatch
        }
        const modelChildNode = modelNode.content[domChildIndex];
        finalPath.push(domChildIndex);
        modelNode = modelChildNode; // Descend into model
    }

    if (!modelNode) return null;

    if (modelNode.isText && !modelNode.isLeaf) { // Path points to a TextNode in the model
        return { path: finalPath, offset: charOffsetInText };
    } else if (!modelNode.isLeaf && modelNode.content) { // Path points to an ElementNode
        // If original domNode was text, we used charOffsetInText.
        // If original domNode was element, domOffset was index of child or char offset.
        // This part needs to be more robust for element node selections.
        // For now, if path points to an element, and we had charOffset (from text), it's invalid.
        // If path points to element, and domOffset was index, it should be used.
        if (domNode.nodeType === Node.ELEMENT_NODE) {
            // domOffset is the index of the child node *after* which the selection is,
            // or 0 if at the beginning of the element.
            // This needs to map to an offset in the modelNode's content array.
            // This is a simplified placeholder.
            let modelOffset = 0;
            let count = 0;
            let tempDomNode = domNode.firstChild;
            while(tempDomNode && count < domOffset) {
                // This mapping is too naive.
                // We need to map based on which *model* child corresponds to the domOffset-th dom child.
                count++;
                tempDomNode = tempDomNode.nextSibling;
            }
            modelOffset = domOffset; // Highly simplified, assumes 1-to-1 DOM-to-model child mapping.
            return { path: finalPath, offset: modelOffset };
        }
        // If original was text node, path should point to text node.
        // console.warn("Selection points to element but original DOM node was text. Ambiguous.", domNode, modelNode);
        return { path: finalPath, offset: 0 }; // Fallback
    } else if (modelNode.isLeaf) {
        return { path: finalPath, offset: 0 }; // Offset is 0 for leaf.
    }

    return null; // Fallback
  }

  // ModelPosition to DOM position (simplified)
  public modelToDomPosition(modelPos: ModelPosition): { node: Node, offset: number } | null {
    let currentModelNode: BaseNode = this.currentViewDoc;
    let currentDomNode: Node = this.targetElement;

    // Descend model path to find target model node
    for (let i = 0; i < modelPos.path.length; i++) {
        const modelChildIndex = modelPos.path[i];
        if (!currentModelNode.content || modelChildIndex >= currentModelNode.content.length) {
            // console.warn("Model path out of bounds during modelToDomPosition", modelPos.path, i);
            return null;
        }
        currentModelNode = currentModelNode.content[modelChildIndex];
        // Descend DOM path - this assumes a close 1-to-1 mapping for now
        // This is a major simplification. Real mapping needs to query DOM by node ID or similar.
        if (currentDomNode.childNodes.length <= modelChildIndex && currentModelNode.type.name !== 'text') { // Text nodes might not be direct children
            // console.warn("DOM path out of sync or too short", currentDomNode, modelChildIndex);
            // Try to find by ID if available
            const id = currentModelNode.attrs?.id;
            if (id) {
                const foundById = this.targetElement.querySelector(`[id="${id}"]`);
                if (foundById) currentDomNode = foundById;
                else return null; // Cannot find DOM node for model path
            } else {
                 return null;
            }
        } else if(currentModelNode.type.name !== 'text') { // For non-text nodes, descend in DOM
             currentDomNode = currentDomNode.childNodes[modelChildIndex];
        }
         // If currentModelNode is text, currentDomNode should be its parent element from previous step.
    }

    if (currentModelNode.isText && !currentModelNode.isLeaf) {
        // Find the actual text node in the DOM under currentDomNode (which is parent element)
        let textChild: Node | null = null;
        for(let i=0; i < currentDomNode.childNodes.length; i++) {
            if (currentDomNode.childNodes[i].nodeType === Node.TEXT_NODE) {
                 // This is too simple if there are multiple text nodes or interspersed elements.
                 // It should ideally find the text node corresponding to currentModelNode.
                 // For PoC, assume it's the first one or the one matching content.
                 textChild = currentDomNode.childNodes[i];
                 break;
            }
        }
        if (textChild) {
            return { node: textChild, offset: modelPos.offset };
        } else { // No text node found, maybe an empty paragraph that model says has text
            // Create a dummy text node for selection if allowed, or select element itself
            // For now, if text node is expected but not found, select element boundary
            return { node: currentDomNode, offset: 0 };
        }
    } else if (!currentModelNode.isLeaf && currentModelNode.content) { // Element node
        // Offset is an index into content array. Map to corresponding DOM child.
        // This is simplified. It assumes that the model's child at modelPos.offset
        // corresponds to a DOM child that selection can be placed around.
        if (currentDomNode.childNodes.length >= modelPos.offset) {
            return { node: currentDomNode, offset: modelPos.offset };
        } else { // Offset out of bounds for DOM children (e.g. end of element)
            return { node: currentDomNode, offset: currentDomNode.childNodes.length };
        }
    } else if (currentModelNode.isLeaf) {
        // For leaf node, selection is usually before or after it.
        // The currentDomNode should be the leaf node itself.
        return { node: currentDomNode, offset: modelPos.offset > 0 ? 1: 0 }; // 0 for before/at, 1 for after
    }
    return null;
  }

  public applyModelSelectionToDom(modelSelection: ModelSelection | null): void {
    if (!modelSelection) return;

    const anchorDomPos = this.modelToDomPosition(modelSelection.anchor);
    const headDomPos = this.modelToDomPosition(modelSelection.head);

    if (anchorDomPos && headDomPos) {
        const domSelection = window.getSelection();
        if (domSelection) {
            // Avoid resetting selection if it's already effectively the same
            // This check is basic and might need more robust comparison
            const currentRange = domSelection.rangeCount > 0 ? domSelection.getRangeAt(0) : null;
            if (currentRange &&
                currentRange.startContainer === anchorDomPos.node && currentRange.startOffset === anchorDomPos.offset &&
                currentRange.endContainer === headDomPos.node && currentRange.endOffset === headDomPos.offset) {
                // return; // Selection is already correct
            }

            this.lastViewModelSelection = modelSelection; // Store what we intended to apply

            const newRange = document.createRange();
            newRange.setStart(anchorDomPos.node, anchorDomPos.offset);
            newRange.setEnd(headDomPos.node, headDomPos.offset);

            // Check if targetElement still has focus before changing selection
            if (document.activeElement === this.targetElement) {
                 domSelection.removeAllRanges();
                 domSelection.addRange(newRange);
            } else {
                // console.warn("Target element does not have focus. Skipping DOM selection update.");
                // Store it to be applied on next focus? Or rely on selectionchange to sync.
            }
        }
    } else {
        // console.warn("Could not map model selection to DOM", modelSelection);
    }
  }

  private areSelectionsEqual(sel1: ModelSelection, sel2: ModelSelection): boolean {
    if (!sel1 || !sel2) return sel1 === sel2;
    return this.arePositionsEqual(sel1.anchor, sel2.anchor) &&
           this.arePositionsEqual(sel1.head, sel2.head);
  }

  private arePositionsEqual(pos1: ModelPosition, pos2: ModelPosition): boolean {
    if (!pos1 || !pos2) return pos1 === pos2;
    if (pos1.offset !== pos2.offset) return false;
    if (pos1.path.length !== pos2.path.length) return false;
    for (let i = 0; i < pos1.path.length; i++) {
      if (pos1.path[i] !== pos2.path[i]) return false;
    }
    return true;
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !this.isComposing) {
        // This is a simplified Enter handler.
        // More complex logic for splitting lists, code blocks etc. would go here.
        // event.preventDefault(); // Prevent default if we are handling it fully
        // this.applyChange({ type: 'insertParagraph' });
    } else if (event.key === 'Backspace' && !this.isComposing) {
        // Backspace might be handled by beforeinput's deleteContentBackward
        // But complex scenarios (e.g. deleting a whole block) might need keydown.
    } else if ((event.metaKey || event.ctrlKey) && event.key === 'z') {
        event.preventDefault();
        this.undo();
    } else if ((event.metaKey || event.ctrlKey) && (event.key === 'y' || (event.shiftKey && event.key === 'Z'))) {
        event.preventDefault();
        this.redo();
    } else if ((event.metaKey || event.ctrlKey) && event.key === 'b') {
        event.preventDefault();
        this.toggleMark('bold');
    } else if ((event.metaKey || event.ctrlKey) && event.key === 'i') {
        event.preventDefault();
        this.toggleMark('italic');
    }
     // Arrow keys are usually handled by the browser, but might need interception
     // for custom block navigation or focus behavior.
     // For now, let them be handled natively and update model selection via 'selectionchange'.
  }

  private handleBeforeInput(event: InputEvent): void {
    if (this.isComposing) return;
    event.preventDefault(); // We'll manage the model and DOM update

    const change: SimpleChange = { type: event.inputType as any }; // TODO: Type safety

    switch (event.inputType) {
      case 'insertText':
        change.text = event.data || undefined;
        this.applyChange(change);
        break;
      case 'deleteContentBackward':
      case 'deleteContentForward':
        this.applyChange(change);
        break;
      case 'insertParagraph':
        this.applyChange(change);
        break;
      case 'formatBold':
      case 'formatItalic':
      case 'formatStrikeThrough': // Assuming this is a valid InputEvent.inputType
          this.toggleMark(event.inputType.substring(6).toLowerCase()); // "formatBold" -> "bold"
          break;
      case 'insertFromPaste':
          change.dataTransfer = event.dataTransfer;
          this.applyChange(change);
          break;
      default:
        console.log('Unhandled beforeinput type:', event.inputType, event.data);
        event.preventDefault(); // Prevent unhandled actions
        return;
    }
  }

  private applyChange(change: SimpleChange): void {
    if (!this.currentModelSelection) {
        console.warn("No model selection, cannot apply change", change);
        return;
    }

    const tr = new Transaction(this.currentViewDoc, this.currentModelSelection);
    let newSelectionAnchorPos: ModelPosition | null = null;
    let newSelectionHeadPos: ModelPosition | null = null;

    // Convert model selection to flat offsets for transaction methods
    const flatAnchor = modelPositionToFlatOffset(this.currentViewDoc, this.currentModelSelection.anchor, this.schema);
    const flatHead = this.currentModelSelection.anchor === this.currentModelSelection.head ?
                     flatAnchor :
                     modelPositionToFlatOffset(this.currentViewDoc, this.currentModelSelection.head, this.schema);

    const from = Math.min(flatAnchor, flatHead);
    const to = Math.max(flatAnchor, flatHead);


    switch (change.type) {
      case 'insertText':
        if (change.text) {
          // TODO: Get marks from current selection if selection is collapsed
          const marks = this.getMarksAtPosition(this.currentViewDoc, this.currentModelSelection.anchor);
          const textNode = this.schema.text(change.text, marks);
          tr.replace(from, to, Slice.fromFragment([textNode]));

          const newFlatPos = from + textNode.text.length;
          newSelectionAnchorPos = newSelectionHeadPos = flatOffsetToModelPosition(tr.doc, newFlatPos, this.schema);
        }
        break;

      // Other cases (deleteContentBackward, insertParagraph, etc.) would also use tr.replace, tr.delete, tr.split, etc.
      // and then calculate newSelectionAnchorPos / newSelectionHeadPos.
      // These are complex and omitted for this PoC step's focus on transaction setup.
      // For example, a simplified deleteContentBackward:
      case 'deleteContentBackward':
        if (from === to && from > 0) { // Collapsed selection, not at doc start
            tr.delete(from -1, from); // Delete one char before
            newSelectionAnchorPos = newSelectionHeadPos = flatOffsetToModelPosition(tr.doc, from -1, this.schema);
        } else if (from < to) { // Range selected
            tr.delete(from, to);
            newSelectionAnchorPos = newSelectionHeadPos = flatOffsetToModelPosition(tr.doc, from, this.schema);
        }
        break;

      case 'insertParagraph':
        // This is highly simplified. Real paragraph insertion needs to handle splitting current node, etc.
        // For PoC, let's assume we replace a selection with a new paragraph, or insert if collapsed.
        const newPara = this.schema.node('paragraph', {}, [this.schema.text('')]); // Empty new para
        tr.replace(from, to, Slice.fromFragment([newPara]));
        // Selection would go into the new paragraph, e.g., at its start.
        // Flat position for start of newPara content: from + 1 (for opening <p> tag)
        const newParaStartFlatPos = from + 1;
        newSelectionAnchorPos = newSelectionHeadPos = flatOffsetToModelPosition(tr.doc, newParaStartFlatPos, this.schema);
        break;

      case 'paste':
        if (change.dataTransfer) {
            const pastedText = change.dataTransfer.getData('text/plain');
            if (pastedText) {
                // Very basic paste: insert as plain text
                // A real paste would parse HTML if available, sanitize, etc.
                const marks = this.getMarksAtPosition(this.currentViewDoc, this.currentModelSelection.anchor);
                const textNode = this.schema.text(pastedText, marks);
                tr.replace(from, to, Slice.fromFragment([textNode]));
                const newFlatPastePos = from + textNode.text.length;
                newSelectionAnchorPos = newSelectionHeadPos = flatOffsetToModelPosition(tr.doc, newFlatPastePos, this.schema);
            }
        }
        break;

      default:
        console.warn("Unhandled SimpleChange type in applyChange:", change.type);
        return;
    }

    if (newSelectionAnchorPos && newSelectionHeadPos) {
        tr.setSelection({ anchor: newSelectionAnchorPos, head: newSelectionHeadPos });
    } else {
        // If selection wasn't explicitly set, map the old one.
        // This happens automatically in tr.addStep if we don't call tr.setSelection.
        // However, for explicit changes like insertText, we usually want to set selection precisely.
    }

    if (tr.stepsApplied) {
      this.undoManager.add(this.currentViewDoc); // Save state *before* this transaction
      this.updateDocument(tr);
    }
  }

  // Update document from a Transaction or a direct DocNode (e.g., from undo)
  public updateDocument(trOrDoc: Transaction | DocNode): void {
    this.isProcessingMutations = true; // Prevent feedback loop from MutationObserver

    const oldDocForSelectionMap = this.currentViewDoc; // Doc state before this update
    let selectionToApply: ModelSelection | null = null;

    if (trOrDoc instanceof Transaction) {
        this.currentViewDoc = trOrDoc.doc;
        selectionToApply = trOrDoc.selection;
    } else { // Direct DocNode (e.g., from undo/redo)
        this.currentViewDoc = trOrDoc;
        // Try to map the last known model selection through the change from oldDoc to newDoc.
        // This is a very simplified mapping for undo/redo.
        // A full solution would involve inverting and re-applying steps' maps.
        if (this.currentModelSelection) {
            // For simplicity, let's try to re-resolve the last DOM selection against the new doc
            // or default to start. This is not robust for undo/redo.
            const domSel = window.getSelection();
            if (domSel && domSel.rangeCount > 0) {
                selectionToApply = this.domToModelSelection(domSel.getRangeAt(0));
            }
            if (!selectionToApply) { // Fallback
                const firstTextInfo = this.findFirstTextNodePath(this.currentViewDoc);
                selectionToApply = firstTextInfo ?
                    { anchor: { path: firstTextInfo.path, offset: 0}, head: {path: firstTextInfo.path, offset: 0}} :
                    { anchor: { path: [], offset: 0 }, head: { path: [], offset: 0 } };
            }
        }
    }

    this.domPatcher.patch(this.currentViewDoc);

    if (selectionToApply) {
        this.currentModelSelection = selectionToApply; // Update internal model selection state
        this.applyModelSelectionToDom(selectionToApply);
    } else {
        this.currentModelSelection = null; // Or set to a default
    }

    // After patching and selection, ensure the model selection reflects the DOM
    // This can sometimes be necessary if applyModelSelectionToDom had issues or if browser behavior altered it.
    // However, be cautious as this could also fight with intended selection.
    // this.updateModelSelectionState();

    // Check if last applied model selection matches current DOM selection after render.
    // If not, it might indicate issues in modelToDomPosition or external factors.
    // this.verifyAppliedSelection();

    this.isProcessingMutations = false;
  }

  private verifyAppliedSelection(): void {
    if (!this.lastViewModelSelection) return;

    const domSelection = window.getSelection();
    if (domSelection && domSelection.rangeCount > 0) {
        const currentDomRange = domSelection.getRangeAt(0);
        const expectedAnchor = this.modelToDomPosition(this.lastViewModelSelection.anchor);
        const expectedHead = this.modelToDomPosition(this.lastViewModelSelection.head);

        if (expectedAnchor && expectedHead &&
            (currentDomRange.startContainer !== expectedAnchor.node ||
             currentDomRange.startOffset !== expectedAnchor.offset ||
             currentDomRange.endContainer !== expectedHead.node ||
             currentDomRange.endOffset !== expectedHead.offset)) {
            // console.warn("DOM selection diverges from applied model selection.",
            //   "Applied:", this.lastViewModelSelection,
            //   "Actual DOM:", {anchor: {node:currentDomRange.startContainer, offset:currentDomRange.startOffset}, head:{node:currentDomRange.endContainer, offset:currentDomRange.endOffset}}
            // );
        }
    }
  }


  private handleMutations(mutations: MutationRecord[]): void {
    if (this.isProcessingMutations) return; // Avoid processing mutations we caused
    // console.log("Observed mutations:", mutations);

    // Basic reconciliation: Re-parse the entire content if significant changes are detected.
    // This is a very naive approach and can be slow and lose local selection.
    // A more sophisticated approach would try to map mutations to model changes.
    // For now, if any structural change or text change not directly tied to composition,
    // consider re-parsing or raising a warning.

    // Simplest PoC: assume any mutation means external change, re-read selection.
    // This is not a robust way to handle mutations for model syncing.
    // A proper mutation handler would convert DOM changes to model operations (Steps).
    // For now, we primarily drive changes from `beforeinput`.
    // This handler is more of a fallback or for external changes.

    // If not composing and mutations are significant, could try to re-sync.
    // For this phase, we assume most changes are driven by `beforeinput` and transactions.
    // This mutation handler will mostly just update selection state if needed.
    let needsSelectionUpdate = false;
    for (const mutation of mutations) {
        if (mutation.type === 'characterData' || mutation.type === 'childList') {
            // if (!this.isComposing) { // Only if not part of ongoing composition
            //     console.warn("Unhandled mutation observed. Model might be out of sync.", mutation);
            //     // Potentially trigger a re-parse or a more sophisticated diff-and-patch from DOM to model.
            // }
            needsSelectionUpdate = true; // Text changes or child changes might affect selection mapping
        }
    }
    if (needsSelectionUpdate) {
        // this.updateModelSelectionState();
    }
  }

  public setFocus(): void {
    this.targetElement.focus();
    // Ensure selection is applied after focus
    if(this.currentModelSelection) {
        this.applyModelSelectionToDom(this.currentModelSelection);
    } else {
        this.ensureInitialSelection(); // Apply a default selection if none exists
    }
  }

  public undo(): void {
    const prevState = this.undoManager.undo();
    if (prevState) {
      this.updateDocument(prevState); // Pass DocNode directly
    }
  }

  public redo(): void {
    const nextState = this.undoManager.redo();
    if (nextState) {
      this.updateDocument(nextState); // Pass DocNode directly
    }
  }

  public toggleMark(markTypeName: string): void {
    if (!this.currentModelSelection) return;

    const markType = this.schema.marks[markTypeName] as MarkType | undefined;
    if (!markType) {
        console.warn(`Unknown mark type: ${markTypeName}`);
        return;
    }

    const tr = new Transaction(this.currentViewDoc, this.currentModelSelection);
    const { from, to } = this.getSelectedRangeFlatOffsets(tr.originalDoc, this.currentModelSelection);

    if (from === to) { // Collapsed selection - TODO: toggle "active marks" for future typing
        console.log("Toggling mark on collapsed selection - not yet implemented (would toggle active marks).");
        // This would typically involve storing active marks on the Transaction or editor state.
        return;
    }

    // Check if the mark is already active across the entire range
    // This is a simplified check. A proper check iterates through nodes in range.
    const isMarkActive = this.isMarkActiveInRange(tr.originalDoc, from, to, markType);

    if (isMarkActive) {
        // tr.removeMark(from, to, markType); // Assuming Transaction will have removeMark
        console.log(`Placeholder: Would call tr.removeMark(${from}, ${to}, ${markTypeName})`);
        // For PoC, let's manually create a new doc by removing marks. This is NOT how it should be.
        // This manual doc modification should be done by steps within the transaction.
    } else {
        // tr.addMark(from, to, markType); // Assuming Transaction will have addMark
        console.log(`Placeholder: Would call tr.addMark(${from}, ${to}, ${markTypeName})`);
    }

    // For this PoC, since tr.addMark/removeMark are not implemented on Transaction itself
    // to modify the doc, we don't apply the transaction.
    // A real implementation would have these methods on Transaction which add appropriate steps.
    // if (tr.stepsApplied) {
    //   this.undoManager.add(this.currentViewDoc);
    //   this.updateDocument(tr);
    // }
  }

  private getSelectedRangeFlatOffsets(doc: DocNode, selection: ModelSelection): { from: number, to: number } {
    const flatAnchor = modelPositionToFlatOffset(doc, selection.anchor, this.schema);
    const flatHead = selection.anchor === selection.head ?
                     flatAnchor :
                     modelPositionToFlatOffset(doc, selection.head, this.schema);
    return {
        from: Math.min(flatAnchor, flatHead),
        to: Math.max(flatAnchor, flatHead)
    };
  }

  private getMarksAtPosition(doc: DocNode, pos: ModelPosition): Mark[] {
    // Simplified: find the text node at or before the position and get its marks.
    // A full version would handle positions between nodes or at ends of nodes better.
    if (!pos) return [];
    let node: BaseNode | null = doc;
    for (let i = 0; i < pos.path.length; i++) {
        if (!node || !node.content || pos.path[i] >= node.content.length) {
            node = null; break;
        }
        node = node.content[pos.path[i]];
    }
    if (node && node.isText && !node.isLeaf) { // If path points to text node
        if (pos.offset > 0 && node.marks) return [...node.marks]; // Use marks of text node itself
        // If at offset 0, or node has no marks, try parent or preceding character's marks (more complex)
    }
    if (node && node.marks && node.marks.length > 0) return [...node.marks]; // For some inline non-text nodes

    // Fallback: walk backward from position to find nearest character with marks? (Prosemirror way)
    // For now, if not directly on a text node with marks, assume no marks.
    return [];
  }

  private isMarkActiveInRange(doc: DocNode, fromFlat: number, toFlat: number, markType: MarkType): boolean {
    // Simplified check: check marks at the start of the range.
    // A full check iterates all nodes/text segments in the range.
    if (fromFlat === toFlat) { // Collapsed selection
        const pos = flatOffsetToModelPosition(doc, fromFlat, this.schema);
        const marks = this.getMarksAtPosition(doc, pos);
        return marks.some(m => m.type === markType);
    }
    // For a range, this is more complex. For PoC, check start.
    const startPos = flatOffsetToModelPosition(doc, fromFlat, this.schema);
    const marksAtStart = this.getMarksAtPosition(doc, startPos);
    return marksAtStart.some(m => m.type === markType);
  }


  // Ensure all block-level nodes have an 'id' attribute.
  // This is important for the DomPatcher's keyed diffing.
  public ensureBlockIds(doc: DocNode): DocNode {
    let changed = false;
    const newContent = (doc.content || []).map(blockNode => {
        if (!blockNode.attrs || blockNode.attrs.id === undefined || blockNode.attrs.id === null) {
            // Create a new node with a new ID
            changed = true;
            const newAttrs = { ...blockNode.attrs, id: this.schema.generateNodeId() };
            // Need to recursively ensure IDs for children if this block node can have block children (e.g. list_item, blockquote)
            let newBlockContent = blockNode.content;
            if (blockNode.content && (blockNode.type.name === 'list_item' || blockNode.type.name === 'blockquote')) { // Example types
                const tempNestedDoc = this.schema.node(blockNode.type.name, {}, blockNode.content) as DocNode; // Hack to treat as temp doc
                const newNestedDocWithIds = this.ensureBlockIds(tempNestedDoc);
                newBlockContent = newNestedDocWithIds.content;
            }
            return this.schema.node(blockNode.type, newAttrs, newBlockContent, blockNode.marks) as BaseNode;
        }
        // Recursively ensure IDs for children if necessary
        if (blockNode.content && (blockNode.type.name === 'list_item' || blockNode.type.name === 'blockquote')) {
            const tempNestedDoc = this.schema.node(blockNode.type.name, blockNode.attrs, blockNode.content) as DocNode; // Hack
            const newNestedDocWithIds = this.ensureBlockIds(tempNestedDoc);
            if (newNestedDocWithIds.content !== blockNode.content) { // Content changed due to IDs
                changed = true;
                return this.schema.node(blockNode.type, blockNode.attrs, newNestedDocWithIds.content, blockNode.marks) as BaseNode;
            }
        }
        return blockNode;
    });

    if (changed) {
        return this.schema.node(doc.type, doc.attrs, newContent) as DocNode;
    }
    return doc;
  }
}

console.log("RitorVDOM.ts updated to use Transaction and flat offset utilities.");
