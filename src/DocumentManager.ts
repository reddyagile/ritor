// src/DocumentManager.ts
import Cursor from './Cursor'; // Will be used for selection translation
import Ritor from './Ritor';
import { Document, Delta, Op, OpAttributes as OpAttributesType } from './Document';
// import { domUtil } from './utils'; // We'll remove direct DOM utils over time

// Represents selection within the Document model
export interface DocSelection {
  index: number;
  length: number;
}

class DocumentManager {
  public cursor: Cursor; // We still need cursor for DOM selection info
  public ritor: Ritor;
  private currentDocument: Document;
  public commandState: Map<string, boolean> = new Map(); // This might be handled differently later

  constructor(ritor: Ritor, initialDelta?: Delta) {
    this.ritor = ritor;
    this.cursor = new Cursor(); // Cursor will help get DOM range to convert to DocSelection
    this.currentDocument = new Document(initialDelta || new Delta().push({ insert: '\n' }));
    // TODO: Initialize commandState based on initial selection/document state if needed
  }

  public getDocument(): Document {
    return this.currentDocument;
  }

  public domRangeToDocSelection(range: Range): DocSelection | null {
    const editorEl = this.ritor.$el;
    if (!editorEl.contains(range.startContainer) || !editorEl.contains(range.endContainer)) {
      return null;
    }

    let charCount = 0;
    let start = -1;
    let end = -1;

    const nodeIterator = document.createNodeIterator(
      editorEl,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      null
    );

    let currentNode: Node | null;
    let foundStartContainer = false;
    let foundEndContainer = false;

    function getRecursiveTextLength(node: Node): number {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length || 0;
        if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.nodeName.toUpperCase() === 'BR') return 1; // Count BR as 1 in recursive helper too
            let len = 0;
            node.childNodes.forEach(child => len += getRecursiveTextLength(child));
            return len;
        }
        return 0;
    }

    function getLengthTillChild(parentElement: Node, childOffset: number): number {
        let length = 0;
        for (let i = 0; i < childOffset; i++) {
            if (parentElement.childNodes[i]) {
                length += getRecursiveTextLength(parentElement.childNodes[i]);
            }
        }
        return length;
    }

    while ((currentNode = nodeIterator.nextNode()) && (!foundEndContainer || end === -1)) {
      if (currentNode.nodeType === Node.TEXT_NODE) {
        const textLength = currentNode.textContent?.length || 0;

        // Check if this text node is the start container
        if (!foundStartContainer && currentNode === range.startContainer) {
          start = charCount + range.startOffset;
          foundStartContainer = true;
        }
        // Check if this text node is the end container
        if (!foundEndContainer && currentNode === range.endContainer) {
          end = charCount + range.endOffset;
          foundEndContainer = true;
        }
        charCount += textLength;
      } else if (currentNode.nodeType === Node.ELEMENT_NODE) {
        if (currentNode.nodeName.toUpperCase() === 'BR') {
          if (!foundStartContainer && range.startContainer === currentNode) {
             start = charCount + range.startOffset; // offset 0 before, 1 after BR
             foundStartContainer = true;
          }
          if (!foundEndContainer && range.endContainer === currentNode) {
             end = charCount + range.endOffset;
             foundEndContainer = true;
          }
          charCount += 1;
        } else {
            // Existing logic for other element nodes if they are the range container
            if (!foundStartContainer && currentNode === range.startContainer) {
                start = charCount + getLengthTillChild(currentNode, range.startOffset);
                foundStartContainer = true;
            }
            if (!foundEndContainer && currentNode === range.endContainer) {
                end = charCount + getLengthTillChild(currentNode, range.endOffset);
                foundEndContainer = true;
            }
        }
      }
    }

    if (range.collapsed) {
      if (start !== -1) {
        end = start;
      } else {
        const totalDocLength = getRecursiveTextLength(editorEl);
        // If range points to editor start and editor is empty (or effectively empty with BRs)
        if (range.startContainer === editorEl && range.startOffset === 0) {
            start = 0;
            end = 0;
        } else {
            start = totalDocLength;
            end = totalDocLength;
        }
      }
    }

    if (end !== -1 && start !== -1 && end < start) {
        end = start;
    }

    if (start === -1 || end === -1) {
      const currentTotalLength = getRecursiveTextLength(editorEl);
      if (editorEl.childNodes.length === 0 && range.startContainer === editorEl && range.endContainer === editorEl) {
          return { index: 0, length: 0 };
      }
      if (start !== -1 && end === -1) { // Start found, but end is beyond content
          end = currentTotalLength;
          if (start > end) start = end;
          return { index: start, length: Math.max(0, end - start) };
      }
      console.warn('Could not map DOM range to document selection accurately. Range:', range, 'Calculated:', {start,end}, 'TotalLen:', currentTotalLength);
      // If start is still -1, means something is very off or selection is at very end of complex structure.
      // Default to end of document.
      return { index: (start !== -1 ? start : currentTotalLength), length: 0 };
    }
    return { index: start, length: Math.max(0, end - start) };
  }

  public docSelectionToDomRange(docSelection: DocSelection): Range | null {
    const editorEl = this.ritor.$el;
    if (!editorEl) return null;

    const range = document.createRange();
    let charCount = 0;
    let startNode: Node | null = null;
    let startOffset = 0;
    let endNode: Node | null = null;
    let endOffset = 0;
    let foundStart = false;
    let foundEnd = false;

    const targetStartIndex = docSelection.index;
    const targetEndIndex = docSelection.index + docSelection.length;

    const nodeIterator = document.createNodeIterator(
      editorEl,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, // MODIFIED: Include elements
      null
    );

    let currentNode: Node | null;

    if (targetStartIndex === 0 && targetEndIndex === 0) {
        let isEmptyIsh = true;
        let firstChildNode: Node | null = null;
        const tempIter = document.createNodeIterator(editorEl, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null);
        let tempNode;
        while(tempNode = tempIter.nextNode()){
            if(tempNode.nodeType === Node.TEXT_NODE && tempNode.textContent !== ""){
                isEmptyIsh = false; firstChildNode = tempNode; break;
            }
            if(tempNode.nodeName === "BR"){ // BR means not truly empty for selection purposes
                isEmptyIsh = false; firstChildNode = tempNode; break;
            }
            if(tempNode.nodeType === Node.ELEMENT_NODE && tempNode.childNodes.length > 0 && tempNode.textContent !== ""){
                 isEmptyIsh = false; // Has non-empty children
            }
            if(!firstChildNode) firstChildNode = tempNode;
        }
        if (isEmptyIsh) {
            let focusNode: Node = firstChildNode || editorEl;
            if (!editorEl.firstChild) { // Truly empty
                const tempText = document.createTextNode('');
                editorEl.appendChild(tempText);
                focusNode = tempText;
            }
             try {
                if (focusNode.nodeType === Node.TEXT_NODE) {
                    range.setStart(focusNode, 0);
                } else { // Element, possibly editorEl itself or a BR
                    range.selectNodeContents(focusNode); // Select the element
                    range.collapse(true);      // Collapse to its start
                }
                return range;
            } catch (e) {
                console.warn("Error setting range on empty editor:", e);
            }
        }
    }

    while ((currentNode = nodeIterator.nextNode()) && (!foundEnd || (docSelection.length === 0 && !foundStart) )) {
      let nodeLength = 0;
      if (currentNode.nodeType === Node.TEXT_NODE) {
        nodeLength = currentNode.textContent?.length || 0;
      } else if (currentNode.nodeType === Node.ELEMENT_NODE) {
        if (currentNode.nodeName.toUpperCase() === 'BR') {
          nodeLength = 1; // BR represents one char
        }
        // Other elements don't contribute to charCount directly in this model
      }

      const endCharCountAfterThisNode = charCount + nodeLength;

      if (!foundStart && targetStartIndex >= charCount && targetStartIndex <= endCharCountAfterThisNode) {
        startNode = currentNode;
        if (currentNode.nodeType === Node.TEXT_NODE) {
            startOffset = targetStartIndex - charCount;
        } else if (currentNode.nodeName.toUpperCase() === 'BR') {
            // If target is BR's position (charCount), select *before* BR. Offset 0 of BR.
            // If target is charCount+1 (after BR), selection should be *after* BR.
            // This needs to be relative to parent usually.
            // For simplicity: if index is BR's char spot, set offset 0 on BR.
            // If index is BR's char spot + 1, set offset 1 on BR (or next node).
            startOffset = targetStartIndex - charCount; // 0 if before/at BR, 1 if after BR
        } else { // Other element, select at child index or text boundary
            startOffset = 0; // Default for elements, may need getChildNodeAtCharOffset logic
        }
        foundStart = true;
        if (docSelection.length === 0) { // Collapsed selection
          endNode = startNode;
          endOffset = startOffset;
          foundEnd = true;
        }
      }

      if (docSelection.length > 0 && !foundEnd && targetEndIndex >= charCount && targetEndIndex <= endCharCountAfterThisNode) {
        endNode = currentNode;
        if (currentNode.nodeType === Node.TEXT_NODE) {
            endOffset = targetEndIndex - charCount;
        } else if (currentNode.nodeName.toUpperCase() === 'BR') {
            endOffset = targetEndIndex - charCount;
        } else {
            endOffset = 0; // Default for elements
        }
        foundEnd = true;
      }

      if (nodeLength > 0) { // Only increment charCount if the node has a length (text or BR)
          charCount = endCharCountAfterThisNode;
      }
    }

    if (!foundStart) {
        let lastNode: Node | null = null;
        let lastNodeLength = 0;
        const allNodesIterator = document.createNodeIterator(editorEl, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null);
        let tempCurrentNode: Node | null;
        while(tempCurrentNode = allNodesIterator.nextNode()){
            if(tempCurrentNode.nodeType === Node.TEXT_NODE) {
                lastNode = tempCurrentNode;
                lastNodeLength = tempCurrentNode.textContent?.length || 0;
            } else if (tempCurrentNode.nodeName.toUpperCase() === 'BR') {
                lastNode = tempCurrentNode;
                lastNodeLength = 1;
            } else if (!lastNode && tempCurrentNode.nodeType === Node.ELEMENT_NODE && tempCurrentNode.firstChild) {
                // If no text/BR yet, but an element, use it as a fallback start
                lastNode = tempCurrentNode;
                lastNodeLength = 0;
            }
        }

        if (lastNode) {
            startNode = lastNode;
            startOffset = (lastNode.nodeType === Node.TEXT_NODE) ? lastNodeLength : (lastNode.nodeName === 'BR' ? 1: 0) ;
        } else {
            startNode = editorEl.firstChild || editorEl;
            startOffset = 0;
            if (startNode.nodeType !== Node.TEXT_NODE) {
                 try { range.selectNodeContents(startNode); range.collapse(true); return range; } catch(e){}
            }
        }
    }

    if (docSelection.length === 0 && foundStart && !foundEnd) {
        endNode = startNode;
        endOffset = startOffset;
    } else if (!foundEnd) {
        // Similar logic as above for finding last node for startNode
        let lastNode: Node | null = null;
        let lastNodeLength = 0; // length of the last text node or 1 for BR
        const allNodesIterator = document.createNodeIterator(editorEl, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null);
        let tempCurrentNode: Node | null;
        while(tempCurrentNode = allNodesIterator.nextNode()){
             if(tempCurrentNode.nodeType === Node.TEXT_NODE) {
                lastNode = tempCurrentNode;
                lastNodeLength = tempCurrentNode.textContent?.length || 0;
            } else if (tempCurrentNode.nodeName.toUpperCase() === 'BR') {
                lastNode = tempCurrentNode;
                lastNodeLength = 1;
            } else if (!lastNode && tempCurrentNode.nodeType === Node.ELEMENT_NODE && tempCurrentNode.firstChild) {
                lastNode = tempCurrentNode;
                lastNodeLength = 0;
            }
        }
        if (lastNode) {
            endNode = lastNode;
            endOffset = (lastNode.nodeType === Node.TEXT_NODE) ? lastNodeLength : (lastNode.nodeName === 'BR' ? 1: 0) ;
        } else {
            endNode = startNode; // Should not happen if startNode was found
            endOffset = startOffset;
        }
    }

    if (startNode && endNode) {
      try {
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);
        return range;
      } catch (e) {
          console.error("Error setting range:", e, {startNode, startOffset, endNode, endOffset, docSelection});
          try { range.selectNodeContents(editorEl); range.collapse(true); } catch (finalError) { console.error("Fallback range setting failed:", finalError); return null; }
          return range;
      }
    }

    console.warn('Could not map document selection to DOM range accurately (final fallback).', docSelection);
    try { range.selectNodeContents(editorEl); range.collapse(true); } catch (e) { return null; }
    return range;
  }
  // ... (rest of DocumentManager.ts) ...
}

