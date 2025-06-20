// src/Ritor.ts
import DomEvents from './DomEvents';
import defaultModules from './defaultModules';
import EventEmitter from './EventEmitter';
import { Module, ModuleOptions, RitorOptions, DocSelection } from './types'; // DocSelection from types
import { Renderer } from './Renderer';
import { isObject } from './utils';
import { Document, OpAttributes } from './Document';
import Cursor from './Cursor'; // Import Cursor
import DocumentManager from './DocumentManager'; // DocumentManager still needed

class Ritor extends EventEmitter {
  private static modules = new Map();
  private domEventMap = new Map();
  private options: RitorOptions;
  private shortcuts: Map<string, string> = new Map();
  private initialized: boolean;
  private _isTogglingTypingAttribute = false;

  public $el: HTMLElement;
  public moduleInstances = new Map();
  private docManager: DocumentManager;
  private renderer: Renderer;
  public cursor: Cursor;

  constructor(target: string, userProvidedOptions?: RitorOptions) {
    super();

    if (!target) throw new Error('Target selector is required.');
    const targetElem = document.querySelector(target) as HTMLElement;
    if (!targetElem) throw new Error('Target element not found.');
    this.$el = targetElem;

    const defaultInternalOptions: RitorOptions = { modules: {} };
    this.options = Object.assign({}, defaultInternalOptions, userProvidedOptions);
    this.options.modules = this.options.modules || {};

    this.initializeDefaultModules();

    this.cursor = new Cursor(this);
    this.docManager = new DocumentManager(this);
    this.renderer = new Renderer(this.$el);

    this.initializeModules();

    this.registerModuleShortcuts();
    this.init();
    this.initialized = true;
    this.emit('editor:init');

    this.on('document:change', (newDoc: Document, newSelection?: DocSelection) => {
      if (this.renderer && newDoc) {
        this.renderer.render(newDoc);
        if (newSelection) {
          this.cursor.setDocSelection(newSelection);
        }
        this.emit('cursor:change');
      }
    });

    this.on('keydown', this.handleGlobalKeydown.bind(this));
    this.on('cursor:change', this.handleCursorChangeForTypingAttributes.bind(this));

    if(this.docManager && this.renderer) {
        this.renderer.render(this.docManager.getDocument());
    }
  }

  private initializeDefaultModules() {
    for (const [key, module] of Object.entries(defaultModules)) {
      if (!Ritor.modules.has(key)) {
         Ritor.register(key, module);
      }
    }
  }

  public static register<T>(moduleName: string, module: Module<T>) {
    Ritor.modules.set(moduleName, {
      moduleClass: module,
    });
  }

  private static getModule(moduleName: string) {
    return Ritor.modules.get(moduleName);
  }

  private init() {
    const domEvents = new DomEvents(this);
    this.domEventMap.set('mouseup', domEvents.handleMouseUp.bind(domEvents));
    this.domEventMap.set('keydown', domEvents.handleKeydown.bind(domEvents));
    this.domEventMap.set('beforeinput', domEvents.handleBeforeInput.bind(domEvents));
    this.domEventMap.set('paste', domEvents.handlePaste.bind(domEvents));
    this.domEventMap.set('dragover', domEvents.handleOutsideDragAndDrop.bind(domEvents));
    this.domEventMap.set('drop', domEvents.handleOutsideDragAndDrop.bind(domEvents));
    this.domEventMap.set('dblclick', domEvents.handleDoubleClick.bind(domEvents));

    if (this.$el) {
      this.$el.contentEditable = 'true';
      this.registerEvents();
    }
  }

  private initializeModules() {
    const modulesConfig = this.options.modules;
    modulesConfig &&
      Object.keys(modulesConfig).forEach((moduleName) => {
        const moduleStaticConfig = Ritor.modules.get(moduleName);
        if (moduleStaticConfig && moduleStaticConfig.moduleClass) {
          const userModuleOptions = modulesConfig[moduleName] || {};

          let shortcutKey = userModuleOptions.shortcutKey;
          if (!shortcutKey && moduleStaticConfig.moduleClass.hasOwnProperty('shortcutKey')) {
            shortcutKey = (moduleStaticConfig.moduleClass as any).shortcutKey;
          } else if (!shortcutKey && moduleStaticConfig.moduleClass.prototype.hasOwnProperty('shortcutKey')) {
             shortcutKey = (moduleStaticConfig.moduleClass.prototype as any).shortcutKey;
          }

          const fullModuleOptions: ModuleOptions = {
            ...userModuleOptions,
            moduleName: moduleName,
            shortcutKey: shortcutKey,
          };

          this.moduleInstances.set(moduleName, new moduleStaticConfig.moduleClass(this, fullModuleOptions));
        }
      });
  }

  private registerModuleShortcuts() {
    this.moduleInstances.forEach((moduleInstance, moduleName) => {
      const shortcutKey = moduleInstance.options?.shortcutKey;
      if (shortcutKey) {
        const normalizedKey = this.normalizeShortcutKey(shortcutKey);
        this.shortcuts.set(normalizedKey, moduleName);
      }
    });
  }

  private normalizeShortcutKey(shortcut: string): string {
    const parts = shortcut.toLowerCase().split(/[:.+]/).filter(k => k !== 'prevent' && k !== 'stop');
    parts.sort();
    return parts.join('+');
  }

