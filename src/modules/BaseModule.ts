import Ritor from '../Ritor';
import { ModuleOptions } from '../types';
import { domUtil } from '../utils';

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

    const clickHandler = this.click.bind(this);
    this.$toolbar?.addEventListener('click', clickHandler);

    this.ritor.on('editor:destroyed', () => {
      // Remove active class
      this.toggleActive(false);
      this.$toolbar?.removeEventListener('click', clickHandler);
    });

    if (this.options.tagName) {
      this.ritor.on('cursor:change', this.handleCursor.bind(this));
      this.ritor.on('input:change', this.handleCursor.bind(this));
    }
  }

  public click() {
    if (this.options.tagName) {
      const content = this.ritor.getContent();
      content?.toggleTag(this.options.tagName);
      this.toggleActive(content?.commandState.get(this.options.tagName) ? true : false);
    }
  }

  public toggleActive(condition: boolean) {
    if (this.$toolbar) {
      if (condition) {
        domUtil.addClass(this.$toolbar, 'active');
      } else {
        domUtil.removeClass(this.$toolbar, 'active');
      }
    }
  }

  public handleCursor() {
    const content = this.ritor.getContent();
    if (content) {
      const container = content.cursor.getContainer();
      this.toggleActive(container?.nodeName.toLowerCase() === this.options.tagName);
    }
  }
}

export default BaseModule;
