import Ritor from './Ritor';

export interface ModuleOptions {
  [key: string]: any;
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
