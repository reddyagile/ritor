// src/modules/ClearFormat.ts
import Ritor from '../Ritor';
import BaseModule from './BaseModule';
import { ModuleOptions } from '../types';
import { DocSelection } from '../DocumentManager'; // Import DocSelection

class ClearFormat extends BaseModule {
  constructor(ritor: Ritor, options: ModuleOptions) {
    // Provide a dummy formatAttributeKey or modify BaseModule to not require it
    // if a module doesn't deal with a single toggleable format.
    // Or, ClearFormat doesn't need to extend BaseModule if its behavior is too different.
    // For now, let's assume BaseModule's click/active state isn't used by ClearFormat directly.
    super(ritor, { ...options, moduleName: 'clearFormat', formatAttributeKey: '_clear' }); // Use a dummy key
  }

  // Override handleClick if BaseModule's version is not suitable
  public handleClick() { // Renaming from 'click' to 'handleClick' for consistency
    const domRange = this.ritor.getCurrentDomRange();
    if (!domRange) return; // Nothing to clear if no range

    const docSelection = this.ritor.domRangeToDocSelection(domRange);
    if (docSelection) { // If selection is valid (even collapsed, clear typing attrs future)
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
