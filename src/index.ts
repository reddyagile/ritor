import Ritor from './Ritor';
import Bold from './modules/Bold';
import Italic from './modules/Italic';
import Underline from './modules/Underline';
import ClearFormat from './modules/ClearFormat';
import ViewSource from './modules/ViewSource';
import './index.scss';

// Register modules with Ritor
Ritor.register('bold', Bold);
Ritor.register('italic', Italic);
Ritor.register('underline', Underline);
Ritor.register('clearFormat', ClearFormat);
Ritor.register('viewSource', ViewSource);

// Example HTML structure this might expect for toolbar:
// <div id="toolbar"> <!-- Ritor's overall toolbar selector from options -->
//   <button class="r-bold">B</button>
//   <button class="r-italic">I</button>
//   <button class="r-underline">U</button>
//   <button class="r-clear">Clear</button>
//   <button class="r-view-source">View Source</button> <!-- Assuming .r-view-source -->
// </div>
// <div id="editable"></div> <!-- Editor target -->
// <div id="output"></div> <!-- For ViewSource -->


function init() {
  const ritor = new Ritor('#editable', {
    toolbar: '#toolbar', // Main toolbar container selector
    placeholder: 'Start typing...',
    initialValue: '<p>Hello <b>World</b>!</p>',
    modules: {
      bold: {
        moduleName: 'bold', // Ensure moduleName matches the key
        toolbar: '.r-bold', // Selector for the bold button within the main toolbar
        shortcutKey: 'ctrl+b.prevent' // Standardized format
      },
      italic: {
        moduleName: 'italic',
        toolbar: '.r-italic',
        shortcutKey: 'ctrl+i.prevent'
      },
      underline: {
        moduleName: 'underline',
        toolbar: '.r-underline',
        shortcutKey: 'ctrl+u.prevent'
      },
      clearFormat: {
        moduleName: 'clearFormat',
        toolbar: '.r-clear'
        // No shortcutKey defined here, but could be added
      },
      viewSource: {
        moduleName: 'viewSource', // Add moduleName
        toolbar: '.r-view-source', // Assuming a class for the view source button
        target: '#output', // Specific option for ViewSource module
      },
    },
  });

  document.getElementById('destroy')?.addEventListener('click', () => {
    ritor.destroy();
  });

  document.getElementById('reinit')?.addEventListener('click', () => {
    ritor.reInit();
  });
}

// Defer initialization until the DOM is ready
if (document.readyState === 'loading') {  // Loading hasn't finished yet
  document.addEventListener('DOMContentLoaded', init);
} else {  // `DOMContentLoaded` has already fired
  init();
}
