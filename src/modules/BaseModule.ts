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

    // Listen to selection, document, and typing attribute changes to update UI
    this.ritor.on('cursor:change', this.updateActiveState.bind(this));
    this.ritor.on('document:change', this.updateActiveState.bind(this));
    this.ritor.on('typingattributes:change', this.updateActiveState.bind(this)); // ADDED LISTENER

    // Initial state update - called directly. If Ritor isn't fully ready,
    // its methods should gracefully return defaults (e.g. getTypingAttributes returns {}).
    this.updateActiveState();
  }

  // Handles toolbar button click
  public handleClick() {
    if (this.options.formatAttributeKey && this.ritor && this.ritor.cursor) {
      const attributeKey = this.options.formatAttributeKey;
      const docSelection = this.ritor.cursor.getDocSelection();

      if (docSelection && docSelection.length === 0) { // Collapsed selection
        // Toggle the typing attribute for this module's format
        this.ritor.toggleTypingAttribute(attributeKey);
        // The 'typingattributes:change' event (emitted by DocumentManager via Ritor)
        // will be handled by updateActiveState to update the button's appearance.
      } else if (docSelection && docSelection.length > 0) { // Range selection
        // Existing logic: Determine if format should be applied or removed based on current selection state
        const currentFormats: OpAttributes = this.ritor.getFormatAt(docSelection);
        const isCurrentlyActive = !!currentFormats[attributeKey];
        const formatValueToApply = isCurrentlyActive ? null : true; // Toggle: null to remove, true to add

        this.ritor.applyFormat({ [attributeKey]: formatValueToApply });
      }
      // If no docSelection (e.g., editor not focused), do nothing.
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
