// src/DomEvents.ts
import Ritor from './Ritor';

class DomEvents {
  private ritor: Ritor;

  constructor(ritor: Ritor) {
    this.ritor = ritor;
  }

  public handleMouseUp() {
    // Debounce or use setTimeout to ensure selection is updated
    setTimeout(() => {
      this.ritor.emit('cursor:change');
    }, 0);
  }

  public handleKeydown(e: KeyboardEvent) {
    this.ritor.emit('keydown', e); // Emit raw keydown event for modules or Ritor to act upon

    // Example: Intercepting Enter key for basic paragraph handling (conceptual)
    // if (e.key === 'Enter') {
    //   e.preventDefault();
    //   this.ritor.handleEnterKey(); // Ritor would then use DocumentManager
    // }

    // Basic printable characters (simplified - does not handle all cases)
    // `beforeinput` is generally better for this.
    if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1) {
      // This is a very simplified way to capture character input.
      // `beforeinput` event is preferred for text input.
      // e.preventDefault(); // Important if we are handling it fully
      // this.ritor.handleCharacterInput(e.key);
    }

    // Let Ritor decide how to handle backspace, delete, etc.
    if (e.key === 'Backspace') {
      // e.preventDefault(); // Prevent default backspace
      // this.ritor.handleBackspace();
    }
    if (e.key === 'Delete') {
      // e.preventDefault(); // Prevent default delete
      // this.ritor.handleDelete();
    }

    // Trigger cursor change on keydown as well, as it might affect selection/cursor position
    // especially for non-printable keys like arrows.
    setTimeout(() => {
      this.ritor.emit('cursor:change');
    }, 0);
  }

  public handleBeforeInput(e: InputEvent) {
    this.ritor.emit('beforeinput', e); // Emit raw event

    // Modern way to handle text input
    if (e.inputType === 'insertText' && e.data) {
      e.preventDefault();
      this.ritor.handleCharacterInput(e.data);
    } else if (e.inputType === 'deleteContentBackward') {
      e.preventDefault();
      this.ritor.handleBackspace();
    } else if (e.inputType === 'deleteContentForward') {
      e.preventDefault();
      this.ritor.handleDelete();
    }
    // Add handlers for other inputTypes like insertParagraph, formatBold, etc.
    // e.g., if (e.inputType === 'insertParagraph') { e.preventDefault(); this.ritor.handleEnterKey(); }
  }

  public handlePaste(e: ClipboardEvent) {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain');
    if (text) {
      this.ritor.handlePasteText(text);
    }
    this.ritor.emit('paste', e);
  }

  public handleDoubleClick(e: MouseEvent) {
    this.ritor.emit('dblclick', e);
  }

  public handleOutsideDragAndDrop(e: DragEvent) {
    this.ritor.emit('contentoutside:dragdrop', e);
  }
}

export default DomEvents;
