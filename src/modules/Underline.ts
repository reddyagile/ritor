import Ritor from '../Ritor';
import BaseModule from './BaseModule';
import { ModuleOptions } from '../types';

class Underline extends BaseModule {
  private static toolbar = '.r-underline';
  public static tagName = 'u';
  public shortcutKey = 'ctrl:KeyU.prevent';

  constructor(ritor: Ritor, options: ModuleOptions) {
    super(ritor, { ...options, toolbar: Underline.toolbar, tagName: Underline.tagName });
  }
}

export default Underline;
