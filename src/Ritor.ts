import Content from './Content';
import DomEvents from './DomEvents';
import defaultModules from './defaultModules';
import EventEmitter from './EventEmitter';
import { Module, RitorOptions } from './types';
import { isObject } from './utils';

class Ritor extends EventEmitter {
  private static modules = new Map();
  private domEventMap = new Map();
  private options: RitorOptions = {
    modules: {},
  };
  private initialized: boolean;

  public $el: HTMLElement;
  public moduleInstances = new Map();

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
    this.initializeModules();
    this.init();
    this.initialized = true;
    this.emit('editor:init');
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

  private initializeModules() {
    const modules = this.options.modules;
    modules &&
      Object.keys(modules).forEach((moduleName) => {
        const module = Ritor.getModule(moduleName);
        if (module) {
          this.moduleInstances.set(moduleName, new module.moduleClass(this, { ...modules[moduleName], moduleName }));
        }
      });
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

  public getContent() {
    const content = new Content(this);
    if (this.$el && content.cursor.isWithin(this.$el)) {
      return content;
    } else {
      return null;
    }
  }

  public getHtml() {
    // Clean up empty tags except self closing tags
    // Clean up code added by extensions like grammarly
    return this.$el?.innerHTML;
  }
}

export default Ritor;
