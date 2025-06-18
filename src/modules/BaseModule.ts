// src/modules/BaseModule.ts
import Ritor from '../Ritor';
import { ModuleOptions, DocSelection } from '../types'; // Import DocSelection from types
import { domUtil } from '../utils';
import { OpAttributes } from '../Document';

class BaseModule {
  public ritor: Ritor;
  public $toolbar: HTMLElement | null = null;
  public options: ModuleOptions; // Should include its specific attribute, e.g., { bold: true }

  constructor(ritor: Ritor, options: ModuleOptions) {
    this.ritor = ritor;
    this.options = options; // e.g., { moduleName: 'bold', toolbar: '.r-bold', formatAttribute: 'bold' }

    if (this.options.toolbar) {
      this.$toolbar = document.querySelector(this.options.toolbar);
    }

    const clickHandler = this.handleClick.bind(this);
    this.$toolbar?.addEventListener('click', clickHandler);

    this.ritor.on('editor:destroyed', () => {
      this.toggleActive(false);
      this.$toolbar?.removeEventListener('click', clickHandler);
    });

    // Listen to selection or document changes to update UI
    this.ritor.on('cursor:change', this.updateActiveState.bind(this));
    this.ritor.on('document:change', this.updateActiveState.bind(this));

    // Initial state update
    this.updateActiveState();
  }

  // Handles toolbar button click
  public handleClick() {
    if (this.options.formatAttributeKey && this.ritor && this.ritor.cursor) { // Check ritor.cursor
      const attributeKey = this.options.formatAttributeKey;

      const docSelection = this.ritor.cursor.getDocSelection(); // Use ritor.cursor

      // Apply format only if there's a selection with actual length
      if (!docSelection || docSelection.length === 0) {
        // Future: Handle toggling "typing attributes" for collapsed selection if desired.
        // For now, only format non-collapsed selections.
        return;
      }

      // getFormatAt is on Ritor, which delegates to DocumentManager
      const currentFormats: OpAttributes = this.ritor.getFormatAt(docSelection);
      const isCurrentlyActive = !!currentFormats[attributeKey];
      const formatValue = isCurrentlyActive ? null : true;
      const formatToApply: OpAttributes = { [attributeKey]: formatValue };

      this.ritor.applyFormat(formatToApply);
    }
  }

  // Toggles the 'active' class on the toolbar button
  public toggleActive(isActive: boolean) {
    if (this.$toolbar) {
      if (isActive) {
        domUtil.addClass(this.$toolbar, 'active');
      } else {
        domUtil.removeClass(this.$toolbar, 'active');
      }
    }
  }

  // Updates the active state of the toolbar button based on current selection format
  public updateActiveState() {
    if (!this.options.formatAttributeKey || !this.ritor || !this.ritor.cursor) { // Check ritor.cursor
      this.toggleActive(false);
      return;
    }

    // Check if the cursor/selection is within the editor element
    if (!this.ritor.cursor.isWithin(this.ritor.$el)) {
        this.toggleActive(false);
        return;
    }

    const docSelection = this.ritor.cursor.getDocSelection(); // Use ritor.cursor
    if (!docSelection) { // If no valid selection could be determined
      this.toggleActive(false);
      return;
    }

    // getFormatAt is on Ritor, which delegates to DocumentManager
    const formats: OpAttributes = this.ritor.getFormatAt(docSelection);
    const attributeKey = this.options.formatAttributeKey;
    this.toggleActive(!!formats[attributeKey]);
  }
}

export default BaseModule;
