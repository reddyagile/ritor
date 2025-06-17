import DocumentManager from './DocumentManager';
import DomEvents from './DomEvents';
import defaultModules from './defaultModules';
import EventEmitter from './EventEmitter';
import { Module, RitorOptions } from './types';
import { Renderer } from './Renderer';
import { isObject } from './utils';
import DocumentManager, { DocSelection } from './DocumentManager'; // Updated import
import { Document, OpAttributes } from './Document'; // Ensured Document is imported correctly
import { ModuleOptions, RitorOptions } from './types'; // Ensure RitorOptions is also there if used

class Ritor extends EventEmitter {
  private static modules = new Map();
  private domEventMap = new Map();
  private options: RitorOptions = {
    modules: {},
  };
  private shortcuts: Map<string, string> = new Map(); // Map of key combo to moduleName
  private initialized: boolean;

  public $el: HTMLElement;
  public moduleInstances = new Map();
  private docManager: DocumentManager;
  private renderer: Renderer;

  constructor(target: string, options?: RitorOptions) {
    super();

    if (!target) throw new Error('Target selector is required.');

    const targetElem = document.querySelector(target) as HTMLElement;
    if (!targetElem) throw new Error('Target element not found.');

    this.$el = targetElem;

    if (isObject(options)) {
      this.options = Object.assign({}, this.options, options);
    }
    this.options.modules = Object.assign(
      {},
      isObject(this.options.modules) ? this.options.modules : {},
      this.initializeDefaultModules(),
    );
    this.docManager = new DocumentManager(this);
    this.renderer = new Renderer(this);
    this.initializeModules();
    this.registerModuleShortcuts(); // Register shortcuts after modules are initialized
    this.init(); // init sets up DomEvents listeners, including the one that emits 'keydown'
    this.initialized = true;
    this.emit('editor:init'); // Initial event

    // Listen for document changes to re-render
    // Remove old listener if any to be safe, then add the new one
    this.off('document:change');
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
    const config: { [key: string]: {} } = {};
    for (const [key, module] of Object.entries(defaultModules)) {
      Ritor.register(key, module);
      config[key] = {};
    }
    return config;
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

  private initializeModules() { // Ensure this method exists and is called
    const modules = this.options.modules;
    modules &&
      Object.keys(modules).forEach((moduleName) => {
        const moduleConfig = Ritor.modules.get(moduleName); // Get from static registry
        if (moduleConfig && moduleConfig.moduleClass) {
          // Pass the specific module options from Ritor's options
          const moduleSpecificOptions = modules[moduleName] || {}; // User options for this instance

          // Prioritize shortcut from user options, then from module's static property
          let shortcutKey = moduleSpecificOptions.shortcutKey;
          if (!shortcutKey && moduleConfig.moduleClass.hasOwnProperty('shortcutKey')) {
            shortcutKey = (moduleConfig.moduleClass as any).shortcutKey;
          } else if (!shortcutKey && moduleConfig.moduleClass.prototype.hasOwnProperty('shortcutKey')) {
            // Check prototype if it's an instance property on the class, though static is preferred
             shortcutKey = (moduleConfig.moduleClass.prototype as any).shortcutKey;
          }


          const fullModuleOptions: ModuleOptions = {
            ...moduleSpecificOptions, // User-provided options for this module instance
            moduleName: moduleName, // Ensure moduleName is part of options passed to BaseModule
            shortcutKey: shortcutKey, // Explicitly set shortcutKey
          };

          this.moduleInstances.set(moduleName, new moduleConfig.moduleClass(this, fullModuleOptions));
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
