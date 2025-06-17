// src/modules/Bold.ts
import Ritor from '../Ritor';
import BaseModule from './BaseModule';
import { ModuleOptions } from '../types';

class Bold extends BaseModule {
  public shortcutKey = 'ctrl:KeyB.prevent';

  constructor(ritor: Ritor, options: ModuleOptions) {
    super(ritor, {
      ...options, // This options object should now correctly contain 'toolbar'
      moduleName: 'bold', // Overrides if 'moduleName' was in options, which is fine
      formatAttributeKey: 'bold'
    });
  }
}
export default Bold;
