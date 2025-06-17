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

  // Converts a DOM Range to a DocSelection
  public domRangeToDocSelection(range: Range): DocSelection | null {
    // This is a placeholder. Implementation requires walking the DOM
    // and mapping it to the document model's length.
    // For example, count characters from the beginning of the editor content
    // up to the start and end of the range, considering only text nodes.
    // This needs to be aware of the structure rendered by Renderer.ts later.
    console.warn('domRangeToDocSelection is not fully implemented.');
    // Simplified initial version:
    if (!this.ritor.$el.contains(range.startContainer) || !this.ritor.$el.contains(range.endContainer)) {
      return null;
    }

    let start = 0;
    let end = 0;

    const editorText = this.ritor.$el.textContent || "";

    // This is a naive implementation and will need to be much more robust
    // when dealing with complex HTML and the internal Document model.
    const rangeStartNode = range.startContainer;
    const rangeStartOffset = range.startOffset;

    let charCount = 0;
    let foundStart = false;

    function getTextLength(node: Node): number {
       if (node.nodeType === Node.TEXT_NODE) {
         return node.textContent?.length || 0;
       } else if (node.nodeType === Node.ELEMENT_NODE) {
         let len = 0;
         node.childNodes.forEach(child => len += getTextLength(child));
         return len;
       }
       return 0;
    }

    function findOffset(parentNode: Node, targetNode: Node, offsetInTarget: number): number {
       let currentOffset = 0;
       for (const childNode of Array.from(parentNode.childNodes)) {
         if (childNode === targetNode) {
           if (childNode.nodeType === Node.TEXT_NODE) {
             return currentOffset + offsetInTarget;
           } else { // For element nodes, offset might mean child index
              let subOffset = 0;
              for(let i=0; i < offsetInTarget; i++) {
                 if(childNode.childNodes[i]) {
                     subOffset += getTextLength(childNode.childNodes[i]);
                 }
              }
              return currentOffset + subOffset;
           }
         }
         const length = getTextLength(childNode);
         if (targetNode.compareDocumentPosition(childNode) & Node.DOCUMENT_POSITION_FOLLOWING) {
              // skip
         } else if (childNode.contains(targetNode)) {
             return currentOffset + findOffset(childNode, targetNode, offsetInTarget);
         }
         currentOffset += length;
       }
       return -1; // Should not happen if targetNode is within parentNode
    }

    start = findOffset(this.ritor.$el, range.startContainer, range.startOffset);
    if (range.collapsed) {
        end = start;
    } else {
        end = findOffset(this.ritor.$el, range.endContainer, range.endOffset);
    }

    if(start === -1 ) return { index: 0, length: 0}; // fallback

    return { index: Math.max(0, start), length: Math.max(0, end - start) };
  }

  // Converts a DocSelection to a DOM Range
  public docSelectionToDomRange(docSelection: DocSelection): Range | null {
     // This is also a placeholder. Implementation requires mapping an index/length
     // back to DOM text nodes and offsets. This will be tightly coupled with
     // how Renderer.ts structures the DOM.
     console.warn('docSelectionToDomRange is not fully implemented.');
     if (!this.ritor.$el) return null;

     const range = document.createRange();
     let charCount = 0;
     let startNode: Node | null = null;
     let startOffset = 0;
     let endNode: Node | null = null;
     let endOffset = 0;

     function findNodeAndOffset(parentNode: Node, targetOffset: number): { node: Node | null, offset: number } {
         for (const childNode of Array.from(parentNode.childNodes)) {
             if (childNode.nodeType === Node.TEXT_NODE) {
                 const nodeLength = childNode.textContent?.length || 0;
                 if (charCount + nodeLength >= targetOffset) {
                     return { node: childNode, offset: targetOffset - charCount };
                 }
                 charCount += nodeLength;
             } else if (childNode.nodeType === Node.ELEMENT_NODE) {
                 const result = findNodeAndOffset(childNode, targetOffset);
                 if (result.node) {
                     return result;
                 }
                 // charCount is updated by the recursive call
             }
         }
         return { node: null, offset: 0 };
     }

     const startDetails = findNodeAndOffset(this.ritor.$el, docSelection.index);
     startNode = startDetails.node;
     startOffset = startDetails.offset;

     charCount = 0; // Reset for end node calculation
     const endDetails = findNodeAndOffset(this.ritor.$el, docSelection.index + docSelection.length);
     endNode = endDetails.node;
     endOffset = endDetails.offset;

     if (startNode && endNode) {
         range.setStart(startNode, startOffset);
         range.setEnd(endNode, endOffset);
         return range;
     }

     // Fallback if nodes not found (e.g. empty editor)
     range.selectNodeContents(this.ritor.$el);
     range.collapse(true);
     return range;
  }


  // The old applyDelta method is removed as insertText, formatText, deleteText
  // now directly compose and set the new document state.

  public insertText(text: string, selection: DocSelection) { // selection is now DocSelection
    const currentDoc = this.getDocument();
    // currentSelection is now guaranteed to be provided by Ritor

    const ops: Op[] = [];
    let newCursorIndex = selection.index;

    if (selection.index > 0) {
      ops.push({ retain: selection.index });
    }
    if (selection.length > 0) {
      ops.push({ delete: selection.length });
    }
    ops.push({ insert: text });
    newCursorIndex = selection.index + text.length; // Cursor after inserted text if no deletion, or at start of replacement

    // Important: The 'change' delta needs to be constructed so that 'compose'
    // can correctly merge it with the existing document.
    // If the change is at the end, no trailing retain is needed for *this* specific op sequence.
    // However, a robust compose function would handle this better.
    // For now, let's assume `compose` correctly handles this delta.
    // To make it more explicit for the current simple compose:
    const docLength = currentDoc.getDelta().length();
    const lengthAfterChange = selection.index + selection.length;
    if (docLength > lengthAfterChange) {
        ops.push({ retain: docLength - lengthAfterChange });
    }

    const change = new Delta(ops);
    const composedDelta = this.compose(currentDoc.getDelta(), change);
    this.currentDocument = new Document(composedDelta);

    const newSelection: DocSelection = { index: newCursorIndex, length: 0 };
    this.ritor.emit('document:change', this.currentDocument, newSelection);
  }

  public formatText(attributes: OpAttributes, selection: DocSelection) {
    const currentDoc = this.getDocument();
    // selection is now guaranteed to be provided by Ritor and is non-null.
    // Ritor also ensures selection.length > 0 for formatting.

    const ops: Op[] = [];
    // newIndex is not strictly needed here as selection itself is preserved.
    // let newCursorIndex = selection.index + selection.length;

    if (selection.index > 0) {
      ops.push({ retain: selection.index });
    }
    if (selection.length > 0) {
      ops.push({ retain: selection.length, attributes: attributes });
    }

    const docLength = currentDoc.getDelta().length();
    const lengthAfterChange = selection.index + selection.length;
    if (docLength > lengthAfterChange) {
        ops.push({ retain: docLength - lengthAfterChange });
    }

    const change = new Delta(ops);
    const composedDelta = this.compose(currentDoc.getDelta(), change);
    this.currentDocument = new Document(composedDelta);

    // Selection doesn't change by formatting content usually.
    // But we pass it so Ritor can ensure it's maintained.
    const newSelection: DocSelection = { index: selection.index, length: selection.length };
    this.ritor.emit('document:change', this.currentDocument, newSelection);
  }

  public deleteText(selection: DocSelection) {
    const currentDoc = this.getDocument();
    // selection is now guaranteed to be provided by Ritor and is non-null.
    // Ritor also ensures selection.length > 0 for deletion.

    const ops: Op[] = [];
    let newCursorIndex = selection.index; // Cursor position after deletion

    if (selection.index > 0) {
      ops.push({ retain: selection.index });
    }
    if (selection.length > 0) {
      ops.push({ delete: selection.length });
    }
    // newCursorIndex remains selection.index

    const docLength = currentDoc.getDelta().length();
    const lengthAfterChange = selection.index + selection.length; // The end position of what was deleted
    if (docLength > lengthAfterChange) {
        ops.push({ retain: docLength - lengthAfterChange });
    }

    const change = new Delta(ops);
    const composedDelta = this.compose(currentDoc.getDelta(), change);
    this.currentDocument = new Document(composedDelta);

    const newSelection: DocSelection = { index: newCursorIndex, length: 0 };
    this.ritor.emit('document:change', this.currentDocument, newSelection);
  }

  // Retrieves the formatting attributes at the current DocSelection
  // This is a simplified version.
  public getFormatAt(selection: DocSelection): OpAttributes {
    const docDelta = this.currentDocument.getDelta();
    if (!docDelta.ops) return {};

    let index = selection.index;
    if (selection.length > 0) {
      // For a range, attributes are often taken from the start of the range
      // or represent a common set. For simplicity, use start.
    } else {
      // For a collapsed selection, often look at character before,
      // or attributes active for typing.
      if (index > 0) index -=1; // Look at char before cursor
    }

    let currentPosition = 0;
    for (const op of docDelta.ops) {
      if (op.insert) {
        const opLength = op.insert.length;
        if (index >= currentPosition && index < currentPosition + opLength) {
          return op.attributes || {};
        }
        currentPosition += opLength;
      } else if (op.retain) {
        // Retain ops can also have attributes
        const opLength = op.retain;
          if (index >= currentPosition && index < currentPosition + opLength) {
          // This retain op covers the position, return its attributes.
          // If op.attributes is undefined, it means no attribute change here.
          // We need to find the *effective* attributes. This requires iterating and merging.
          // This simplified version just returns attributes of the op AT the index.
          return op.attributes || {};
        }
        currentPosition += opLength;
      }
      // Delete ops don't have attributes for content
    }
    return {}; // Default if not found or at end
  }

  public clearFormat(selection: DocSelection): void {
      const currentDoc = this.getDocument();
      const ops: Op[] = [];

      if (selection.index > 0) {
          ops.push({ retain: selection.index });
      }

      if (selection.length > 0) {
          // Create an OpAttributes object where all known format keys are set to null
          // This signals to OpAttributeComposer.compose to remove these formats.
          const resetAttributes: OpAttributesType = {
              bold: null,
              italic: null,
              underline: null,
              // Add other clearable formats here
          };
          ops.push({ retain: selection.length, attributes: resetAttributes });
      }

      const remainingLength = currentDoc.getDelta().length() - (selection.index + selection.length);
      if (remainingLength > 0) {
          ops.push({ retain: remainingLength });
      }

      const change = new Delta(ops);
      const composedDelta = this.compose(currentDoc.getDelta(), change);
      this.currentDocument = new Document(composedDelta);

      const newSelection: DocSelection = { index: selection.index, length: selection.length };
      this.ritor.emit('document:change', this.currentDocument, newSelection);
  }

  // Basic compose function (will need to be more robust)
  // This is a simplified version of what a full Delta library provides.
  public compose(deltaA: Delta, deltaB: Delta): Delta {
     // This is a placeholder for a proper delta composition algorithm.
     // A full implementation is complex. For now, we'll do a naive merge
     // which might not be correct for all cases but will allow progress.
     // It assumes deltaB's operations are relative to the state AFTER deltaA.
     // This is more like `concat` if ops are already transformed.
     // A true compose needs to handle overlapping ops, deletes, inserts, retains with attributes.

     // For instance, Quill Delta's compose method:
     // https://github.com/quilljs/delta/blob/master/src/Delta.ts#Lcompose
     // It's a non-trivial piece of logic.

     // Temporary naive approach: just apply B's ops to the "end" of A's effective content.
     // This is not a general solution.
     const newDelta = new Delta(deltaA.ops); // Start with A

     // A very basic strategy: If B has inserts, try to place them.
     // If B has deletes or retains, they need to be relative to A's output.
     // This is where it gets complex.

     // For this subtask, we'll return a delta that attempts to naively merge.
     // This will be replaced by a robust implementation or library.

     // Example: if A = insert("Hello"), B = retain(5, {bold:true}) -> insert("Hello", {bold:true})
     // Example: if A = insert("HelloWorld"), B = delete(5) starting at index 0 -> insert("World")

     // The current methods (insertText, formatText, deleteText) construct `change` deltas
     // that are meant to be composed with the current document state.
     // So, `deltaA` is the current document, `deltaB` is the change.

     // A truly robust `compose` is beyond a quick implementation here.
     // We will use this placeholder and refine it or integrate a library.
     // For now, let's assume deltaB is already correctly transformed to apply to deltaA.
     // This means the `ops` in `deltaB` are directly applicable.

     // Let's return a new Delta that is the result of applying B to A.
     // This is still highly conceptual without the full algorithm.
     // The methods `insertText`, `formatText`, `deleteText` create `change` Delta
     // that are "ready to be composed".

     // The simplest (but often incorrect) approach if B is a "change" delta:
     let resultOps: Op[] = [];
     const aIter = new DeltaIterator(deltaA.ops);
     const bIter = new DeltaIterator(deltaB.ops);

     while(aIter.hasNext() || bIter.hasNext()) {
         if (bIter.peekType() === 'insert') {
             resultOps.push(bIter.next());
         } else if (aIter.peekType() === 'delete') {
             aIter.next(); // Skip deleted part of A
         } else if (bIter.peekType() === 'delete') {
             const opB = bIter.next(); // opB is a delete op
             let lenToDelete = opB.delete || 0;
             while(lenToDelete > 0 && aIter.hasNext() && aIter.peekType() !== 'delete') {
                 const opA = aIter.next(lenToDelete); // consume part of A
                 if(opA.retain) { // if opA was a retain
                     lenToDelete -= opA.retain;
                 } else if (opA.insert) { // if opA was an insert
                      lenToDelete -= opA.insert.length;
                      if(lenToDelete < 0) { // partially deleted insert
                         resultOps.push({ insert: opA.insert.substring(0, opA.insert.length + lenToDelete) });
                      }
                 }
             }
         } else if (aIter.hasNext() && bIter.hasNext() && aIter.peekType() === 'retain' && bIter.peekType() === 'retain') {
            const opA = aIter.peek();
            const opB = bIter.peek();

            // Explicit null checks for opA and opB
            if (opA && opB && typeof opA.retain === 'number' && typeof opB.retain === 'number') {
                const length = Math.min(opA.retain, opB.retain); // No need for || 0 if types are numbers

                const attrs = OpAttributeComposer.compose(opA.attributes, opB.attributes);
                resultOps.push({ retain: length, attributes: attrs });
                aIter.next(length);
                bIter.next(length);
            } else {
                // This case should ideally not be reached if peekType and hasNext are correct.
                // If opA or opB is null here, or not a retain op, something is wrong with iterator logic
                // or the assumption that peekType guarantees the op structure.
                // For safety, advance one of the iterators to prevent infinite loop if possible.
                if (aIter.hasNext()) aIter.next(); else if (bIter.hasNext()) bIter.next(); else break;
            }
         } else if (aIter.hasNext()) {
             const op = aIter.next();
             if (op) resultOps.push(op);
         } else if (bIter.hasNext()) {
            const op = bIter.next();
            // Only push if it's a meaningful operation to append here.
            // Typically, remaining ops in B should be inserts if A is exhausted.
            // Or if B's ops were already transformed to be applicable.
            if (op && (op.insert || (op.retain && op.attributes))) {
                 resultOps.push(op);
            }
         } else {
            break;
         }
     }
     return new Delta(resultOps);
  }
}

