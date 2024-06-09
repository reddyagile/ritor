import BaseModule from './modules/BaseModule';
import Bold from './modules/Bold';
import ClearFormat from './modules/ClearFormat';
import Italic from './modules/Italic';
import Underline from './modules/Underline';
import { Module } from './types';

interface ModuleMap<T> {
  [key: string]: Module<T>;
}

const defaultModules: ModuleMap<BaseModule> = {
  bold: Bold,
  clearFormat: ClearFormat,
  italic: Italic,
  underline: Underline,
};

export default defaultModules;
