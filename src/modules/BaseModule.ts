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

    // MODIFIED: Remove 'cursor:change' and 'document:change' listeners for updateActiveState
    // this.ritor.on('cursor:change', this.updateActiveState.bind(this)); // REMOVE
    // this.ritor.on('document:change', this.updateActiveState.bind(this)); // REMOVE

    // KEEP ONLY this listener for updateActiveState regarding typing attributes
    this.ritor.on('typingattributes:change', this.updateActiveState.bind(this));

    // Initial state update.
    // This will reflect initial typingAttributes (likely empty) or initial selection format.
    // updateActiveState needs to be robust enough to handle Ritor not being fully focused/ready.
    this.updateActiveState();
  }

  public handleClick() {
    if (this.options.formatAttributeKey && this.ritor && this.ritor.cursor) {
      const attributeKey = this.options.formatAttributeKey;
      const docSelection = this.ritor.cursor.getDocSelection();

      // MODIFIED Condition:
      // Toggle typing attribute if selection is collapsed OR if there's no document selection
      // (e.g., editor not focused, but user wants to set a typing style for when it does get focus).
      if (!docSelection || docSelection.length === 0) {
        this.ritor.toggleTypingAttribute(attributeKey);
        // The 'typingattributes:change' event emitted by toggleTypingAttribute
        // will be caught by updateActiveState to update the button's visual state.
      } else if (docSelection && docSelection.length > 0) { // Explicitly check docSelection here for safety, though covered by previous if.
        // Range selection: existing logic to apply/remove format from the selected text range.
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
        domUtil.removeClass(this.options.toolbar ? this.$toolbar : null, 'active'); // Guard against null $toolbar
      }
    }
  }

  public updateActiveState() {
    if (!this.options.formatAttributeKey || !this.ritor || !this.ritor.cursor) {
      this.toggleActive(false);
      return;
    }
    if (!this.ritor.cursor.isWithin(this.ritor.$el)) {
        this.toggleActive(false);
        return;
    }
    const docSelection = this.ritor.cursor.getDocSelection();
    const attributeKey = this.options.formatAttributeKey;
    if (docSelection && docSelection.length === 0) {
      const typingAttrs = this.ritor.getTypingAttributes();
      this.toggleActive(!!typingAttrs[attributeKey]);
    } else if (docSelection && docSelection.length > 0) {
      const formats = this.ritor.getFormatAt(docSelection);
      this.toggleActive(!!formats[attributeKey]);
    } else {
      // No valid docSelection, or editor not focused.
      // Reflect current typingAttributes as a fallback.
      const typingAttrs = this.ritor.getTypingAttributes();
      if (Object.keys(typingAttrs).length > 0 && typingAttrs.hasOwnProperty(attributeKey)) {
          this.toggleActive(!!typingAttrs[attributeKey]);
      } else {
          this.toggleActive(false);
      }
    }
  }
}

export default BaseModule;
