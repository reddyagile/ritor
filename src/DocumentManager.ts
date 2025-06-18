// src/DocumentManager.ts
import Cursor from './Cursor';
import Ritor from './Ritor';
import { Document, Delta, Op, OpAttributes as OpAttributesType } from './Document';

export interface DocSelection {
  index: number;
  length: number;
}

// Helper classes are defined first, as they might be used by DocumentManager methods.
// These are assumed to be part of the same file scope for DocumentManager.

class OpUtils {
  static getOpLength(op: Op): number {
    if (typeof op.delete === 'number') return op.delete;
    if (typeof op.retain === 'number') return op.retain;
    if (typeof op.insert === 'string') return op.insert.length;
    // For ops that aren't insert/delete/retain or are invalid
    if (op.insert === undefined && op.delete === undefined && op.retain === undefined) return 0;
    // If it's an op like { attributes: { bold: true } } (retain 0 implicitly)
    // This case should ideally not happen with well-formed Deltas where retains specify length.
    // For safety in getOpLength, if it's not a known op type with length, return 0.
    return 0;
  }
}

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
    // Corrected: Ensure current op exists before trying to get its length
    if (this.index < this.ops.length) {
        const currentOp = this.ops[this.index];
        // Check if current op is valid and has length before using OpUtils.getOpLength
        if (currentOp && (currentOp.insert !== undefined || currentOp.retain !== undefined || currentOp.delete !== undefined)) {
             // If current op has an actual length, check offset against it
            const len = OpUtils.getOpLength(currentOp);
            if (len > 0) return this.offset < len;
            // If current op has zero length (e.g. insert:""), but we are at it (offset 0), it's "consumable" by next()
            // then hasNext should be true if there are more ops *after* this one.
            // Or, if it's the last op and zero-length, hasNext should be false.
            if (this.offset === 0 && len === 0) { // At a zero-length op
                return true; // It can be "consumed" by next()
            }
        }
        // If current op is invalid or zero-length and fully "consumed" (offset > 0 or offset === 0 and len === 0)
        // then check if there's a next op in the array.
        if (this.index < this.ops.length -1) {
            return true;
        }
    }
    return false; // Default if all conditions fail
  }


  peek(): Op | null {
    if (!this.hasNext()) return null; // Use hasNext to determine if peeking is valid
    const currentOp = this.ops[this.index];

    // If hasNext is true, currentOp should be valid.
    // Handle offset for partial peeking
    if (this.offset > 0) {
      if (currentOp.insert !== undefined) {
        return { insert: currentOp.insert.substring(this.offset), attributes: currentOp.attributes };
      } else if (currentOp.retain !== undefined) {
        return { retain: currentOp.retain - this.offset, attributes: currentOp.attributes };
      } else if (currentOp.delete !== undefined) {
        return { delete: currentOp.delete - this.offset };
      }
    }
    return currentOp; // Return full current op if offset is 0
  }

  peekType(): string | null {
    const op = this.peek();
    if (!op) return null;
    if (op.insert !== undefined) return 'insert';
    if (op.delete !== undefined) return 'delete';
    if (op.retain !== undefined) return 'retain';
    return null;
  }

  next(length?: number): Op {
    if (!this.hasNext()) return {};

    const currentOp = this.ops[this.index];
    const currentOpFullLength = OpUtils.getOpLength(currentOp);
    const currentOpEffectiveLength = currentOpFullLength - this.offset;

    let opToReturn: Op;
    const consumeLength = length == null ? currentOpEffectiveLength : Math.min(length, currentOpEffectiveLength);

    if (consumeLength < 0) { // Should not happen with positive lengths and correct logic
        this.index++; this.offset = 0; return {}; // Error or skip
    }
    // If current op is zero-length (e.g. insert:"") and consumeLength is also 0
    if (consumeLength === 0 && currentOpEffectiveLength === 0) {
        opToReturn = { ...currentOp }; // Return the zero-length op (e.g. insert:"", attributes:{...})
        this.index++;
        this.offset = 0;
        return opToReturn;
    }


    if (currentOp.insert !== undefined) {
      opToReturn = {
        insert: currentOp.insert.substring(this.offset, this.offset + consumeLength),
        attributes: currentOp.attributes
      };
    } else if (currentOp.retain !== undefined) {
      opToReturn = {
        retain: consumeLength,
        attributes: currentOp.attributes
      };
    } else if (currentOp.delete !== undefined) {
      opToReturn = { delete: consumeLength };
    } else {
      opToReturn = {};
    }

    this.offset += consumeLength;
    if (this.offset >= currentOpFullLength) { // Use full length for advancing index
      this.index++;
      this.offset = 0;
    }
    return opToReturn;
  }
}

