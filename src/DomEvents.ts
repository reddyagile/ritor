import Ritor from './Ritor';
import { domUtil } from './utils';

class DomEvents {
  private ritor: Ritor;
  private shortcutKeys = new Map();

  constructor(ritor: Ritor) {
    this.ritor = ritor;
    this.observeContentChange();
    this.registerShortcutKeys();
  }

  private observeContentChange() {
    if (this.ritor.$el) {
      const mo = new MutationObserver(() => this.ritor.emit('input:change'));
      mo.observe(this.ritor.$el, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
  }

  private fixEmptyEditor() {
    const content = this.ritor.getContent();
    if (content?.isEmpty()) {
      if (this.ritor.$el) {
        // if only <br>, pasted text is going inside br tag
        this.ritor.$el.innerHTML = '&nbsp;';
        const range = new Range();
        range.setStart(this.ritor.$el.childNodes[0], 0);
        range.setEnd(this.ritor.$el.childNodes[0], 0);
        content.cursor.setRange(range);
      }
    }
  }

  private bindShortcutKeys(e: KeyboardEvent) {
    let shortcutKey = e.code;
    if (e.ctrlKey || e.metaKey) {
      shortcutKey = `ctrl:${e.code}`;
    }
    if (this.shortcutKeys.get(shortcutKey)) {
      this.shortcutKeys.get(shortcutKey)?.(e);
    }
  }

  private fireCursorChange(e: PointerEvent | KeyboardEvent | MouseEvent | ClipboardEvent) {
    this.ritor.emit('cursor:change');
  }

  private registerShortcutKeys() {
    Array.from(this.ritor.moduleInstances).forEach((module) => {
      const [moduleName, moduleInstance] = module;
      let shortcutKey = moduleInstance.shortcutKey;
      if (shortcutKey && moduleInstance.click) {
        shortcutKey = shortcutKey.replace('.prevent', '');
        this.shortcutKeys.set(shortcutKey, (e: KeyboardEvent) => {
          if (moduleInstance.shortcutKey.indexOf('.prevent') > -1) {
            e.preventDefault();
          }
          moduleInstance.click();
        });
      }
    });

    this.shortcutKeys.set('ctrl:KeyZ', () => console.log('Undo'));
    this.shortcutKeys.set('ctrl:KeyY', () => console.log('Redo'));
    this.shortcutKeys.set('ctrl:KeyS', (e: KeyboardEvent) => {
      e.preventDefault();
    });
  }

  public handleDoubleClick(e: MouseEvent) {
    // Fix firefox double click selection issue
    if (navigator.userAgent.indexOf('Firefox') != -1) {
      const target = e.target as HTMLElement;
      const content = this.ritor.getContent();
      if (domUtil.isInlineElement(target.nodeName)) {
        const range = new Range();
        range.selectNodeContents(target);
        content?.cursor.setRange(range);
        this.fireCursorChange(e);
      }
    }
  }

  public handleBeforeInput(e: InputEvent) {
    if (e.inputType === 'historyUndo') e.preventDefault();
    if (e.inputType === 'historyRedo') e.preventDefault();
  }

  public handlePaste(e: ClipboardEvent) {
    e.preventDefault();
    const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
    const content = this.ritor.getContent();
    content?.insertText(text);
    this.fireCursorChange(e);
  }

  public handleOutsideDragAndDrop(e: DragEvent) {
    e.preventDefault();
  }

  public handleMouseUp(e: MouseEvent) {
    this.fireCursorChange(e);
  }

  public handleKeydown(e: KeyboardEvent) {
    this.fixEmptyEditor();
    this.bindShortcutKeys(e);

    switch (e.code) {
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown':
      case 'Backspace':
      case 'Delete':
      case 'Home':
      case 'End':
        this.fireCursorChange(e);
        break;
      case 'Enter':
        e.preventDefault();
        this.ritor.getContent()?.insertHtml('<br>');
        break;
    }

    this.ritor.emit(`key:${e.key}`, e);
  }
}

export default DomEvents;
