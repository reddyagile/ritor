// src/Cursor.ts
import Ritor from './Ritor'; // Import Ritor to get a reference to $el
import { DocSelection } from './types'; // Import from types.ts
import SelectionMapper from './selection/SelectionMapper';

class Cursor {
  private ritor: Ritor; // Reference to Ritor instance
  private selection: Selection | null = null; // Browser Selection object
  private selectionMapper: SelectionMapper;

  constructor(ritor: Ritor) {
    this.ritor = ritor;
    this.selectionMapper = new SelectionMapper(this.ritor.$el);
    // Initial refreshSelection can be done here or lazily
    this.refreshSelection();
  }

  // --- Start of methods moved and adapted from DocumentManager ---

  public domRangeToDocSelection(range: Range): DocSelection | null {
    return this.selectionMapper.domRangeToDocSelection(range);
  }

  public docSelectionToDomRange(docSelection: DocSelection): Range | null {
    return this.selectionMapper.docSelectionToDomRange(docSelection);
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
