import Ritor from '../Ritor';
import BaseModule from './BaseModule';
import { ModuleOptions } from '../types';

class Bold extends BaseModule {
  public static toolbar = '.r-bold';
  public static tagName = 'strong';
  public shortcutKey = 'ctrl:KeyB.prevent';

  constructor(ritor: Ritor, options: ModuleOptions) {
    super(ritor, { ...options, toolbar: Bold.toolbar, tagName: Bold.tagName });
  }
}

export default Bold;
