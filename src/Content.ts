import Cursor from './Cursor';
import Ritor from './Ritor';
import { domUtil } from './utils';

class Content {
  public cursor: Cursor;
  private doc = document;
  public ritor: Ritor;
  public commandState: Map<string, boolean> = new Map();

  constructor(ritor: Ritor) {
    this.cursor = new Cursor();
    this.ritor = ritor;
  }

  public isEmpty() {
    if (this.ritor.$el) {
      let editorContent = this.ritor.$el.innerHTML;
      editorContent = editorContent.replace(/^\s*(&nbsp;\s*)+/g, '').replace(/^\s+|\s+$/g, '');
      if (editorContent === '' || editorContent === '<br>' || editorContent === '</br>') {
        return true;
      }
      return false;
    } else {
      throw new Error('Editor is initialized.');
    }
  }

  public clearFormat() {
    const range = this.cursor.getRange();
    const text = range?.extractContents();
    const elem = this.doc.createTextNode(text ? text.textContent || '' : '');
    const contTag = this.cursor.getContainer()?.nodeName || '';
    if (domUtil.isInlineElement(contTag) && !this.cursor.isCollapsed()) {
      const cont = this.cursor.getContainer();
      cont?.parentNode?.removeChild(cont);
    }
    range?.insertNode(elem);
    range?.collapse(false);
  }

  public toggleTag(tagName: string) {
    let container = this.cursor.getContainer();

    if (container && container.nodeName.toLowerCase() === tagName) {
      let parentNode = container.parentNode;

      if (!this.cursor.isCollapsed()) {
        let childNode = null;
        while (container.firstChild) {
          childNode = container.firstChild;
          parentNode?.insertBefore(childNode, container);
        }
        parentNode?.removeChild(container);
        if (childNode) {
          const range = new Range();
          range.setStartAfter(childNode);
          range.setEndAfter(childNode);
          this.cursor.setRange(range);
        }
      } else {
        const nextNode = container.nextSibling;
        if (nextNode) {
          parentNode?.insertBefore(this.doc.createTextNode('\u00A0'), nextNode);
          const range = new Range();
          range.setStart(nextNode, 0);
          range.setEnd(nextNode, 0);
          this.cursor.setRange(range);
        }
      }
      this.commandState.set(tagName, false);
    } else {
      this.wrap(tagName);
      this.commandState.set(tagName, true);
    }
  }

  public insertHtml(html: string) {
    const el = this.doc.createElement('div');
    el.innerHTML = html;
    let frag = this.doc.createDocumentFragment(),
      node = null,
      lastNode = null;
    while ((node = el.firstChild)) {
      lastNode = frag.appendChild(node);
    }
    const range = this.cursor.getRange();
    range?.insertNode(frag);
    lastNode && range?.setStart(lastNode, 0);
    range?.collapse(false);
    range && this.cursor.setRange(range);
  }

  public insertText(text: string) {
    const elem = this.doc.createTextNode(text);
    const range = this.cursor.getRange();
    range?.insertNode(elem);
    range?.setStart(elem, 0);
    range?.collapse(false);
    range && this.cursor.setRange(range);
  }

  private wrap(tagName: string) {
    const elem = this.doc.createElement(tagName);
    const range = this.cursor.getRange();

    if (this.cursor.isCollapsed()) {
      elem.innerHTML = '&nbsp;';
      range?.insertNode(elem);
    } else {
      try {
        range?.surroundContents(elem);
      } catch (error) {
        if (range) {
          const text = range?.extractContents();
          const textElem = this.doc.createTextNode(text ? text.textContent || '' : '');
          elem.appendChild(textElem);
          range.insertNode(elem);
        }
      }
    }
    range?.setStartAfter(elem.childNodes[0]);
    range?.setEndAfter(elem.childNodes[0]);
    range && this.cursor.setRange(range);
  }
}

export default Content;
