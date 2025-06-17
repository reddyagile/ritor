// src/modules/Bold.ts
import Ritor from '../Ritor';
import BaseModule from './BaseModule';
import { ModuleOptions } from '../types';

class Bold extends BaseModule {
  public shortcutKey = 'ctrl:KeyB.prevent';

  constructor(ritor: Ritor, options: ModuleOptions) {
    super(ritor, {
      ...options, // Spread incoming options
      toolbar: options.toolbar, // Explicitly pass toolbar from incoming options
      moduleName: 'bold',
      formatAttributeKey: 'bold'
    });
  }
}
export default Bold;
