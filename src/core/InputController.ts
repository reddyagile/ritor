import Ritor from '../Ritor';

class InputController {
  private ritor: Ritor;

  constructor(ritor: Ritor) {
    this.ritor = ritor;
  }

  public handleKeydown(e: KeyboardEvent): void {
    this.ritor.emit('keydown', e);

    // Fallback for Enter if beforeinput is unavailable or did not run.
    if (e.key === 'Enter' && !e.defaultPrevented) {
      e.preventDefault();
      if (this.ritor.isEnterKeyAllowed()) {
        this.ritor.handleEnterKey();
      }
    }

    setTimeout(() => {
      this.ritor.emit('cursor:change');
    }, 0);
  }

  public handleBeforeInput(e: InputEvent): void {
    this.ritor.emit('beforeinput', e);

    if (e.inputType === 'insertParagraph') {
      e.preventDefault();
      if (this.ritor.isEnterKeyAllowed()) {
        this.ritor.handleEnterKey();
      }
      return;
    }

    if (e.inputType === 'insertText' && e.data) {
      e.preventDefault();
      this.ritor.handleCharacterInput(e.data);
      return;
    }

    if (e.inputType === 'deleteContentBackward') {
      e.preventDefault();
      this.ritor.handleBackspace();
      return;
    }

    if (e.inputType === 'deleteContentForward') {
      e.preventDefault();
      this.ritor.handleDelete();
    }
  }

  public handlePaste(e: ClipboardEvent): void {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain');
    if (text) {
      this.ritor.handlePasteText(text);
    }
    this.ritor.emit('paste', e);
  }
}

export default InputController;
