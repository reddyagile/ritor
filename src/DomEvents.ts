// src/DomEvents.ts
import Ritor from './Ritor';

class DomEvents {
  private ritor: Ritor;

  constructor(ritor: Ritor) {
    this.ritor = ritor;
  }

  public handleMouseUp() {
    setTimeout(() => {
      this.ritor.emit('cursor:change');
    }, 0);
  }

  public handleKeydown(e: KeyboardEvent) {
    this.ritor.emit('keydown', e);

    // Fallback for Enter key if not handled by beforeinput or if beforeinput is not supported/fired.
    // If beforeinput handles 'insertParagraph' and calls preventDefault, this might not run
    // or its preventDefault might not matter.
    // For simplicity, we can have it here. If both fire and preventDefault, it's usually fine.
    if (e.key === 'Enter' && !e.defaultPrevented) { // Check if already handled
      // Check for Shift+Enter for potential <br> insertion (future feature, not handled now)
      // if (e.shiftKey) {
      //   this.ritor.handleShiftEnterKey(); // Placeholder for future
      //   return;
      // }
      e.preventDefault(); // Prevent default paragraph or div insertion by contentEditable
      this.ritor.handleEnterKey();
    }

    if (e.key === 'Backspace' && !e.defaultPrevented) {
      // This was previously handled by handleBeforeInput's deleteContentBackward.
      // If we want keydown to also trigger it as a fallback or primary:
      // e.preventDefault();
      // this.ritor.handleBackspace();
    }
    if (e.key === 'Delete' && !e.defaultPrevented) {
      // Similar for Delete
      // e.preventDefault();
      // this.ritor.handleDelete();
    }

    setTimeout(() => {
      this.ritor.emit('cursor:change');
    }, 0);
  }

  public handleBeforeInput(e: InputEvent) {
    this.ritor.emit('beforeinput', e);

    if (e.inputType === 'insertParagraph') {
      e.preventDefault();
      this.ritor.handleEnterKey();
    } else if (e.inputType === 'insertText' && e.data) {
      e.preventDefault();
      this.ritor.handleCharacterInput(e.data);
    } else if (e.inputType === 'deleteContentBackward') {
      e.preventDefault();
      this.ritor.handleBackspace();
    } else if (e.inputType === 'deleteContentForward') {
      e.preventDefault();
      this.ritor.handleDelete();
    }
    // Other inputTypes can be handled here as features are added (e.g., formatBold, historyUndo etc.)
  }

  public handlePaste(e: ClipboardEvent) {
    e.preventDefault(); // Prevent default paste behavior
    const text = e.clipboardData?.getData('text/plain');
    // Future: Could also get 'text/html' and parse it into a Delta.
    if (text) {
      this.ritor.handlePasteText(text); // Ritor will use DocumentManager to insert
    }
    this.ritor.emit('paste', e); // Emit paste event for other potential listeners
  }

  public handleDoubleClick(e: MouseEvent) {
    this.ritor.emit('dblclick', e);
  }

  public handleOutsideDragAndDrop(e: DragEvent) {
    this.ritor.emit('contentoutside:dragdrop', e);
  }
}

export default DomEvents;
