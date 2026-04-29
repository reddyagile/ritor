// src/DomEvents.ts
import Ritor from './Ritor';
import InputController from './core/InputController';

class DomEvents {
  private ritor: Ritor;
  private inputController: InputController;

  constructor(ritor: Ritor, inputController: InputController) {
    this.ritor = ritor;
    this.inputController = inputController;
  }

  public handleMouseUp() {
    setTimeout(() => {
      this.ritor.emit('cursor:change');
    }, 0);
  }

  public handleKeydown(e: KeyboardEvent) {
    this.inputController.handleKeydown(e);
  }

  public handleBeforeInput(e: InputEvent) {
    this.inputController.handleBeforeInput(e);
  }

  public handlePaste(e: ClipboardEvent) {
    this.inputController.handlePaste(e);
  }

  public handleDoubleClick(e: MouseEvent) {
    this.ritor.emit('dblclick', e);
  }

  public handleOutsideDragAndDrop(e: DragEvent) {
    this.ritor.emit('contentoutside:dragdrop', e);
  }
}

export default DomEvents;