// Helper for iterating over ops in a Delta
class DeltaIterator {
     ops: Op[];
     index: number;
     offset: number;

     constructor(ops: Op[]) {
         this.ops = ops; // Store a copy to avoid modifying the original delta's ops array directly
         this.index = 0;
         this.offset = 0;
     }

     hasNext(): boolean {
         return this.index < this.ops.length && this.offset < OpUtils.getOpLength(this.ops[this.index]);
     }

     peek(): Op | null {
         if (this.hasNext()) { // Use hasNext to ensure op is valid and not fully consumed
            const currentOp = this.ops[this.index];
            // If there's an offset, it means we are peeking at a partially consumed op.
            // The returned op should reflect this remaining part.
            if (this.offset > 0) {
                if (currentOp.insert) {
                    return { insert: currentOp.insert.substring(this.offset), attributes: currentOp.attributes };
                } else if (currentOp.retain) {
                    return { retain: currentOp.retain - this.offset, attributes: currentOp.attributes };
                }
                // Delete ops are usually not peeked partially, but if so, it's complex.
                // For simplicity, assume delete ops are peeked whole.
            }
            return currentOp;
         }
         return null;
     }

     peekType(): string | null {
         const op = this.peek(); // Relies on peek() to give the current effective op
         if (!op) return null;
         if (op.insert) return 'insert';
         if (op.delete) return 'delete';
         if (op.retain) return 'retain';
         return null;
     }

