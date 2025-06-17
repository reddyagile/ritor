// src/Cursor.ts
class Cursor {
  private sel: Selection | null = null;

  constructor() {
    // It's fine to set it initially, but methods should refresh
    this.sel = window.getSelection();
  }

  // Helper to refresh the internal selection object
  private refreshSelection(): Selection | null {
    this.sel = window.getSelection();
    return this.sel;
  }

  public getSelection(): Selection | null {
    return this.refreshSelection();
  }

  public getRange(): Range | null {
    const currentSel = this.refreshSelection();
    return currentSel && currentSel.rangeCount > 0 ? currentSel.getRangeAt(0) : null;
  }

  public setRange(rangeToRestore: Range): void {
    const currentSel = this.refreshSelection();
    if (currentSel) {
      currentSel.removeAllRanges();
      currentSel.addRange(rangeToRestore);
    }
  }

  public isCollapsed(): boolean {
    const currentSel = this.refreshSelection();
    return currentSel ? currentSel.isCollapsed : true; // Default to true if no selection
  }

  public isWithin(container: HTMLElement): boolean {
    const currentSel = this.refreshSelection();
    if (!currentSel || !currentSel.anchorNode || !currentSel.focusNode) {
      return false;
    }
    return container.contains(currentSel.anchorNode) && container.contains(currentSel.focusNode);
  }

  public getContainer(): Node | null {
    const range = this.getRange()?.cloneRange(); // getRange() now refreshes selection
    if (!range) return null;

    let node = range.commonAncestorContainer;
    if (node && node.nodeType === Node.TEXT_NODE && node.parentNode) {
      node = node.parentNode;
    }
    return node;
  }
}

export default Cursor;
