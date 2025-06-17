// src/modules/Bold.ts
import Ritor from '../Ritor';
import BaseModule from './BaseModule';
import { ModuleOptions } from '../types'; // Ensure ModuleOptions can hold formatAttributeKey

class Bold extends BaseModule {
  // public static toolbar = '.r-bold'; // Defined in Ritor options now
  // public static tagName = 'strong'; // Not directly used by BaseModule for formatting anymore
  public shortcutKey = 'ctrl:KeyB.prevent'; // Shortcut handling will need adjustment

  constructor(ritor: Ritor, options: ModuleOptions) {
    // Options should include: { moduleName: 'bold', toolbar: '.r-bold', formatAttributeKey: 'bold' }
    // The 'formatAttributeKey' is new and important.
    // BaseModule expects moduleName to be part of the options passed to it.
    super(ritor, { ...options, moduleName: 'bold', formatAttributeKey: 'bold' });
  }
}

export default Bold;
