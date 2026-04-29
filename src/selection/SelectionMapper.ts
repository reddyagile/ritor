import { DocSelection } from '../types';

class SelectionMapper {
  private editorEl: HTMLElement;

  constructor(editorEl: HTMLElement) {
    this.editorEl = editorEl;
  }

  private isPlaceholderBreak(node: Node): boolean {
    if (node.nodeType !== Node.ELEMENT_NODE || node.nodeName.toUpperCase() !== 'BR') {
      return false;
    }

    const parent = node.parentNode;
    if (!parent || parent.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    return parent.childNodes.length === 1;
  }

  private getRecursiveTextLengthForDom(node: Node): number {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length || 0;
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.nodeName.toUpperCase() === 'BR') return this.isPlaceholderBreak(node) ? 0 : 1;
      let len = 0;
      node.childNodes.forEach((child) => {
        len += this.getRecursiveTextLengthForDom(child);
      });
      return len;
    }
    if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      let len = 0;
      node.childNodes.forEach((child) => {
        len += this.getRecursiveTextLengthForDom(child);
      });
      return len;
    }
    return 0;
  }

  private getBlockBeforeLength(topLevelChild: Node): number {
    let index = 0;
    const siblings = Array.from(this.editorEl.childNodes);
    for (const sibling of siblings) {
      if (sibling === topLevelChild) {
        break;
      }
      index += this.getRecursiveTextLengthForDom(sibling) + 1;
    }
    return index;
  }

  private getTopLevelChild(node: Node): Node | null {
    if (node === this.editorEl) {
      return null;
    }

    let current: Node | null = node;
    while (current && current.parentNode && current.parentNode !== this.editorEl) {
      current = current.parentNode;
    }

    if (current && current.parentNode === this.editorEl) {
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
    if (container === this.editorEl) {
      let index = 0;
      const childNodes = Array.from(this.editorEl.childNodes);
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
    if (!this.editorEl.contains(range.startContainer) || !this.editorEl.contains(range.endContainer)) {
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
    const childNodes = Array.from(this.editorEl.childNodes);

    if (childNodes.length === 0) {
      return { node: this.editorEl, offset: 0 };
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
        range.selectNodeContents(this.editorEl);
        range.collapse(true);
      } catch {
        return null;
      }
      return range;
    }
  }
}

export default SelectionMapper;