     next(length?: number): Op {
        if (!this.hasNext()) {
            // Or throw error, or return a specific 'end' Op. For now, an empty op.
            return {};
        }

        const currentOp = this.ops[this.index];
        const currentOpEffectiveLength = OpUtils.getOpLength(currentOp) - this.offset;

        let opToReturn: Op;
        const consumeLength = length == null ? currentOpEffectiveLength : Math.min(length, currentOpEffectiveLength);

        if (currentOp.insert) {
            opToReturn = {
                insert: currentOp.insert.substring(this.offset, this.offset + consumeLength),
                attributes: currentOp.attributes
            };
        } else if (currentOp.retain) {
            opToReturn = {
                retain: consumeLength,
                attributes: currentOp.attributes
            };
        } else if (currentOp.delete) {
            opToReturn = {
                delete: consumeLength
                // Delete ops typically don't have attributes
            };
        } else {
            opToReturn = {}; // Should not happen if ops are valid
        }

        this.offset += consumeLength;
        if (this.offset >= OpUtils.getOpLength(currentOp)) {
            this.index++;
            this.offset = 0;
        }
        return opToReturn;
     }
 }

 // Helper for Op utilities (would be part of a full Delta library)
 class OpUtils {
    static getOpLength(op: Op): number {
         if (typeof op.delete === 'number') return op.delete;
         if (typeof op.retain === 'number') return op.retain;
         if (typeof op.insert === 'string') return op.insert.length;
         return 0;
     }
 }

// Renamed from OpAttributes to OpAttributeComposer
// Revised OpAttributeComposer.compose for clarity and correctness:
class OpAttributeComposer {
    static compose(a?: OpAttributesType, b?: OpAttributesType, keepNull: boolean = false): OpAttributesType | undefined {
        if (typeof a !== 'object') a = {}; // Default to empty object if undefined
        if (typeof b !== 'object') b = {}; // Default to empty object if undefined

        let attributes: OpAttributesType = { ...a }; // Start with a clone of a

        for (const key in b) { // Apply b's properties over a
            if (b.hasOwnProperty(key)) { // Ensure key is own property of b
                attributes[key] = b[key];
            }
        }

        if (!keepNull) { // If not keeping nulls, remove any attribute that is null
            for (const key in attributes) {
                if (attributes.hasOwnProperty(key) && attributes[key] === null) {
                    delete attributes[key];
                }
            }
        }

        return Object.keys(attributes).length > 0 ? attributes : undefined;
    }
}


export default DocumentManager;
