import Ritor from './Ritor';
import ViewSource from './modules/ViewSource';
import './index.scss';

Ritor.register('viewSource', ViewSource);

function init() {
  const ritor = new Ritor('#editable', {
    toolbar: '#toolbar',
    placeholder: '',
    initialValue: '',
    modules: {
      viewSource: {
        target: '#output',
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
init();
