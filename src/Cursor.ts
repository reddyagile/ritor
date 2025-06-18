// src/Cursor.ts
import Ritor from './Ritor'; // Import Ritor to get a reference to $el
import { DocSelection } from './types'; // Import from types.ts

class Cursor {
  private ritor: Ritor; // Reference to Ritor instance
  private selection: Selection | null = null; // Browser Selection object

  constructor(ritor: Ritor) {
    this.ritor = ritor;
    // Initial refreshSelection can be done here or lazily
    this.refreshSelection();
  }

  // --- Start of methods moved and adapted from DocumentManager ---

  private getRecursiveTextLengthForDom(node: Node): number {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length || 0;
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.nodeName.toUpperCase() === 'BR') return 1;
      let len = 0;
      node.childNodes.forEach(child => len += this.getRecursiveTextLengthForDom(child));
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

    if (targetStartIndex === 0 && targetEndIndex === 0) {
        let focusNode: Node | null = editorEl.firstChild;
        // let isEmpty = !focusNode; // This variable is not used

        if (focusNode && editorEl.childNodes.length === 1 && focusNode.nodeName === 'BR') {
            range.setStartBefore(focusNode); range.collapse(true); return range;
        } else if (!focusNode || (focusNode.nodeType !== Node.TEXT_NODE && focusNode.nodeName !== 'BR')) {
            const tempText = document.createTextNode('');
            if (focusNode) { editorEl.insertBefore(tempText, focusNode); }
            else { editorEl.appendChild(tempText); }
            focusNode = tempText;
            range.setStart(focusNode, 0); range.collapse(true); return range;
        }
    }

    const nodeIterator = document.createNodeIterator(editorEl, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null);
    let currentNode: Node | null;

    while ((currentNode = nodeIterator.nextNode())) {
      let nodeLength = 0;
      if (currentNode.nodeType === Node.TEXT_NODE) {
        nodeLength = currentNode.textContent?.length || 0;
      } else if (currentNode.nodeType === Node.ELEMENT_NODE && currentNode.nodeName.toUpperCase() === 'BR') {
        nodeLength = 1;
      } else { continue; }

      const endCharCountAfterThisNode = charCount + nodeLength;
      if (!foundStart && targetStartIndex >= charCount && targetStartIndex <= endCharCountAfterThisNode) {
        startNode = currentNode; startOffset = targetStartIndex - charCount; foundStart = true;
        if (docSelection.length === 0) { endNode = startNode; endOffset = startOffset; foundEnd = true; break; }
      }
      if (docSelection.length > 0 && !foundEnd && targetEndIndex >= charCount && targetEndIndex <= endCharCountAfterThisNode) {
        endNode = currentNode; endOffset = targetEndIndex - charCount; foundEnd = true;
      }
      charCount = endCharCountAfterThisNode;
      if (foundStart && foundEnd) break;
    }

    if (!foundStart) {
        charCount = 0;
        const endIterator = document.createNodeIterator(editorEl, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null);
        let lastCountableNode: Node | null = null;
        while(currentNode = endIterator.nextNode()) {
            if (currentNode.nodeType === Node.TEXT_NODE) {
                lastCountableNode = currentNode; charCount += currentNode.textContent?.length || 0;
            } else if (currentNode.nodeName === 'BR') {
                lastCountableNode = currentNode; charCount += 1;
            }
        }
        startNode = lastCountableNode || editorEl.firstChild || editorEl;
        startOffset = lastCountableNode ? (lastCountableNode.nodeType === Node.TEXT_NODE ? (lastCountableNode.textContent?.length || 0) : 1) : 0;
    }
    if (!foundEnd) { endNode = startNode; endOffset = startOffset; }

    if (startNode && endNode) {
      try {
        const setRangePoint = (pointSetter: (node: Node, offset: number) => void, node: Node, offset: number) => {
          if (node.nodeName === 'BR') {
            const parent = node.parentNode;
            const brIndexInParent = Array.from(parent?.childNodes || []).indexOf(node as ChildNode);
            if (parent && brIndexInParent !== -1) { pointSetter(parent, offset === 0 ? brIndexInParent : brIndexInParent + 1); }
            else { pointSetter(node, 0); }
          } else { pointSetter(node, offset); }
        };
        setRangePoint(range.setStart.bind(range), startNode, startOffset);
        setRangePoint(range.setEnd.bind(range), endNode, endOffset);
        return range;
      } catch (e) { console.error("Error setting range:", e); /* fallback below */ }
    }
    console.warn('Could not map document selection to DOM range accurately (final fallback).', docSelection);
    try { range.selectNodeContents(editorEl); range.collapse(true); } catch (e) { return null; }
    return range;
  }

  // --- End of methods moved from DocumentManager ---

  private refreshSelection(): Selection | null {
    this.selection = window.getSelection();
    return this.selection;
  }

  // Renamed from getSelection to getBrowserSelection to avoid conflict if we use getSelection for DocSelection
  public getBrowserSelection(): Selection | null {
    return this.refreshSelection();
  }

  // Renamed from getRange to getDomRange
  public getDomRange(): Range | null {
    const currentSel = this.refreshSelection();
    return currentSel && currentSel.rangeCount > 0 ? currentSel.getRangeAt(0) : null;
  }

  // Renamed from setRange to setDomRange
  public setDomRange(rangeToRestore: Range): void {
    const currentSel = this.refreshSelection();
    if (currentSel) {
      currentSel.removeAllRanges();
      currentSel.addRange(rangeToRestore);
    }
  }

  public isCollapsed(): boolean {
    const currentSel = this.refreshSelection();
    return currentSel ? currentSel.isCollapsed : true;
  }

  public isWithin(container: HTMLElement): boolean { // May not be needed if Ritor checks $el directly
    const currentSel = this.refreshSelection();
    if (!currentSel || !currentSel.anchorNode || !currentSel.focusNode) {
      return false;
    }
    return container.contains(currentSel.anchorNode) && container.contains(currentSel.focusNode);
  }

  // getContainer() might be less relevant or could be adapted to use DocSelection logic
  public getDomContainer(): Node | null {
    const domRange = this.getDomRange();
    if (!domRange) return null;
    let node = domRange.commonAncestorContainer;
    if (node && node.nodeType === Node.TEXT_NODE && node.parentNode) {
      node = node.parentNode;
    }
    return node;
  }

  // --- New public API for DocSelection ---
  public getDocSelection(): DocSelection | null {
    const domRange = this.getDomRange();
    if (domRange) {
      return this.domRangeToDocSelection(domRange);
    }
    return null;
  }

  public setDocSelection(docSelection: DocSelection | null): void {
    if (!docSelection) {
        const currentSel = this.refreshSelection();
        currentSel?.removeAllRanges(); // Deselect
        return;
    }
    const domRange = this.docSelectionToDomRange(docSelection);
    if (domRange) {
      this.setDomRange(domRange);
    }
  }
}

export default Cursor;
