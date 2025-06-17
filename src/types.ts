import Ritor from './Ritor';

export interface ModuleOptions {
  moduleName: string; // Standardized name for the module
  toolbar?: string; // CSS selector for the toolbar button
  tagName?: string; // HTML tag name, e.g., 'strong', 'em' (kept for now)
  formatAttributeKey?: string; // Key for OpAttributes, e.g., "bold", "italic"
  shortcutKey?: string; // e.g. ctrl:KeyB.prevent
  [key: string]: any; // Allow other module-specific options
}

export interface Modules {
  [moduleName: string]: ModuleOptions;
}

export interface RitorOptions {
  toolbar?: string;
  placeholder?: string;
  initialValue?: string;
  modules?: Modules;
}

export type Module<T> = new (ritor: Ritor, options: ModuleOptions) => T;
