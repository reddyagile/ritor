class Cursor {
  private sel: Selection | null = null;

  constructor() {
    this.sel = this.getSelection();
  }

  public getSelection() {
    return window.getSelection();
  }

  public getRange() {
    return this.sel && this.sel.rangeCount > 0 ? this.sel.getRangeAt(0) : null;
  }

  public setRange(saved: Range) {
    if (this.sel) {
      this.sel.removeAllRanges();
      this.sel.addRange(saved);
    }
  }

  public isCollapsed() {
    return this.sel && this.sel.isCollapsed;
  }

  public isWithin(container: HTMLElement) {
    return this.sel && container.contains(this.sel.anchorNode) && container.contains(this.sel.focusNode);
  }

  public getContainer() {
    const range = this.getRange()?.cloneRange();
    let node = range?.commonAncestorContainer;
    if (node && node.nodeType === Node.TEXT_NODE && node.parentNode) {
      node = node.parentNode;
    }
    return node;
  }
}

export default Cursor;
