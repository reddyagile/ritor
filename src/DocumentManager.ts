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

  public formatText(attributes: OpAttributesType, selection: DocSelection) {
    const currentDoc = this.getDocument();
    const ops: Op[] = [];

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

    const newSelection: DocSelection = { index: selection.index, length: selection.length };
    this.ritor.emit('document:change', this.currentDocument, newSelection);
  }

  public deleteText(selection: DocSelection) {
    const currentDoc = this.getDocument();
    const ops: Op[] = [];
    let newCursorIndex = selection.index;

    if (selection.index > 0) {
      ops.push({ retain: selection.index });
    }
    if (selection.length > 0) {
      ops.push({ delete: selection.length });
    }

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

  public getFormatAt(selection: DocSelection): OpAttributesType {
    const docDelta = this.currentDocument.getDelta();
    if (!docDelta || !docDelta.ops) return {};

    let index = selection.index;
    if (selection.length > 0) {
    } else {
      if (index > 0) index -=1;
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
        const opLength = op.retain;
          if (index >= currentPosition && index < currentPosition + opLength) {
          return op.attributes || {};
        }
        currentPosition += opLength;
      }
    }
    return {};
  }

  public clearFormat(selection: DocSelection): void {
      const currentDoc = this.getDocument();
      const ops: Op[] = [];

      if (selection.index > 0) {
          ops.push({ retain: selection.index });
      }

      if (selection.length > 0) {
          const resetAttributes: OpAttributesType = {
              bold: null,
              italic: null,
              underline: null,
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

  public compose(deltaA: Delta, deltaB: Delta): Delta {
    const opsA = deltaA.ops;
    const opsB = deltaB.ops;
    const resultOps: Op[] = [];
    const iterA = new DeltaIterator(opsA);
    const iterB = new DeltaIterator(opsB);

    // Helper to push ops and merge if possible
    const pushOp = (newOp: Op) => {
      if (resultOps.length === 0) {
        resultOps.push(newOp);
        return;
      }

      const lastOp = resultOps[resultOps.length - 1];

      if (newOp.delete && lastOp.delete) { // Merge deletes
        lastOp.delete += newOp.delete;
      } else if (newOp.retain && lastOp.retain && OpAttributeComposer.compose(newOp.attributes, lastOp.attributes) === OpAttributeComposer.compose(lastOp.attributes, newOp.attributes) && OpAttributeComposer.compose(newOp.attributes, lastOp.attributes) === newOp.attributes ) { // Merge retains with same attributes
         // This attribute check is to ensure they are truly identical for merging.
         // A simpler check is if both are undefined or deep equal.
         // For now, if attributes are the same (or both undefined), merge.
         const newAttrs = newOp.attributes;
         const lastAttrs = lastOp.attributes;
         if ( (newAttrs === undefined && lastAttrs === undefined) ||
              (newAttrs && lastAttrs && JSON.stringify(newAttrs) === JSON.stringify(lastAttrs)) ) {
            lastOp.retain! += newOp.retain;
         } else {
            resultOps.push(newOp);
         }

      } else if (newOp.insert && lastOp.insert && typeof newOp.insert === 'string' && typeof lastOp.insert === 'string') {
        const newAttrs = newOp.attributes;
        const lastAttrs = lastOp.attributes;
        // Merge inserts if attributes are the same
        if ( (newAttrs === undefined && lastAttrs === undefined) ||
             (newAttrs && lastAttrs && JSON.stringify(newAttrs) === JSON.stringify(lastAttrs)) ) {
          lastOp.insert += newOp.insert;
        } else {
          resultOps.push(newOp);
        }
      } else {
        resultOps.push(newOp);
      }
    };

    while (iterA.hasNext() || iterB.hasNext()) {
      const opA = iterA.peek();
      const opB = iterB.peek();
      const typeA = iterA.peekType(); // Storing peek results to avoid repeated calls
      const typeB = iterB.peekType();


      if (typeB === 'insert') { // Insert operations from deltaB take precedence
        pushOp(iterB.next());
      } else if (opA && opA.delete) { // Deletes from deltaA are processed first
        pushOp(iterA.next());
      } else if (opB && opB.delete) { // Deletes from deltaB
        let length = opB.delete!;
        while (length > 0 && iterA.hasNext()) {
          const nextA = iterA.peek()!;
          const nextALength = OpUtils.getOpLength(nextA);
          const deleteLength = Math.min(length, nextALength);

          // If deleting retained content or inserted content, just consume from A
          iterA.next(deleteLength);
          length -= deleteLength;
        }
        iterB.next(); // Consume the delete op from B
      } else if (typeA === 'retain' && typeB === 'retain') { // Both are retain
        if (!opA || !opB || typeof opA.retain !== 'number' || typeof opB.retain !== 'number') { // Guard against invalid ops
             if (iterA.hasNext()) iterA.next(); else if (iterB.hasNext()) iterB.next(); else break;
             continue;
        }
        const attributes = OpAttributeComposer.compose(opA.attributes, opB.attributes, true); // keepNull = true for intermediate step
        const length = Math.min(opA.retain, opB.retain);
        if (length > 0) pushOp({ retain: length, attributes }); // Ensure positive length
        iterA.next(length);
        iterB.next(length);
      } else if (typeA === 'insert' && typeB === 'retain') { // A is insert, B is retain (format application)
        if (!opA || !opB || typeof opA.insert !== 'string' || typeof opB.retain !== 'number') { // Guard
            if (iterA.hasNext()) iterA.next(); else if (iterB.hasNext()) iterB.next(); else break;
            continue;
        }
        const attributes = OpAttributeComposer.compose(opA.attributes, opB.attributes, true);
        const length = Math.min(OpUtils.getOpLength(opA), OpUtils.getOpLength(opB));

        if (length > 0) {
            // iterA.next(length) will return an op representing the segment of opA of 'length'
            // This assumes iterA.next correctly handles partial consumption and internal offset.
            const opAWithValue = iterA.next(length);
            if(opAWithValue && opAWithValue.insert) { // Ensure opAWithValue is valid and has insert
                 pushOp({ insert: opAWithValue.insert, attributes });
            }
            iterB.next(length); // Consume from B
        } else { // length is 0, advance one to prevent infinite loop
            if (OpUtils.getOpLength(opB) === 0) iterB.next();
            else if (OpUtils.getOpLength(opA) === 0) iterA.next();
            else { iterA.next(); iterB.next(); } // Should not happen if length is 0 and ops have length
        }

      } else if (opA) { // If B is exhausted or opB is not a priority op
        pushOp(iterA.next());
      } else if (opB) { // If A is exhausted
        pushOp(iterB.next());
      } else {
        break; // Should not happen
      }
    }

    const finalOps: Op[] = [];
    resultOps.forEach(op => {
        if (op.attributes && Object.keys(op.attributes).length === 0) {
            delete op.attributes;
        }
        if (op.attributes) {
            for (const key in op.attributes) {
                if (op.attributes[key] === null) {
                    delete op.attributes[key];
                }
            }
            if (Object.keys(op.attributes).length === 0) {
                delete op.attributes;
            }
        }
        // Ensure ops are valid before pushing (e.g. retain/delete must have positive length)
        if (op.delete && op.delete <=0) return;
        if (op.retain && op.retain <=0) return;
        if (op.insert === "") return; // Don't push empty inserts unless it's the only op for a newline

        finalOps.push(op);
    });

    const mergedFinalOps: Op[] = [];
    if (finalOps.length > 0) {
        mergedFinalOps.push({...finalOps[0]}); // Push a clone to avoid modifying original from finalOps
        for (let i = 1; i < finalOps.length; i++) {
            const currentOp = {...finalOps[i]}; // Clone current op
            const lastMergedOp = mergedFinalOps[mergedFinalOps.length - 1];

            if (currentOp.delete && lastMergedOp.delete) { // Merge deletes
                lastMergedOp.delete += currentOp.delete;
            } else if (currentOp.insert && lastMergedOp.insert && typeof currentOp.insert === 'string' && typeof lastMergedOp.insert === 'string') {
                const currentAttrs = currentOp.attributes;
                const lastAttrs = lastMergedOp.attributes;
                if ( (currentAttrs === undefined && lastAttrs === undefined) ||
                     (currentAttrs && lastAttrs && JSON.stringify(currentAttrs) === JSON.stringify(lastAttrs)) ) {
                    lastMergedOp.insert += currentOp.insert;
                } else {
                    mergedFinalOps.push(currentOp);
                }
            } else if (currentOp.retain && lastMergedOp.retain ) {
                 const currentAttrs = currentOp.attributes;
                 const lastAttrs = lastMergedOp.attributes;
                 if ( (currentAttrs === undefined && lastAttrs === undefined) ||
                     (currentAttrs && lastAttrs && JSON.stringify(currentAttrs) === JSON.stringify(lastAttrs)) ) {
                    lastMergedOp.retain += currentOp.retain;
                 } else {
                    mergedFinalOps.push(currentOp);
                 }
            }
            else {
                mergedFinalOps.push(currentOp);
            }
        }
    }

    return new Delta(mergedFinalOps);
  }
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
