// src/modules/Underline.ts
import Ritor from '../Ritor';
import BaseModule from './BaseModule';
import { ModuleOptions } from '../types';

class Underline extends BaseModule {
  public shortcutKey = 'ctrl:KeyU.prevent';

  constructor(ritor: Ritor, options: ModuleOptions) {
    super(ritor, { ...options, moduleName: 'underline', formatAttributeKey: 'underline' });
  }
}

export default Underline;
