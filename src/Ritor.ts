// src/Ritor.ts
import DocumentManager, { DocSelection } from './DocumentManager'; // Consolidated: default DocumentManager and named DocSelection
import DomEvents from './DomEvents';
import defaultModules from './defaultModules';
import EventEmitter from './EventEmitter';
import { Module, ModuleOptions, RitorOptions } from './types'; // Consolidated: Module, ModuleOptions, RitorOptions
import { Renderer } from './Renderer';
import { isObject } from './utils';
// Document is imported separately, ensure it's not duplicated if it was part of the problem list
import { Document, OpAttributes } from './Document';

class Ritor extends EventEmitter {
  private static modules = new Map();
  private domEventMap = new Map();
  // `options` will hold the merged configuration.
  private options: RitorOptions; // No longer initialized here with a default.
  private shortcuts: Map<string, string> = new Map();
  private initialized: boolean;

  public $el: HTMLElement;
  public moduleInstances = new Map();
  private docManager: DocumentManager;
  private renderer: Renderer;

  constructor(target: string, userProvidedOptions?: RitorOptions) { // Renamed to userProvidedOptions for clarity
    super();

    if (!target) throw new Error('Target selector is required.');
    const targetElem = document.querySelector(target) as HTMLElement;
    if (!targetElem) throw new Error('Target element not found.');
    this.$el = targetElem;

    // Define Ritor's internal defaults, especially for the modules object.
    const defaultInternalOptions: RitorOptions = { modules: {} };
    // Merge user-provided options into these defaults. User options take precedence.
    this.options = Object.assign({}, defaultInternalOptions, userProvidedOptions);
    // Ensure this.options.modules itself is an object, even if userProvidedOptions was undefined or had no modules key.
    this.options.modules = this.options.modules || {};

    // Call initializeDefaultModules primarily for Ritor.register.
    // It no longer returns a conflicting module configuration.
    this.initializeDefaultModules();

    this.docManager = new DocumentManager(this);
    this.renderer = new Renderer(this);

    // initializeModules will now use the correctly merged this.options.modules
    this.initializeModules();

    this.registerModuleShortcuts();
    this.init();
    this.initialized = true;
    this.emit('editor:init'); // Initial event

    // Listen for document changes to re-render
    this.on('document:change', (newDoc: Document, newSelection?: DocSelection) => { // newSelection is optional
      if (this.renderer && newDoc) {
        this.renderer.render(newDoc); // Render the new document
        if (newSelection && this.docManager) { // Check if docManager exists
          const domRange = this.docManager.docSelectionToDomRange(newSelection);
          if (domRange) {
            this.docManager.cursor.setRange(domRange);
          }
        }
        this.emit('cursor:change');
      }
    });

    // Listen to keydown events (emitted by DomEvents.ts)
    this.on('keydown', this.handleGlobalKeydown.bind(this));

    // Perform initial render
    if(this.docManager && this.renderer) {
        this.renderer.render(this.docManager.getDocument());
    }
  }

