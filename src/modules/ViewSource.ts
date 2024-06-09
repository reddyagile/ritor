import Ritor from '../Ritor';
import { ModuleOptions } from '../types';

class ViewSource {
  constructor(ritor: Ritor, options: ModuleOptions) {
    const outputEl = options.target && (document.querySelector(options.target) as HTMLTextAreaElement);

    ritor.on('input:change', () => {
      if (outputEl) {
        outputEl.value = ritor.getHtml() || '';
      }
    });

    ritor.on('editor:init', () => {
      if (outputEl) {
        outputEl.value = ritor.getHtml() || '';
      }
    })
  }
}

export default ViewSource;