class OpAttributeComposer {
  static compose(a?: OpAttributesType, b?: OpAttributesType, keepNull: boolean = false): OpAttributesType | undefined {
    if (typeof a !== 'object' && a !== undefined) a = {};
    if (typeof b !== 'object' && b !== undefined) b = {};

    a = a || {};
    b = b || {};

    let attributes: OpAttributesType = { ...a };
    for (const key in b) {
      if (b.hasOwnProperty(key)) {
        attributes[key] = b[key];
      }
    }
    if (!keepNull) {
      for (const key in attributes) {
        if (attributes.hasOwnProperty(key) && attributes[key] === null) {
          delete attributes[key];
        }
      }
    }
    return Object.keys(attributes).length > 0 ? attributes : undefined;
  }
}

class DocumentManager {
  public cursor: Cursor;
  public ritor: Ritor;
  private currentDocument: Document;
  public commandState: Map<string, boolean> = new Map();

  constructor(ritor: Ritor, initialDelta?: Delta) {
    this.ritor = ritor;
    this.cursor = new Cursor();
    this.currentDocument = new Document(initialDelta || new Delta().push({ insert: '\n' }));
  }

  public getDocument(): Document {
    return this.currentDocument;
  }

  private getRecursiveTextLengthForDom(node: Node): number {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length || 0;
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.nodeName.toUpperCase() === 'BR') return 1;
      let len = 0;
      node.childNodes.forEach(child => len += this.getRecursiveTextLengthForDom(child)); // Use this. for class context
      return len;
    }
    return 0;
  }

  private getLengthTillChildForDom(parentElement: Node, childOffset: number): number {
    let length = 0;
    for (let i = 0; i < childOffset; i++) {
      if (parentElement.childNodes[i]) {
        length += this.getRecursiveTextLengthForDom(parentElement.childNodes[i]);
      }
    }
    return length;
  }

  public domRangeToDocSelection(range: Range): DocSelection | null {
    const editorEl = this.ritor.$el;
    if (!editorEl.contains(range.startContainer) || !editorEl.contains(range.endContainer)) {
      return null;
    }
    let charCount = 0;
    let start = -1;
    let end = -1;
    const nodeIterator = document.createNodeIterator(editorEl, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null);
    let currentNode: Node | null;
    let foundStartContainer = false;
    let foundEndContainer = false;

    while ((currentNode = nodeIterator.nextNode()) && (!foundEndContainer || end === -1)) {
      if (currentNode.nodeType === Node.TEXT_NODE) {
        const textLength = currentNode.textContent?.length || 0;
        if (!foundStartContainer && currentNode === range.startContainer) {
          start = charCount + range.startOffset;
          foundStartContainer = true;
        }
        if (!foundEndContainer && currentNode === range.endContainer) {
          end = charCount + range.endOffset;
          foundEndContainer = true;
        }
        charCount += textLength;
      } else if (currentNode.nodeType === Node.ELEMENT_NODE) {
        if (currentNode.nodeName.toUpperCase() === 'BR') {
          if (!foundStartContainer && range.startContainer === currentNode) {
            start = charCount + range.startOffset;
            foundStartContainer = true;
          }
          if (!foundEndContainer && range.endContainer === currentNode) {
            end = charCount + range.endOffset;
            foundEndContainer = true;
          }
          charCount += 1;
        } else {
          if (!foundStartContainer && currentNode === range.startContainer) {
            start = charCount + this.getLengthTillChildForDom(currentNode, range.startOffset);
            foundStartContainer = true;
          }
          if (!foundEndContainer && currentNode === range.endContainer) {
            end = charCount + this.getLengthTillChildForDom(currentNode, range.endOffset);
            foundEndContainer = true;
          }
        }
      }
    }
    if (range.collapsed) {
      if (start !== -1) { end = start; }
      else {
        const totalDocLength = this.getRecursiveTextLengthForDom(editorEl);
        if (range.startContainer === editorEl && range.startOffset === 0) { start = 0; end = 0; }
        else { start = totalDocLength; end = totalDocLength; }
      }
    }
    if (end !== -1 && start !== -1 && end < start) { end = start; }
    if (start === -1 || end === -1) {
      const currentTotalLength = this.getRecursiveTextLengthForDom(editorEl);
      if (editorEl.childNodes.length === 0 && range.startContainer === editorEl && range.endContainer === editorEl) {
        return { index: 0, length: 0 };
      }
      if (start !== -1 && end === -1) {
        end = currentTotalLength;
        if (start > end) start = end;
        return { index: start, length: Math.max(0, end - start) };
      }
      console.warn('Could not map DOM range to document selection accurately. Range:', range, 'Calculated:', { start, end }, 'TotalLen:', currentTotalLength);
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
    const nodeIterator = document.createNodeIterator(editorEl, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null);
    let currentNode: Node | null;

    if (targetStartIndex === 0 && targetEndIndex === 0) {
        let isEmptyIsh = true;
        let firstChildNodeForSelection: Node | null = null;
        const tempIter = document.createNodeIterator(editorEl, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null);
        let tempNode;
        while(tempNode = tempIter.nextNode()){
            if(tempNode.nodeType === Node.TEXT_NODE && tempNode.textContent !== ""){
                isEmptyIsh = false; firstChildNodeForSelection = tempNode; break;
            } else if(tempNode.nodeName === "BR"){
                isEmptyIsh = false; firstChildNodeForSelection = tempNode; break;
            } else if(tempNode.nodeType === Node.ELEMENT_NODE && tempNode.childNodes.length > 0 && this.getRecursiveTextLengthForDom(tempNode) > 0){
                 isEmptyIsh = false;
                 const innerIter = document.createNodeIterator(tempNode, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null);
                 let innerNode;
                 while(innerNode = innerIter.nextNode()){
                     if(innerNode.nodeType === Node.TEXT_NODE || innerNode.nodeName === 'BR'){
                         firstChildNodeForSelection = innerNode;
                         break;
                     }
                 }
                 if(firstChildNodeForSelection) break;
            }
            if(!firstChildNodeForSelection && tempNode.nodeType === Node.ELEMENT_NODE) firstChildNodeForSelection = tempNode;
        }

        if (isEmptyIsh || !firstChildNodeForSelection) {
            if (!editorEl.firstChild || editorEl.childNodes.length === 0) {
                const tempText = document.createTextNode(''); editorEl.appendChild(tempText); firstChildNodeForSelection = tempText;
            } else {
                 firstChildNodeForSelection = editorEl;
            }
        }

        try {
            if (firstChildNodeForSelection!.nodeType === Node.TEXT_NODE) { range.setStart(firstChildNodeForSelection!, 0); }
            else if (firstChildNodeForSelection!.nodeName === 'BR') { range.setStartBefore(firstChildNodeForSelection!); }
            else { range.selectNodeContents(firstChildNodeForSelection!); range.collapse(true); }
            range.collapse(true); return range;
        } catch (e) { console.warn("Error setting range on empty/boundary editor:", e); /* fall through */ }
    }

    while ((currentNode = nodeIterator.nextNode()) && (!foundEnd || (docSelection.length === 0 && !foundStart) )) {
      let nodeLength = 0;
      if (currentNode.nodeType === Node.TEXT_NODE) {
        nodeLength = currentNode.textContent?.length || 0;
      } else if (currentNode.nodeType === Node.ELEMENT_NODE && currentNode.nodeName.toUpperCase() === 'BR') {
        nodeLength = 1;
      }
      if (nodeLength === 0 && currentNode.nodeType !== Node.ELEMENT_NODE) continue;

      const endCharCountAfterThisNode = charCount + nodeLength;
      if (!foundStart && targetStartIndex >= charCount && targetStartIndex <= endCharCountAfterThisNode) {
        startNode = currentNode;
        startOffset = targetStartIndex - charCount;
        if (startNode.nodeName === 'BR' && startOffset > 0) startOffset = 1;
        foundStart = true;
        if (docSelection.length === 0) { endNode = startNode; endOffset = startOffset; foundEnd = true; }
      }
      if (docSelection.length > 0 && !foundEnd && targetEndIndex >= charCount && targetEndIndex <= endCharCountAfterThisNode) {
        endNode = currentNode;
        endOffset = targetEndIndex - charCount;
        if (endNode.nodeName === 'BR' && endOffset > 0) endOffset = 1;
        foundEnd = true;
      }
      if (nodeLength > 0) charCount = endCharCountAfterThisNode;
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
                lastNode = tempCurrentNode;
                lastNodeLength = 0;
            }
        }
        if (lastNode) {
            endNode = lastNode;
            endOffset = (lastNode.nodeType === Node.TEXT_NODE) ? lastNodeLength : (lastNode.nodeName === 'BR' ? 1: 0) ;
        } else {
            endNode = startNode;
            endOffset = startOffset;
        }
    }

    if (startNode && endNode) {
      try {
        if (startNode.nodeName === 'BR') {
            const parent = startNode.parentNode;
            const offset = Array.from(parent?.childNodes || []).indexOf(startNode as ChildNode);
            if (parent && offset !== -1) { range.setStart(parent, startOffset === 0 ? offset : offset + 1); }
            else { range.setStart(startNode, 0); }
        } else { range.setStart(startNode, startOffset); }

        if (endNode.nodeName === 'BR') {
            const parent = endNode.parentNode;
            const offset = Array.from(parent?.childNodes || []).indexOf(endNode as ChildNode);
            if (parent && offset !== -1) { range.setEnd(parent, endOffset === 0 ? offset : offset + 1); }
            else { range.setEnd(endNode, 0); }
        } else { range.setEnd(endNode, endOffset); }

        return range;
      } catch (e) { console.error("Error setting range:", e, {startNode, startOffset, endNode, endOffset, docSelection}); }
    }
    console.warn('Could not map document selection to DOM range accurately (final fallback).', docSelection);
    try { range.selectNodeContents(editorEl); range.collapse(true); } catch (e) { return null; }
    return range;
  }

  public insertText(text: string, selection: DocSelection) {
    const currentDoc = this.getDocument();
    const ops: Op[] = [];
    let newCursorIndex = selection.index;
    let inheritedAttributes: OpAttributesType | undefined = undefined;
    if (selection.length === 0) {
      inheritedAttributes = this.getFormatAt(selection);
      if (inheritedAttributes && Object.keys(inheritedAttributes).length === 0) {
        inheritedAttributes = undefined;
      }
    }
    if (selection.index > 0) { ops.push({ retain: selection.index }); }
    if (selection.length > 0) { ops.push({ delete: selection.length }); }
    if (inheritedAttributes) { ops.push({ insert: text, attributes: inheritedAttributes }); }
    else { ops.push({ insert: text }); }
    newCursorIndex = selection.index + text.length;
    const docLength = currentDoc.getDelta().length();
    const originalSegmentEndIndex = selection.index + selection.length;
    if (docLength > originalSegmentEndIndex) {
      ops.push({ retain: docLength - originalSegmentEndIndex });
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
    if (selection.index > 0) { ops.push({ retain: selection.index }); }
    if (selection.length > 0) { ops.push({ retain: selection.length, attributes: attributes }); }
    const docLength = currentDoc.getDelta().length();
    const originalSegmentEndIndex = selection.index + selection.length;
    if (docLength > originalSegmentEndIndex) {
      ops.push({ retain: docLength - originalSegmentEndIndex });
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
    if (selection.index > 0) { ops.push({ retain: selection.index }); }
    if (selection.length > 0) { ops.push({ delete: selection.length }); }
    const docLength = currentDoc.getDelta().length();
    const originalSegmentEndIndex = selection.index + selection.length;
    if (docLength > originalSegmentEndIndex) {
      ops.push({ retain: docLength - originalSegmentEndIndex });
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
    if (selection.length === 0 && index > 0) { // For collapsed selection, look at char before
      index -= 1;
    } else if (selection.length > 0) {
      // For a range, typically get attributes at the start of the range.
      // Or, could be more complex to find common attributes. For now, start.
    }
    let currentPosition = 0;
    for (const op of docDelta.ops) {
      let opLength = OpUtils.getOpLength(op); // Use OpUtils.getOpLength

      if (index >= currentPosition && index < currentPosition + opLength) {
        return op.attributes || {};
      }
      if (opLength > 0) currentPosition += opLength; // Only advance if op has length
    }
    return {};
  }

  public clearFormat(selection: DocSelection): void {
    const currentDoc = this.getDocument();
    const ops: Op[] = [];
    if (selection.index > 0) { ops.push({ retain: selection.index }); }
    if (selection.length > 0) {
      const resetAttributes: OpAttributesType = { bold: null, italic: null, underline: null };
      ops.push({ retain: selection.length, attributes: resetAttributes });
    }
    const docLength = currentDoc.getDelta().length();
    const originalSegmentEndIndex = selection.index + selection.length;
    if (docLength > originalSegmentEndIndex) {
      ops.push({ retain: docLength - originalSegmentEndIndex });
    }
    const change = new Delta(ops);
    const composedDelta = this.compose(currentDoc.getDelta(), change);
    this.currentDocument = new Document(composedDelta);
    const newSelection: DocSelection = { index: selection.index, length: selection.length };
    this.ritor.emit('document:change', this.currentDocument, newSelection);
  }

  public compose(deltaA: Delta, deltaB: Delta): Delta {
    const iterA = new DeltaIterator(deltaA.ops);
    const iterB = new DeltaIterator(deltaB.ops);
    const resultOps: Op[] = [];

    function areAttributesSemanticallyEqual(attrs1?: OpAttributesType, attrs2?: OpAttributesType): boolean {
      const normalize = (attrs?: OpAttributesType): OpAttributesType | undefined => {
        if (!attrs) return undefined;
        const keys = Object.keys(attrs);
        if (keys.length === 0) return undefined;
        const normalized: OpAttributesType = {};
        let effectiveKeys = 0;
        for (const key of keys) {
          if (attrs[key] !== undefined && attrs[key] !== null) {
            normalized[key] = attrs[key];
            effectiveKeys++;
          }
        }
        return effectiveKeys > 0 ? normalized : undefined;
      };
      const normalizedAttrs1 = normalize(attrs1);
      const normalizedAttrs2 = normalize(attrs2);
      if (normalizedAttrs1 === undefined && normalizedAttrs2 === undefined) return true;
      if (normalizedAttrs1 === undefined || normalizedAttrs2 === undefined) return false;
      const keys1 = Object.keys(normalizedAttrs1);
      const keys2 = Object.keys(normalizedAttrs2);
      if (keys1.length !== keys2.length) return false;
      for (const key of keys1) {
        if (normalizedAttrs1[key] !== normalizedAttrs2[key]) return false;
      }
      return true;
    }

    const pushOp = (newOp: Op) => {
      // Skip ops that do nothing (retain 0, delete 0, or insert "" with no attributes)
      if ( (newOp.retain && newOp.retain <= 0 && !newOp.attributes) ||
           (newOp.delete && newOp.delete <= 0) ||
           (newOp.insert === "" && !newOp.attributes) ) {
        return;
      }

      if (resultOps.length === 0) {
        resultOps.push(newOp);
        return;
      }
      const lastOp = resultOps[resultOps.length - 1];
      if (newOp.delete && lastOp.delete) {
        lastOp.delete += newOp.delete;
      } else if (newOp.retain && lastOp.retain && areAttributesSemanticallyEqual(newOp.attributes, lastOp.attributes)) {
        lastOp.retain += newOp.retain;
      } else if (newOp.insert && lastOp.insert && typeof newOp.insert === 'string' && typeof lastOp.insert === 'string' && areAttributesSemanticallyEqual(newOp.attributes, lastOp.attributes)) {
        lastOp.insert += newOp.insert;
      } else {
        resultOps.push(newOp);
      }
    };

    while (iterA.hasNext() || iterB.hasNext()) {
      const opA = iterA.peek();
      const opB = iterB.peek();
      const typeA = iterA.peekType();
      const typeB = iterB.peekType();

      if (typeB === 'insert') {
        pushOp(iterB.next());
      } else if (typeA === 'delete') {
        pushOp(iterA.next());
      } else if (typeB === 'delete') {
        const bOpDelete = iterB.next();
        if (bOpDelete && bOpDelete.delete) {
            let length = bOpDelete.delete;
            while (length > 0 && iterA.hasNext()) {
                const nextA = iterA.peek();
                if (!nextA) break;
                const nextALength = OpUtils.getOpLength(nextA);
                const consumeLength = Math.min(length, nextALength);
                if (nextA.retain && consumeLength > 0) { // Only delete if it's a retain op from A
                    iterA.next(consumeLength);
                } else if (nextA.insert && consumeLength > 0) { // Or if it's an insert op from A
                    iterA.next(consumeLength);
                } else if (consumeLength === 0 && nextALength === 0) { // Skip zero-length ops in A
                    iterA.next();
                    continue;
                } else {
                    // Cannot delete from this op type, or consumeLength is 0 but op has length
                    // This implies iterA should not be consumed here by a delete from B.
                    // This path should ideally not be taken if deltaB is well-formed against deltaA.
                    // If iterA.peek() is not retain or insert, a delete op from B can't apply to it.
                    // However, the `length` of delete op from B still needs to be satisfied.
                    // This usually means deltaB is malformed or deltaA is not what B expects.
                    // For robustness, we might skip consuming A here if it's not consumable by delete.
                    // But the delete length from B still needs to be "accounted for".
                    // This is where true op transformation logic gets complex.
                    // For now, if A's op is not insert/retain, the delete from B effectively skips it.
                    // This means `length` doesn't decrease, and we might infinite loop if iterA doesn't advance.
                    // Let's assume for this simplified compose that deletes in B only apply to retain/insert in A.
                    // If iterA.peek() is a delete, this delete op from B is relative to A *after* A's delete.
                    // So we must advance A.
                    if(typeA === 'delete') { // A also has a delete, let A's delete go first
                        pushOp(iterA.next());
                        // length for B's delete is not reduced here, it will be processed against next op of A
                    } else {
                        // If A's op is not retain or insert, B's delete op can't apply to it.
                        // This is a mismatch. For this simplified compose, we'll assume B's delete
                        // is "lost" against this non-deletable op from A. Or, advance A.
                        // To be safe and avoid infinite loops if B's delete length never reduces:
                        if (nextALength > 0) iterA.next(consumeLength); else iterA.next();
                    }
                }
                length -= consumeLength;
            }
        }
      } else if (typeA === 'retain' && typeB === 'retain') {
        if (!opA || !opB || typeof opA.retain !== 'number' || typeof opB.retain !== 'number') {
          if (iterA.hasNext()) iterA.next(); else if (iterB.hasNext()) iterB.next(); else break; continue;
        }
        const attributes = OpAttributeComposer.compose(opA.attributes, opB.attributes, true);
        const length = Math.min(opA.retain, opB.retain);
        if (length > 0) pushOp({ retain: length, attributes });
        iterA.next(length);
        iterB.next(length);
      } else if (typeA === 'insert' && typeB === 'retain') {
        if (!opA || !opB || typeof opA.insert !== 'string' || typeof opB.retain !== 'number') {
          if (iterA.hasNext()) iterA.next(); else if (iterB.hasNext()) iterB.next(); else break; continue;
        }
        const attributes = OpAttributeComposer.compose(opA.attributes, opB.attributes, true);
        const length = Math.min(OpUtils.getOpLength(opA), opB.retain);
        if (length > 0) {
          const opAWithValue = iterA.next(length);
          if (opAWithValue && opAWithValue.insert !== undefined) {
            pushOp({ insert: opAWithValue.insert, attributes });
          }
        }
        iterB.next(length);
      } else if (opA) {
        pushOp(iterA.next());
      } else if (opB) {
        pushOp(iterB.next());
      } else {
        break;
      }
    }

    const finalOpsProcessing: Op[] = [];
    resultOps.forEach(op => {
      let processedOp = { ...op };
      if (processedOp.attributes) {
        for (const key in processedOp.attributes) {
          if (processedOp.attributes[key] === null) {
            delete processedOp.attributes[key];
          }
        }
        if (Object.keys(processedOp.attributes).length === 0) {
          delete processedOp.attributes;
        }
      }
      if (processedOp.delete && processedOp.delete <= 0) return;
      if (processedOp.retain && processedOp.retain <= 0 && !processedOp.attributes) return;
      if (processedOp.insert === "" && !processedOp.attributes && !(resultOps.length === 1 && processedOp.insert === "
")) return;

      finalOpsProcessing.push(processedOp);
    });

    const mergedFinalOps: Op[] = [];
    if (finalOpsProcessing.length > 0) {
      mergedFinalOps.push({ ...finalOpsProcessing[0] });
      for (let i = 1; i < finalOpsProcessing.length; i++) {
        const currentOp = { ...finalOpsProcessing[i] };
        const lastMergedOp = mergedFinalOps[mergedFinalOps.length - 1];
        if (currentOp.delete && lastMergedOp.delete) {
          lastMergedOp.delete += currentOp.delete;
        } else if (currentOp.insert && lastMergedOp.insert && typeof currentOp.insert === 'string' && typeof lastMergedOp.insert === 'string' && areAttributesSemanticallyEqual(currentOp.attributes, lastMergedOp.attributes)) {
          lastMergedOp.insert += currentOp.insert;
        } else if (currentOp.retain && lastMergedOp.retain && areAttributesSemanticallyEqual(currentOp.attributes, lastMergedOp.attributes)) {
          lastMergedOp.retain += currentOp.retain;
        } else {
          mergedFinalOps.push(currentOp);
        }
      }
    }
    return new Delta(mergedFinalOps);
  }
}
export default DocumentManager;