  private initializeDefaultModules() {
    // This method should ONLY register modules. It should NOT return a config.
    for (const [key, module] of Object.entries(defaultModules)) {
      if (!Ritor.modules.has(key)) { // Optional: prevent re-registering if called multiple times
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
    const modulesConfig = this.options.modules; // This should now be the user's config from index.ts
    modulesConfig &&
      Object.keys(modulesConfig).forEach((moduleName) => {
        const moduleStaticConfig = Ritor.modules.get(moduleName);
        if (moduleStaticConfig && moduleStaticConfig.moduleClass) {
          const userModuleOptions = modulesConfig[moduleName] || {}; // This IS the config from index.ts for this module

          let shortcutKey = userModuleOptions.shortcutKey;
          // ... (shortcut key fallback logic remains same) ...
          if (!shortcutKey && moduleStaticConfig.moduleClass.hasOwnProperty('shortcutKey')) {
            shortcutKey = (moduleStaticConfig.moduleClass as any).shortcutKey;
          } else if (!shortcutKey && moduleStaticConfig.moduleClass.prototype.hasOwnProperty('shortcutKey')) {
             shortcutKey = (moduleStaticConfig.moduleClass.prototype as any).shortcutKey;
          }

          // userModuleOptions already contains moduleName if provided from index.ts,
          // and also toolbar, etc.
          const fullModuleOptions: ModuleOptions = {
            ...userModuleOptions, // This contains toolbar, moduleName (from index.ts)
            moduleName: moduleName, // Ensures moduleName is the key from the loop (consistent)
            shortcutKey: shortcutKey, // Resolved shortcutKey
          };

          this.moduleInstances.set(moduleName, new moduleStaticConfig.moduleClass(this, fullModuleOptions));
        }
      });
  }

  private registerModuleShortcuts() {
    this.moduleInstances.forEach((moduleInstance, moduleName) => {
      // Assume moduleInstance.options.shortcutKey is where shortcut is defined
      // This was set up in BaseModule's constructor options.
      const shortcutKey = moduleInstance.options?.shortcutKey;
      if (shortcutKey) {
        // Normalize the key for map storage, e.g., 'ctrl+b'
        const normalizedKey = this.normalizeShortcutKey(shortcutKey);
        this.shortcuts.set(normalizedKey, moduleName);
      }
    });
  }

  private normalizeShortcutKey(shortcut: string): string {
    const parts = shortcut.toLowerCase().split(/[:.+]/).filter(k => k !== 'prevent' && k !== 'stop');
    parts.sort(); // Ensure consistent order, e.g., 'ctrl+b' vs 'b+ctrl'
    return parts.join('+');
  }

  private handleGlobalKeydown(e: KeyboardEvent) {
    const keyString = [];
    if (e.ctrlKey || e.metaKey) keyString.push('ctrl'); // Treat Meta as Ctrl for common shortcuts
    if (e.shiftKey) keyString.push('shift');
    if (e.altKey) keyString.push('alt');
    keyString.push(e.key.toLowerCase());

    const normalizedPressedKey = this.normalizeShortcutKey(keyString.join('+'));

    if (this.shortcuts.has(normalizedPressedKey)) {
      const moduleName = this.shortcuts.get(normalizedPressedKey);
      if (moduleName) {
        const moduleInstance = this.moduleInstances.get(moduleName);
        if (moduleInstance && typeof moduleInstance.handleClick === 'function') {
          // Check if shortcut definition requested preventDefault
          const originalShortcutDef = moduleInstance.options?.shortcutKey;
          if (originalShortcutDef && originalShortcutDef.includes('.prevent')) {
            e.preventDefault();
          }
          if (originalShortcutDef && originalShortcutDef.includes('.stop')) {
            e.stopPropagation(); // Though less common for contentEditable shortcuts
          }
          moduleInstance.handleClick(); // Call the module's action handler
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
    // As per instructions, Ritor now holds an instance of DocumentManager created in the constructor.
    // This method should simply return that instance.
    // The check `this.docManager.cursor.isWithin(this.$el)` can be removed for now or handled by the caller if needed.
    return this.docManager;
  }

  public getCurrentDomRange(): Range | null {
    if (!this.docManager) return null;
    return this.docManager.cursor.getRange();
  }

  public domRangeToDocSelection(range: Range): DocSelection | null {
      if (!this.docManager) return null;
      return this.docManager.domRangeToDocSelection(range);
  }

  public getFormatAt(selection: DocSelection): OpAttributes {
    if (!this.docManager) return {};
    return this.docManager.getFormatAt(selection);
  }

  // applyFormat(attributes: OpAttributes) already exists and is public.

  // Method for ClearFormat module
  public clearFormatting(selection: DocSelection): void {
      if (!this.docManager) return;
      // DocumentManager needs a method like clearFormat(selection)
      // which would create a Delta with {attributes: null} for all keys in the range
      this.docManager.clearFormat(selection);
  }

  public handleCharacterInput(char: string): void {
    if (!this.docManager) return;
    const domRange = this.docManager.cursor.getRange();
    if (!domRange) return;

    const currentDocSelection = this.docManager.domRangeToDocSelection(domRange);
    if (currentDocSelection) {
      this.docManager.insertText(char, currentDocSelection);
      // docManager.insertText will emit 'document:change' which Ritor listens to
      // for rendering and selection update.
    }
  }

  public handleBackspace(): void {
    if (!this.docManager) return;
    const domRange = this.docManager.cursor.getRange();
    if (!domRange) return;

    let currentDocSelection = this.docManager.domRangeToDocSelection(domRange);
    if (currentDocSelection) {
      if (currentDocSelection.length === 0 && currentDocSelection.index > 0) {
        // Typical backspace behavior: delete character before cursor
        currentDocSelection.index -= 1;
        currentDocSelection.length = 1;
      }
      if (currentDocSelection.length > 0) {
        this.docManager.deleteText(currentDocSelection);
      }
    }
  }

  public handleDelete(): void {
    if (!this.docManager) return;
    const domRange = this.docManager.cursor.getRange();
    if (!domRange) return;

    let currentDocSelection = this.docManager.domRangeToDocSelection(domRange);
    if (currentDocSelection) {
      if (currentDocSelection.length === 0) {
        // Typical delete behavior: delete character after cursor
        currentDocSelection.length = 1;
      }
      if (currentDocSelection.length > 0) {
        this.docManager.deleteText(currentDocSelection);
      }
    }
  }

  public handlePasteText(text: string): void {
    if (!this.docManager) return;
    const domRange = this.docManager.cursor.getRange();
    if (!domRange) return;
    const currentDocSelection = this.docManager.domRangeToDocSelection(domRange);
    if (currentDocSelection) {
      // For simplicity, this is like insertText. A real paste might involve
      // parsing HTML content and creating a more complex Delta.
      this.docManager.insertText(text, currentDocSelection);
    }
  }

  // Example of a method modules might call later
  public applyFormat(attributes: OpAttributes) {
    if (!this.docManager) return;
    const domRange = this.docManager.cursor.getRange();
    if (!domRange || domRange.collapsed) return; // Need a selection to format

    const currentDocSelection = this.docManager.domRangeToDocSelection(domRange);
    if (currentDocSelection && currentDocSelection.length > 0) {
      this.docManager.formatText(attributes, currentDocSelection);
    }
  }

  public getHtml(): string {
    if (!this.docManager) {
      return '';
    }
    const currentDelta = this.docManager.getDocument().getDelta();
    return Renderer.deltaToHtml(currentDelta);
  }
}

export default Ritor;
