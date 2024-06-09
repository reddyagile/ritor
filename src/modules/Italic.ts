import Ritor from '../Ritor';
import BaseModule from './BaseModule';
import { ModuleOptions } from '../types';

class Italic extends BaseModule {
  private static toolbar = '.r-italic';
  public static tagName = 'em';
  public shortcutKey = 'ctrl:KeyI.prevent';

  constructor(ritor: Ritor, options: ModuleOptions) {
    super(ritor, { ...options, toolbar: Italic.toolbar, tagName: Italic.tagName });
  }
}

export default Italic;
