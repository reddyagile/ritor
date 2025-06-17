// src/modules/ClearFormat.ts
import Ritor from '../Ritor';
import BaseModule from './BaseModule';
import { ModuleOptions } from '../types';
// DocSelection import was removed as it's not directly used here.

class ClearFormat extends BaseModule {
  constructor(ritor: Ritor, options: ModuleOptions) {
    super(ritor, {
      ...options,
      moduleName: 'clearFormat'
      // formatAttributeKey is not typically used by ClearFormat in the same way,
      // but BaseModule expects it if its handleClick/updateActiveState were used.
      // Since ClearFormat overrides these, it might not need a real formatAttributeKey.
      // Passing options.formatAttributeKey (which would be undefined if not set in index.ts)
      // or a dummy one like '_clear' (as done previously) is fine.
      // For consistency with the pattern:
      // formatAttributeKey: options.formatAttributeKey || '_clear_dummy',
    });
  }

  // Override handleClick if BaseModule's version is not suitable
  public handleClick() {
    const domRange = this.ritor.getCurrentDomRange();
    if (!domRange) return; // Nothing to clear if no range

    const docSelection = this.ritor.domRangeToDocSelection(domRange);
    if (docSelection) {
        if (docSelection.length > 0) { // Only clear for actual selections for now
             this.ritor.clearFormatting(docSelection);
        } else {
            // Future: Could clear typing attributes if selection is collapsed
        }
    }
  }

  // ClearFormat typically doesn't have an "active" state based on current format.
  // So, override updateActiveState to do nothing or always be inactive.
  public updateActiveState() {
    this.toggleActive(false); // ClearFormat button is not a toggle state
  }
}
export default ClearFormat;
