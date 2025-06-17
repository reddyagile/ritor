// src/modules/Italic.ts
import Ritor from '../Ritor';
import BaseModule from './BaseModule';
import { ModuleOptions } from '../types';

class Italic extends BaseModule {
  public shortcutKey = 'ctrl:KeyI.prevent';

  constructor(ritor: Ritor, options: ModuleOptions) {
    super(ritor, {
      ...options,
      moduleName: 'italic',
      formatAttributeKey: 'italic'
    });
  }
}
export default Italic;
