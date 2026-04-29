// src/modules/BaseModule.ts
import Ritor from '../Ritor';
import { ModuleOptions } from '../types';
import { domUtil } from '../utils';
import { OpAttributes } from '../Document';

class BaseModule {
  public ritor: Ritor;
  public $toolbar: HTMLElement | null = null;
  public options: ModuleOptions;

  constructor(ritor: Ritor, options: ModuleOptions) {
    this.ritor = ritor;
    this.options = options;

    if (this.options.toolbar) {
      this.$toolbar = document.querySelector(this.options.toolbar);
    }

    const clickHandler = this.handleClick.bind(this);
    this.$toolbar?.addEventListener('click', clickHandler);

    this.ritor.on('editor:destroyed', () => {
      this.toggleActive(false);
      this.$toolbar?.removeEventListener('click', clickHandler);
    });

    this.ritor.on('typingattributes:change', this.updateActiveState.bind(this));
    this.updateActiveState();
  }

  public handleClick() {
    if (this.options.formatAttributeKey && this.ritor && this.ritor.cursor) {
      const attributeKey = this.options.formatAttributeKey;
      const docSelection = this.ritor.cursor.getDocSelection();

      if (!docSelection || docSelection.length === 0) {
        this.ritor.toggleTypingAttribute(attributeKey);
      } else if (docSelection.length > 0) {
        const currentFormats: OpAttributes = this.ritor.getFormatAt(docSelection);
        const isCurrentlyActive = !!currentFormats[attributeKey];
        const formatValueToApply = isCurrentlyActive ? null : true;

        this.ritor.applyFormat({ [attributeKey]: formatValueToApply });
      }
    }
  }

  public toggleActive(isActive: boolean) {
    if (this.$toolbar) {
      if (isActive) {
        domUtil.addClass(this.$toolbar, 'active');
      } else {
        domUtil.removeClass(this.$toolbar, 'active');
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
