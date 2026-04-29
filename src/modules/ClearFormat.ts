// src/modules/ClearFormat.ts
import Ritor from '../Ritor';
import BaseModule from './BaseModule';
import { ModuleOptions } from '../types';

class ClearFormat extends BaseModule {
  constructor(ritor: Ritor, options: ModuleOptions) {
    super(ritor, {
      ...options,
      moduleName: 'clearFormat',
    });
  }

  public handleClick() {
    const domRange = this.ritor.getCurrentDomRange();
    if (!domRange) return;

    const docSelection = this.ritor.domRangeToDocSelection(domRange);
    if (docSelection && docSelection.length > 0) {
      this.ritor.clearFormatting(docSelection);
    }
  }

  public updateActiveState() {
    this.toggleActive(false);
  }
}
export default ClearFormat;
