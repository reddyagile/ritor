// src/Ritor.ts
import DomEvents from './DomEvents';
import defaultModules from './defaultModules';
import EventEmitter from './EventEmitter';
import { Module, ModuleOptions, RitorOptions, DocSelection } from './types'; // DocSelection from types
import { Renderer } from './Renderer';
import { isObject } from './utils';
import { Delta, OpAttributes } from './Document'; // Import Delta instead of Document
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

    // Prepare arguments for DocumentManager constructor
    let initialDeltaForDocManager: Delta | undefined = undefined;
    // RitorOptions has initialValue: string | undefined.
    // DocumentManager expects Delta | undefined for its first argument.
    if (typeof this.options.initialValue === 'string' && this.options.initialValue.length > 0) {
        // TODO: Implement HTML string to Delta conversion here for Ritor.
        // For now, DocumentManager will start with a default empty document if a string is provided.
        console.warn(
            "Ritor constructor: this.options.initialValue is a string. " +
            "HTML-to-Delta parsing is not yet implemented. " +
            "Ritor will start with an empty document."
        );
        // initialDeltaForDocManager remains undefined, so DocumentManager creates a default document.
    } else if (this.options.initialValue === undefined || this.options.initialValue === '') {
        // initialValue is undefined or an empty string, so DocumentManager will start with a default empty document.
        console.log('Ritor constructor: initialValue is undefined or empty. DocumentManager will start with default content.');
        // initialDeltaForDocManager remains undefined.
    }
    // Note: The case where RitorOptions.initialValue could be a Delta instance is removed,
    // as RitorOptions strictly defines initialValue as string | undefined.
    // If RitorOptions were to allow initialValue: string | Delta | undefined, then:
    // else if (this.options.initialValue instanceof Delta) {
    //   initialDeltaForDocManager = this.options.initialValue;
    // }


    this.docManager = new DocumentManager(
      initialDeltaForDocManager,
      () => {
        const selection = this.cursor.getDocSelection();
        // If selection is null (e.g., editor not focused, or no valid selection),
        // return a default selection object as DocumentManager expects a DocSelection.
        return selection === null ? { index: 0, length: 0 } : selection;
      },
      (sel: DocSelection) => this.cursor.setDocSelection(sel)
    );

    this.renderer = new Renderer(this.$el);

    this.initializeModules();

    this.registerModuleShortcuts();
    this.init();
    this.initialized = true;
    this.emit('editor:init');

    // newDoc from document:change event is a Delta object { change: Delta, newDocument: Delta }
    // DocumentManager emits: this.emit('document:change', { change: finalChangeDelta, newDocument: this.currentDocument });
    this.on('document:change', (eventData: { change: Delta, newDocument: Delta, newSelection?: DocSelection }) => {
      if (this.renderer && eventData.newDocument) {
        this.renderer.render(eventData.newDocument);
        if (eventData.newSelection) {
          this.cursor.setDocSelection(eventData.newSelection);
        }
        // We might not need to emit cursor:change here if setDocSelection already does,
        // or if the natural flow of events handles it.
        // For now, keeping it to ensure UI updates if they depend on this event after render.
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
    if (!this.docManager || !selection) return {};
    return this.docManager.getFormatAt(selection.index, selection.length);
  }

  public clearFormatting(selection: DocSelection): void {
    if (!this.docManager || !selection) return;
    // Clear common formats.
    this.docManager.formatText('bold', null, selection);
    this.docManager.formatText('italic', null, selection);
    this.docManager.formatText('underline', null, selection);
    // this.docManager.formatText('strike', null, selection);
    // this.docManager.formatText('link', null, selection);
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
    const currentDocSelection = this.cursor.getDocSelection();
    if (currentDocSelection) {
      // DocumentManager's deleteText will handle 0-length selection appropriately with 'backward'
      this.docManager.deleteText('backward', currentDocSelection);
      this._isTogglingTypingAttribute = false;
    }
  }

  public handleDelete(): void {
    if (!this.docManager || !this.cursor) return;
    const currentDocSelection = this.cursor.getDocSelection();
    if (currentDocSelection) {
      // DocumentManager's deleteText will handle 0-length selection appropriately with 'forward'
      this.docManager.deleteText('forward', currentDocSelection);
      this._isTogglingTypingAttribute = false;
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
      for (const key in attributes) {
        if (Object.prototype.hasOwnProperty.call(attributes, key)) {
          this.docManager.formatText(key, attributes[key], currentDocSelection);
        }
      }
      // Note: applyFormat applies to a range, it doesn't set typing attributes directly.
    }
  }

  public getHtml(): string {
    if (!this.docManager) {
      return '';
    }
    // getDocument() now returns a Delta directly
    const currentDelta = this.docManager.getDocument();
    return Renderer.deltaToHtml(currentDelta);
  }

  public handleEnterKey(): void {
    if (!this.docManager || !this.cursor) return;
    let currentDocSelection = this.cursor.getDocSelection();
    if (!currentDocSelection) {
        // getDocument() returns a Delta, which has a length() method
        currentDocSelection = { index: this.docManager.getDocument().length(), length: 0 };
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
    // This method in DocumentManager was removed.
    // Individual attributes should be set via docManager.setTypingAttribute(key, value).
    // This Ritor method is likely called by handleCursorChangeForTypingAttributes.
    // If attrs is empty, it means clear. If not, it means set them.
    const typingKeysToManage = ['bold', 'italic', 'underline', 'strike', 'link']; // Common keys
    const newTypingAttributes: OpAttributes = {};

    for (const key of typingKeysToManage) {
        if (attrs[key] !== undefined && attrs[key] !== null) {
            this.docManager.setTypingAttribute(key, attrs[key]);
            newTypingAttributes[key] = attrs[key];
        } else {
            // If not in attrs, ensure it's cleared from current typing attributes
            this.docManager.setTypingAttribute(key, null);
        }
    }
    // Ensure an event is emitted if the behavior of setTypingAttribute itself doesn't cover all cases
    // this.docManager.emit('typingattributes:change', this.docManager.getTypingAttributes());
    // DocumentManager.setTypingAttribute already emits, so this might be redundant if called per attribute.
    // However, setTypingAttributes was meant to apply a whole set.
    // The direct emission might be needed if setTypingAttribute only emits if value *changes*.
    // Let's rely on individual setTypingAttribute emissions for now.
  }

  public toggleTypingAttribute(formatKey: string, explicitValue?: boolean | null): void {
    if (!this.docManager || !this.cursor) return;
    this._isTogglingTypingAttribute = true;

    const currentSelection = this.cursor.getDocSelection();

    if (currentSelection && currentSelection.length > 0) {
        // Range selection: apply format to the range
        const currentFormats = this.docManager.getFormatAt(currentSelection.index, currentSelection.length);
        let newValue: boolean | null;
        if (explicitValue !== undefined) {
            newValue = explicitValue;
        } else {
            // Toggle based on format at start of selection (or if the whole range has it)
            // For simplicity, toggle based on the presence of the key.
            newValue = currentFormats[formatKey] === true ? null : true;
        }
        this.docManager.formatText(formatKey, newValue, currentSelection);
    } else {
        // Collapsed selection: toggle typing attribute
        const currentTypingAttrs = this.docManager.getTypingAttributes();
        let newValue: boolean | null;
        if (explicitValue !== undefined) {
            newValue = explicitValue;
        } else {
            newValue = currentTypingAttrs[formatKey] === true ? null : true;
        }
        this.docManager.setTypingAttribute(formatKey, newValue);
    }
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
      // getFormatAt now takes (index, length)
      const formatsAtCursor = this.docManager.getFormatAt(selection.index, selection.length);
      // setTypingAttributes was refactored. We need to call it with the new object.
      this.setTypingAttributes(formatsAtCursor || {});
    } else {
      // If there's a selection (length > 0) or no selection at all, clear typing attributes
      const typingKeysToClear = ['bold', 'italic', 'underline', 'strike', 'link'];
      const emptyAttrs: OpAttributes = {};
      for (const key of typingKeysToClear) {
        emptyAttrs[key] = null; // Explicitly set to null to ensure clearing
      }
      this.setTypingAttributes(emptyAttrs); // Call the refactored setTypingAttributes
    }
  }
}

export default Ritor;