  private handleGlobalKeydown(e: KeyboardEvent) {
    const keyString = [];
    if (e.ctrlKey || e.metaKey) keyString.push('ctrl');
    if (e.shiftKey) keyString.push('shift');
    if (e.altKey) keyString.push('alt');
    keyString.push(e.key.toLowerCase());

    const normalizedPressedKey = this.normalizeShortcutKey(keyString.join('+'));

    if (this.shortcuts.has(normalizedPressedKey)) {
      const moduleName = this.shortcuts.get(normalizedPressedKey);
      if (moduleName) {
        const moduleInstance = this.moduleInstances.get(moduleName);
        if (moduleInstance && typeof moduleInstance.handleClick === 'function') {
          const originalShortcutDef = moduleInstance.options?.shortcutKey;
          if (originalShortcutDef && originalShortcutDef.includes('.prevent')) {
            e.preventDefault();
          }
          if (originalShortcutDef && originalShortcutDef.includes('.stop')) {
            e.stopPropagation();
          }
          moduleInstance.handleClick();
        }
      }
    }
  }

  private registerEvents() {
    Array.from(this.domEventMap).forEach((value) => {
      const [eventName, eventHandler] = value;
      this.$el?.addEventListener(eventName, eventHandler);
    });
  }

  private unRegisterEvents() {
    Array.from(this.domEventMap).forEach((value) => {
      const [eventName, eventHandler] = value;
      this.$el?.removeEventListener(eventName, eventHandler);
    });
  }

  public destroy() {
    if (this.$el) this.$el.contentEditable = 'false';
    this.unRegisterEvents();
    this.emit('editor:destroyed');
    this.initialized = false;
  }

  public reInit() {
    if (!this.initialized) {
      this.initializeModules();
      this.init();
    }
  }

  public getDocumentManager(): DocumentManager {
    return this.docManager;
  }

  public getCurrentDomRange(): Range | null {
    if (!this.cursor) return null;
    return this.cursor.getDomRange();
  }

  public domRangeToDocSelection(range: Range): DocSelection | null {
      if (!this.cursor) return null;
      return this.cursor.domRangeToDocSelection(range);
  }

  public getFormatAt(selection: DocSelection): OpAttributes {
    if (!this.docManager) return {};
    return this.docManager.getFormatAt(selection);
  }

  public clearFormatting(selection: DocSelection): void {
      if (!this.docManager) return;
      this.docManager.clearFormat(selection);
  }

  public handleCharacterInput(char: string): void {
    if (!this.docManager || !this.cursor) return;
    const currentDocSelection = this.cursor.getDocSelection();
    if (currentDocSelection) {
      this.docManager.insertText(char, currentDocSelection);
      this._isTogglingTypingAttribute = false;
    }
  }

  public handleBackspace(): void {
    if (!this.docManager || !this.cursor) return;
    let currentDocSelection = this.cursor.getDocSelection();
    if (currentDocSelection) {
      if (currentDocSelection.length === 0 && currentDocSelection.index > 0) {
        currentDocSelection = { index: currentDocSelection.index - 1, length: 1 };
      }
      if (currentDocSelection.length > 0) {
        this.docManager.deleteText(currentDocSelection);
        this._isTogglingTypingAttribute = false;
      }
    }
  }

  public handleDelete(): void {
    if (!this.docManager || !this.cursor) return;
    let currentDocSelection = this.cursor.getDocSelection();
    if (currentDocSelection) {
      if (currentDocSelection.length === 0) {
         currentDocSelection = { index: currentDocSelection.index, length: 1};
      }
      if (currentDocSelection.length > 0) {
        this.docManager.deleteText(currentDocSelection);
        this._isTogglingTypingAttribute = false;
      }
    }
  }

  public handlePasteText(text: string): void {
    if (!this.docManager || !this.cursor) return;
    const currentDocSelection = this.cursor.getDocSelection();
    if (currentDocSelection) {
      this.docManager.insertText(text, currentDocSelection);
      this._isTogglingTypingAttribute = false;
    }
  }

  public applyFormat(attributes: OpAttributes) {
    if (!this.docManager || !this.cursor) return;
    const currentDocSelection = this.cursor.getDocSelection();
    if (currentDocSelection && currentDocSelection.length > 0) {
      this.docManager.formatText(attributes, currentDocSelection);
      // Note: applyFormat applies to a range, it doesn't set typing attributes directly.
      // The cursor:change event after this will update typing attributes from content.
      // So, no need to set _isTogglingTypingAttribute = false here.
    }
  }

  public getHtml(): string {
    if (!this.docManager) {
      return '';
    }
    const currentDelta = this.docManager.getDocument().getDelta();
    return Renderer.deltaToHtml(currentDelta);
  }

  public handleEnterKey(): void {
    if (!this.docManager || !this.cursor) return;
    let currentDocSelection = this.cursor.getDocSelection();
    if (!currentDocSelection) {
        currentDocSelection = { index: this.docManager.getDocument().getDelta().length(), length: 0 };
    }
    this.docManager.insertBlockBreak(currentDocSelection);
    this._isTogglingTypingAttribute = false;
  }

  public getTypingAttributes(): OpAttributes {
    if (!this.docManager) return {};
    return this.docManager.getTypingAttributes();
  }

  public setTypingAttributes(attrs: OpAttributes): void {
    if (!this.docManager) return;
    this.docManager.setTypingAttributes(attrs);
  }

  public toggleTypingAttribute(formatKey: string, explicitValue?: boolean | null): void {
    if (!this.docManager) return;
    this._isTogglingTypingAttribute = true;
    this.docManager.toggleTypingAttribute(formatKey, explicitValue);
  }

  private handleCursorChangeForTypingAttributes(): void {
    if (this._isTogglingTypingAttribute) {
      return;
    }
    if (!this.cursor || !this.docManager) {
      return;
    }
    const selection = this.cursor.getDocSelection();
    if (selection && selection.length === 0) {
      const formatsAtCursor = this.docManager.getFormatAt(selection);
      this.docManager.setTypingAttributes(formatsAtCursor || {});
    } else {
      this.docManager.setTypingAttributes({});
    }
  }
}

export default Ritor;
