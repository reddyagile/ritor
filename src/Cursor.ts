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
    if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
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

  private getBlockBeforeLength(topLevelChild: Node): number {
    const editorEl = this.ritor.$el;
    let index = 0;
    const siblings = Array.from(editorEl.childNodes);
    for (const sibling of siblings) {
      if (sibling === topLevelChild) {
        break;
      }
      index += this.getRecursiveTextLengthForDom(sibling) + 1;
    }
    return index;
  }

  private getTopLevelChild(node: Node): Node | null {
    const editorEl = this.ritor.$el;
    if (node === editorEl) {
      return null;
    }
    let current: Node | null = node;
    while (current && current.parentNode && current.parentNode !== editorEl) {
      current = current.parentNode;
    }
    if (current && current.parentNode === editorEl) {
      return current;
    }
    return null;
  }

  private getLocalLengthInBlock(blockNode: Node, container: Node, offset: number): number {
    const range = document.createRange();
    try {
      range.setStart(blockNode, 0);
      range.setEnd(container, offset);
      return this.getRecursiveTextLengthForDom(range.cloneContents());
    } catch {
      return 0;
    }
  }

  private domPointToDocIndex(container: Node, offset: number): number {
    const editorEl = this.ritor.$el;

    if (container === editorEl) {
      let index = 0;
      const childNodes = Array.from(editorEl.childNodes);
      const clampedOffset = Math.max(0, Math.min(offset, childNodes.length));
      for (let i = 0; i < clampedOffset; i++) {
        index += this.getRecursiveTextLengthForDom(childNodes[i]) + 1;
      }
      return index;
    }

    const topLevelChild = this.getTopLevelChild(container);
    if (!topLevelChild) {
      return 0;
    }

    const blockPrefixLength = this.getBlockBeforeLength(topLevelChild);
    const localLength = this.getLocalLengthInBlock(topLevelChild, container, offset);
    return blockPrefixLength + localLength;
  }

  public domRangeToDocSelection(range: Range): DocSelection | null {
    const editorEl = this.ritor.$el;
    if (!editorEl.contains(range.startContainer) || !editorEl.contains(range.endContainer)) {
      return null;
    }

    const start = this.domPointToDocIndex(range.startContainer, range.startOffset);
    const end = this.domPointToDocIndex(range.endContainer, range.endOffset);

    if (end < start) {
      return { index: start, length: 0 };
    }

    return { index: start, length: end - start };
  }

  private getStartPointOfNode(node: Node): { node: Node; offset: number } {
    if (node.nodeType === Node.TEXT_NODE) {
      return { node, offset: 0 };
    }
    if (node.nodeType === Node.ELEMENT_NODE && node.nodeName.toUpperCase() === 'BR') {
      const parent = node.parentNode;
      const index = parent ? Array.from(parent.childNodes).indexOf(node as ChildNode) : -1;
      if (parent && index >= 0) {
        return { node: parent, offset: index };
      }
      return { node, offset: 0 };
    }
    const firstChild = node.firstChild;
    if (!firstChild) {
      return { node, offset: 0 };
    }
    return this.getStartPointOfNode(firstChild);
  }

  private getEndPointOfNode(node: Node): { node: Node; offset: number } {
    if (node.nodeType === Node.TEXT_NODE) {
      return { node, offset: node.textContent?.length || 0 };
    }
    if (node.nodeType === Node.ELEMENT_NODE && node.nodeName.toUpperCase() === 'BR') {
      const parent = node.parentNode;
      const index = parent ? Array.from(parent.childNodes).indexOf(node as ChildNode) : -1;
      if (parent && index >= 0) {
        return { node: parent, offset: index + 1 };
      }
      return { node, offset: 1 };
    }
    const lastChild = node.lastChild;
    if (!lastChild) {
      return { node, offset: node.childNodes.length };
    }
    return this.getEndPointOfNode(lastChild);
  }

  private mapLocalIndexToDomPoint(node: Node, localIndex: number): { node: Node; offset: number } {
    if (node.nodeType === Node.TEXT_NODE) {
      const textLen = node.textContent?.length || 0;
      const clamped = Math.max(0, Math.min(localIndex, textLen));
      return { node, offset: clamped };
    }

    if (node.nodeType === Node.ELEMENT_NODE && node.nodeName.toUpperCase() === 'BR') {
      const parent = node.parentNode;
      const index = parent ? Array.from(parent.childNodes).indexOf(node as ChildNode) : -1;
      if (parent && index >= 0) {
        return { node: parent, offset: localIndex <= 0 ? index : index + 1 };
      }
      return { node, offset: localIndex <= 0 ? 0 : 1 };
    }

    let remaining = localIndex;
    const children = Array.from(node.childNodes);

    for (const child of children) {
      const childLen = this.getRecursiveTextLengthForDom(child);
      if (remaining <= childLen) {
        return this.mapLocalIndexToDomPoint(child, remaining);
      }
      remaining -= childLen;
    }

    return this.getEndPointOfNode(node);
  }

  private mapDocIndexToDomPoint(targetIndex: number): { node: Node; offset: number } {
    const editorEl = this.ritor.$el;
    const childNodes = Array.from(editorEl.childNodes);

    if (childNodes.length === 0) {
      return { node: editorEl, offset: 0 };
    }

    let currentIndex = 0;
    for (let i = 0; i < childNodes.length; i++) {
      const block = childNodes[i];
      const blockTextLen = this.getRecursiveTextLengthForDom(block);
      const blockStart = currentIndex;
      const blockEnd = blockStart + blockTextLen;

      if (targetIndex <= blockEnd) {
        return this.mapLocalIndexToDomPoint(block, targetIndex - blockStart);
      }

      const separatorIndex = blockEnd + 1;
      if (targetIndex === separatorIndex) {
        const nextBlock = childNodes[i + 1];
        if (nextBlock) {
          return this.getStartPointOfNode(nextBlock);
        }
        return this.getEndPointOfNode(block);
      }

      currentIndex = separatorIndex;
    }

    return this.getEndPointOfNode(childNodes[childNodes.length - 1]);
  }

  public docSelectionToDomRange(docSelection: DocSelection): Range | null {
    const editorEl = this.ritor.$el;
    if (!editorEl) return null;

    const range = document.createRange();
    const targetStartIndex = Math.max(0, docSelection.index);
    const targetEndIndex = Math.max(targetStartIndex, docSelection.index + docSelection.length);

    try {
      const startPoint = this.mapDocIndexToDomPoint(targetStartIndex);
      const endPoint = this.mapDocIndexToDomPoint(targetEndIndex);
      range.setStart(startPoint.node, startPoint.offset);
      range.setEnd(endPoint.node, endPoint.offset);
      return range;
    } catch (e) {
      console.warn('Could not map document selection to DOM range accurately (fallback).', docSelection, e);
      try {
        range.selectNodeContents(editorEl);
        range.collapse(true);
      } catch {
        return null;
      }
      return range;
    }
  }

  // --- End of methods moved from DocumentManager ---

  private refreshSelection(): Selection | null {
    this.selection = window.getSelection();
    return this.selection;
  }

  // Renamed from getRange to getDomRange - RETAINED
  public getDomRange(): Range | null {
    const currentSel = this.refreshSelection();
    return currentSel && currentSel.rangeCount > 0 ? currentSel.getRangeAt(0) : null;
  }

  // Renamed from setRange to setDomRange - RETAINED
  public setDomRange(rangeToRestore: Range): void {
    const currentSel = this.refreshSelection();
    if (currentSel) {
      currentSel.removeAllRanges();
      currentSel.addRange(rangeToRestore);
    }
  }

  // isWithin is RETAINED
  public isWithin(container: HTMLElement): boolean {
    const currentSel = this.refreshSelection();
    if (!currentSel || !currentSel.anchorNode || !currentSel.focusNode) {
      return false;
    }
    return container.contains(currentSel.anchorNode) && container.contains(currentSel.focusNode);
  }

  // getDomContainer() was removed.
  // isCollapsed() was removed.
  // getBrowserSelection() was removed.

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
