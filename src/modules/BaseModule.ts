// src/modules/BaseModule.ts
import Ritor from '../Ritor';
import { ModuleOptions } from '../types';
import { domUtil } from '../utils'; // Keep for toolbar class manipulation
// import { DocSelection } from '../DocumentManager'; // DocSelection is used via Ritor methods
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
    if (this.options.formatAttributeKey && this.ritor) { // Added null check for ritor
      const attributeKey = this.options.formatAttributeKey;

      const domRange = this.ritor.getCurrentDomRange();
      if (!domRange || domRange.collapsed) return;

      const docSelection = this.ritor.domRangeToDocSelection(domRange);
      if (!docSelection || docSelection.length === 0) return;

      const currentFormats: OpAttributes = this.ritor.getFormatAt(docSelection); // Explicitly type
      const isCurrentlyActive = !!currentFormats[attributeKey];

      // If toggling off, value is null. If toggling on, value is true.
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
    if (!this.options.formatAttributeKey || !this.ritor) { // Added null check for ritor
      this.toggleActive(false);
      return;
    }

    const domRange = this.ritor.getCurrentDomRange();
    const docManager = this.ritor.getDocumentManager(); // Get manager for isWithin check

    if (!domRange || (docManager && !docManager.cursor.isWithin(this.ritor.$el))) {
        this.toggleActive(false);
        return;
    }

    const docSelection = this.ritor.domRangeToDocSelection(domRange);
    if (!docSelection) {
      this.toggleActive(false);
      return;
    }

    const formats: OpAttributes = this.ritor.getFormatAt(docSelection); // Explicitly type
    const attributeKey = this.options.formatAttributeKey;
    this.toggleActive(!!formats[attributeKey]);
  }
}

export default BaseModule;
