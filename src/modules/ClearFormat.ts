import Ritor from '../Ritor';
import { ModuleOptions } from '../types';
import BaseModule from './BaseModule';

class ClearFormat extends BaseModule {
  public static toolbar = '.r-clear';

  constructor(ritor: Ritor, options: ModuleOptions) {
    super(ritor, { ...options, toolbar: ClearFormat.toolbar });
  }

  click() {
    const content = this.ritor.getContent();
    content?.removeFormatting();
  }
}

export default ClearFormat;
