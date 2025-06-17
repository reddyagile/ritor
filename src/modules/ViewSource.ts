// src/modules/ViewSource.ts
import Ritor from '../Ritor';
import { ModuleOptions } from '../types';
import { Document } from '../Document'; // Import Document type

class ViewSource {
  constructor(ritor: Ritor, options: ModuleOptions) {
    const outputEl = options.target && (document.querySelector(options.target) as HTMLTextAreaElement);

    const updateSourceView = () => {
      if (outputEl) {
        // getHtml now derives from the model, so it's the correct source of truth
        outputEl.value = ritor.getHtml() || '';
      }
    };

    // Listen to 'document:change' instead of 'input:change'
    // The newDoc argument isn't strictly needed here if getHtml() always gets the latest
    ritor.on('document:change', (newDoc: Document /*, newSelection?: DocSelection */) => {
      updateSourceView();
    });

    ritor.on('editor:init', () => {
      updateSourceView();
    });
  }
}

export default ViewSource;