// Helper for iterating over ops in a Delta
// (This would be part of a full Delta library)
class DeltaIterator {
     ops: Op[];
     index: number;
     offset: number;

     constructor(ops: Op[]) {
         this.ops = ops;
         this.index = 0;
         this.offset = 0;
     }

     hasNext(): boolean {
         return this.peek() != null;
     }

     peek(): Op | null {
         if (this.index < this.ops.length) {
             return this.ops[this.index];
         }
         return null;
     }

     peekType(): string | null {
         const op = this.peek();
         if (!op) return null;
         if (op.insert) return 'insert';
         if (op.delete) return 'delete';
         if (op.retain) return 'retain';
         return null;
     }

     next(length?: number): Op {
         const currentOp = this.ops[this.index];
        // Using OpUtils.getOpLength now
        const currentOpLength = OpUtils.getOpLength(currentOp);

        // The rest of this method's logic needs to be the original, correct logic for `next`.
        // The prompt's example for `next` was simplified and potentially incorrect.
        // I will restore the original logic of `next` and only change `OpUtils.length` to `OpUtils.getOpLength`.
         if (length == null || length >= currentOpLength - this.offset) {
            const op = this.ops[this.index++]; // Consume the op
            this.offset = 0; // Reset offset for the new current op
            // If an offset was present on *this* op before fully consuming it,
            // it implies partial consumption from a previous `next(length)` call.
            // This simplified iterator doesn't perfectly handle slicing from an existing offset
            // when taking the whole remainder of an op. Assuming `length` based next calls are more common.
            // For a robust iterator, if this.offset > 0, op should be op.slice(this.offset).
            return op;
         } else {
             // Partial consumption of the current op
            this.offset += length; // Increase offset within the current op
            // Return a *part* of currentOp
            // This part of the logic remains as per the original file for creating partial ops
             if (currentOp.retain) return { retain: length, attributes: currentOp.attributes };
             if (currentOp.insert) return { insert: currentOp.insert.substring(0, length), attributes: currentOp.attributes };
            // Delete ops are typically not sliced this way by `length` in iterators,
            // but if it were, it would be: return { delete: length }
            return { retain: length }; // Fallback, assuming retain if not insert/delete
         }
     }
 }

 // Helper for Op utilities (would be part of a full Delta library)
 class OpUtils {
    // Renamed from length to getOpLength
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
                // If b[key] is explicitly undefined, it means don't apply this from b, keep a's value or absence
                // This is slightly different from typical delta compose where undefined in b means no change to a[key]
                // However, for { bold: true } composed with { italic: true }, bold should persist from 'a'.
                // The current { ...a } already handles this.
                // The main thing is if b defines a key, it takes precedence.
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
