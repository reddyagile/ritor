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
      // Selection is outside the editor
      return null;
    }

    let charCount = 0;
    let start = -1;
    let end = -1;

    const nodeIterator = document.createNodeIterator(
      editorEl,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, // Iterate over text and element nodes
      null
    );

    let currentNode: Node | null;
    let foundStartContainer = false;
    let foundEndContainer = false;

    // Helper function for recursive text length, defined inside to capture editorEl context if needed
    // or can be static if it doesn't rely on instance members.
    function getRecursiveTextLength(node: Node): number {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length || 0;
        if (node.nodeType === Node.ELEMENT_NODE) {
            // Exclude editor's direct children if they are not part of content flow or are special blocks
            // For now, assume all elements' text content contributes if they are part of the iterator's scope
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

        if (currentNode === range.startContainer && !foundStartContainer) {
          start = charCount + range.startOffset;
          foundStartContainer = true;
        }
        if (currentNode === range.endContainer && !foundEndContainer) {
          end = charCount + range.endOffset;
          foundEndContainer = true;
        }
        charCount += textLength;
      } else if (currentNode.nodeType === Node.ELEMENT_NODE) {
        // This element node itself does not add to charCount here,
        // its text node children will be visited by the iterator and handled above.
        // However, if the selection points directly to an ELEMENT_NODE, we need to handle it.
        if (currentNode === range.startContainer && !foundStartContainer) {
            start = charCount + getLengthTillChild(currentNode, range.startOffset);
            foundStartContainer = true;
        }
        if (currentNode === range.endContainer && !foundEndContainer) {
            end = charCount + getLengthTillChild(currentNode, range.endOffset);
            foundEndContainer = true;
        }
      }
    }

    if (range.collapsed) {
      if (start !== -1) end = start;
      else { start = 0; end = 0;} // Default for unusual collapsed range
    }

    if (start === -1 || end === -1) {
      if (editorEl.textContent === "" && range.startContainer === editorEl && range.endContainer === editorEl) {
          return { index: 0, length: 0 };
      }
      console.warn('Could not map DOM range to document selection accurately. Range:', range, 'Calculated:', {start,end});
      return { index: editorEl.textContent?.length || 0, length: 0 }; // Fallback to end of document
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
      NodeFilter.SHOW_TEXT,
      null
    );

    let currentNode: Node | null;

    if (targetStartIndex === 0 && targetEndIndex === 0 && editorEl.textContent === "") {
        let firstFocusableChild = editorEl.firstChild;
        // If editor is empty or only contains non-text elements like <br>, find or create a point to select.
        if (!firstFocusableChild || (firstFocusableChild.nodeType !== Node.TEXT_NODE && editorEl.childNodes.length === 1 && firstFocusableChild.nodeName === 'BR')) {
             // If only a BR, or empty, create a text node to ensure selection can be placed.
             // This is a common trick, though ideally renderer ensures selectable content.
            const textNode = document.createTextNode("");
            if (editorEl.firstChild && editorEl.firstChild.nodeName === 'BR') {
                editorEl.insertBefore(textNode, editorEl.firstChild);
            } else {
                editorEl.appendChild(textNode);
            }
            firstFocusableChild = textNode;
        }

        if (firstFocusableChild) {
            range.setStart(firstFocusableChild, 0);
            range.setEnd(firstFocusableChild, 0);
        } else { // Should be extremely rare after the above
            range.selectNodeContents(editorEl);
            range.collapse(true);
        }
        return range;
    }

    const traversalIterator = document.createNodeIterator(editorEl, NodeFilter.SHOW_TEXT, null);

    while ((currentNode = traversalIterator.nextNode()) && !foundEnd) {
      if (currentNode.nodeType === Node.TEXT_NODE) {
        const textLength = currentNode.textContent?.length || 0;
        const endCharCount = charCount + textLength;

        if (!foundStart && targetStartIndex >= charCount && targetStartIndex <= endCharCount) {
          startNode = currentNode;
          startOffset = targetStartIndex - charCount;
          foundStart = true;
        }

        if (!foundEnd && targetEndIndex >= charCount && targetEndIndex <= endCharCount) {
          endNode = currentNode;
          endOffset = targetEndIndex - charCount;
          foundEnd = true;
        }

        charCount = endCharCount;
      }
    }

    if (foundStart && !foundEnd) {
      let lastTextNode: Node | null = null;
      let totalTextLength = 0;
      const endIterator = document.createNodeIterator(editorEl, NodeFilter.SHOW_TEXT, null);
      let tempNode;
      while(tempNode = endIterator.nextNode()) {
          lastTextNode = tempNode;
          totalTextLength += tempNode.textContent?.length || 0;
      }

      if (lastTextNode) {
          endNode = lastTextNode;
          endOffset = lastTextNode.textContent?.length || 0;
          if (targetStartIndex > totalTextLength) {
            startNode = lastTextNode;
            startOffset = endOffset;
          }
      } else if (startNode == null && !editorEl.firstChild) {
          const emptyText = document.createTextNode('');
          editorEl.appendChild(emptyText);
          startNode = endNode = emptyText;
          startOffset = endOffset = 0;
      } else if (startNode == null) {
          startNode = editorEl.firstChild || editorEl;
          startOffset = 0;
          endNode = startNode;
          endOffset = 0;
          if (startNode.nodeType !== Node.TEXT_NODE && range.selectNodeContents) {
              range.selectNodeContents(startNode);
              range.collapse(true);
              return range;
          }
      }
    }

    if (!foundStart) {
        const firstTextSeeker = document.createNodeIterator(editorEl, NodeFilter.SHOW_TEXT, null);
        startNode = firstTextSeeker.nextNode();
        startOffset = 0;
        if (!startNode) {
            if (!editorEl.firstChild) editorEl.appendChild(document.createTextNode(""));
            range.selectNodeContents(editorEl);
            range.collapse(true);
            return range;
        }
    }
    if (!foundEnd) {
        endNode = startNode;
        endOffset = startOffset;
    }


    if (startNode && endNode) {
      try {
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);
        return range;
      } catch (e) {
        console.error("Error setting range:", e, {startNode, startOffset, endNode, endOffset, docSelection});
        try {
            range.selectNodeContents(editorEl);
            range.collapse(true);
        } catch (finalError) {
             console.error("Fallback range setting failed:", finalError);
             return null;
        }
        return range;
      }
    } else {
      console.warn('Could not map document selection to DOM range accurately.', docSelection);
      try {
        range.selectNodeContents(editorEl);
        range.collapse(true);
      } catch (e) {
          return null;
      }
      return range;
    }
  }


  // The old applyDelta method is removed as insertText, formatText, deleteText
  // now directly compose and set the new document state.

  public insertText(text: string, selection: DocSelection) { // selection is now DocSelection
    const currentDoc = this.getDocument();
    // currentSelection is now guaranteed to be provided by Ritor

    const ops: Op[] = [];
    let newCursorIndex = selection.index;
    let inheritedAttributes: OpAttributesType | undefined = undefined;

    if (selection.length === 0) { // Collapsed selection: inherit attributes
      // getFormatAt typically looks at char before cursor for collapsed selections
      inheritedAttributes = this.getFormatAt(selection);
      // Ensure inheritedAttributes is a clean object if it's empty,
      // or undefined if no attributes to inherit.
      if (inheritedAttributes && Object.keys(inheritedAttributes).length === 0) {
        inheritedAttributes = undefined;
      }
    }
    // If selection.length > 0 (replacing text), inheritedAttributes remains undefined,
    // so the new text will not carry explicit attributes from what it replaced,
    // unless getFormatAt was modified to return attributes of the selection being replaced.
    // For now, focus on collapsed selection style inheritance.

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

    function areAttributesSemanticallyEqual(attrs1?: OpAttributesType, attrs2?: OpAttributesType): boolean {
      const normalize = (attrs?: OpAttributesType): OpAttributesType | undefined => {
        if (!attrs) return undefined;
        const keys = Object.keys(attrs);
        if (keys.length === 0) return undefined;

        const normalized: OpAttributesType = {};
        let effectiveKeys = 0;
        for (const key of keys) {
          if (attrs[key] !== undefined && attrs[key] !== null) { // Treat null as unset too for semantic equality in merging
            normalized[key] = attrs[key];
            effectiveKeys++;
          }
        }
        return effectiveKeys > 0 ? normalized : undefined;
      };

      const normalizedAttrs1 = normalize(attrs1);
      const normalizedAttrs2 = normalize(attrs2);

      if (normalizedAttrs1 === undefined && normalizedAttrs2 === undefined) return true;
      if (normalizedAttrs1 === undefined || normalizedAttrs2 === undefined) return false; // One is undefined, the other is not

      const keys1 = Object.keys(normalizedAttrs1);
      const keys2 = Object.keys(normalizedAttrs2);

      if (keys1.length !== keys2.length) return false;

      for (const key of keys1) {
        if (normalizedAttrs1[key] !== normalizedAttrs2[key]) {
          return false;
        }
      }
      return true;
    }

    // Helper to push ops and merge if possible
    const pushOp = (newOp: Op) => {
      if (resultOps.length === 0) {
        resultOps.push(newOp);
        return;
      }

      const lastOp = resultOps[resultOps.length - 1];

      if (newOp.delete && lastOp.delete) {
        lastOp.delete += newOp.delete;
      } else if (newOp.retain && lastOp.retain &&
                 areAttributesSemanticallyEqual(newOp.attributes, lastOp.attributes)) { // Use new comparison
        lastOp.retain! += newOp.retain;
      } else if (newOp.insert && lastOp.insert &&
                 typeof newOp.insert === 'string' && typeof lastOp.insert === 'string' &&
                 areAttributesSemanticallyEqual(newOp.attributes, lastOp.attributes)) { // Use new comparison
        lastOp.insert += newOp.insert;
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

            if (currentOp.delete && lastMergedOp.delete) {
                lastMergedOp.delete += currentOp.delete;
            } else if (currentOp.insert && lastMergedOp.insert &&
                typeof currentOp.insert === 'string' && typeof lastMergedOp.insert === 'string' &&
                areAttributesSemanticallyEqual(currentOp.attributes, lastMergedOp.attributes)) { // Use new comparison
                lastMergedOp.insert += currentOp.insert;
            } else if (currentOp.retain && lastMergedOp.retain &&
                       areAttributesSemanticallyEqual(currentOp.attributes, lastMergedOp.attributes)) { // Use new comparison for retains
                lastMergedOp.retain! += currentOp.retain;
            }
            // ... (other types of ops if necessary for merging, e.g. deletes)
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
