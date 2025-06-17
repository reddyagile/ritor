// src/modules/BaseModule.ts
import Ritor from '../Ritor';
import { ModuleOptions } from '../types';
import { domUtil } from '../utils'; // Keep for toolbar class manipulation
import { DocSelection } from '../DocumentManager'; // Import DocSelection
import { OpAttributes } from '../Document'; // Import OpAttributes

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
    if (this.options.formatAttributeKey && this.ritor.docManager) {
      const attributeKey = this.options.formatAttributeKey; // e.g., "bold"

      // Get current DOM selection and convert to DocSelection
      const domRange = this.ritor.docManager.cursor.getRange();
      if (!domRange) return;

      // Don't apply format if selection is collapsed (typical editor behavior for toggles)
      // Some editors allow setting typing attributes on collapsed selection.
      // For a simple toggle, we usually require a range.
      if (domRange.collapsed) {
          // Optionally, handle "typing attributes" here in the future
          // For now, if collapsed, maybe do nothing or toggle a "typing" state.
          // Let's assume for now we only format ranges.
          // If you want to toggle for typing:
          // const currentAttrs = this.ritor.docManager.getTypingAttributes(); // Needs implementation
          // const newAttrs = { ...currentAttrs, [attributeKey]: !currentAttrs[attributeKey] };
          // this.ritor.docManager.setTypingAttributes(newAttrs);
          // this.updateActiveState(); // update based on typing attributes
          return;
      }

      const docSelection = this.ritor.docManager.domRangeToDocSelection(domRange);
      if (!docSelection || docSelection.length === 0) return;

      // Determine if we are adding or removing the format.
      // Check the current format at the selection.
      const currentFormats = this.ritor.docManager.getFormatAt(docSelection);
      const shouldApplyFormat = !currentFormats[attributeKey]; // Toggle logic

      const formatToApply: OpAttributes = { [attributeKey]: shouldApplyFormat ? true : null }; // Use null to remove attribute

      this.ritor.applyFormat(formatToApply); // Ritor's applyFormat will use its docManager
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
    if (!this.ritor.docManager || !this.options.formatAttributeKey) {
      this.toggleActive(false);
      return;
    }

    const domRange = this.ritor.docManager.cursor.getRange();
    // Do not try to update if cursor is not in editor.
    if (!domRange || !this.ritor.docManager.cursor.isWithin(this.ritor.$el)) {
        this.toggleActive(false);
        return;
    }

    const docSelection = this.ritor.docManager.domRangeToDocSelection(domRange);
    if (!docSelection) {
      this.toggleActive(false);
      return;
    }

    // If selection is collapsed, check "typing attributes" (future) or format of char before.
    // For now, let's use getFormatAt which has some logic for collapsed selections.
    const formats = this.ritor.docManager.getFormatAt(docSelection);
    const attributeKey = this.options.formatAttributeKey; // e.g., "bold"
    this.toggleActive(!!formats[attributeKey]);
  }
}

export default BaseModule;
