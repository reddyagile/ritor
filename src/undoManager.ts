// src/undoManager.ts

// Assuming DocNode is the root node type from your document model.
// We use BaseNode as DocNode is compatible with it and represents the whole document.
import { BaseNode as DocNode } from './documentModel.js';

export class UndoManager {
  private undoStack: DocNode[] = [];
  private redoStack: DocNode[] = [];
  private maxHistory: number = 100;

  constructor(maxHistory?: number) {
    if (maxHistory !== undefined) {
      this.maxHistory = maxHistory;
    }
  }

  /**
   * Adds a new document state to the undo history.
   * This should be called *before* the change is applied to the current document.
   * The `doc` parameter should be the state of the document *before* the new change.
   * @param doc The document state to add to the history.
   */
  public add(doc: DocNode): void {
    // If the new state is identical to the last one in the stack, don't add it.
    // This requires a way to compare DocNodes. For PoC, we assume they are different if add is called.
    // A more robust check might be:
    // if (this.undoStack.length > 0 && areNodesEffectivelyEqual(this.undoStack[this.undoStack.length - 1], doc)) {
    //   return;
    // }

    this.undoStack.push(doc);
    this.redoStack = []; // Clear redo stack whenever a new action is performed

    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift(); // Remove the oldest entry
    }
  }

  /**
   * Performs an undo operation.
   * @param currentDoc The current state of the document, which will be pushed to the redo stack.
   * @returns The previous document state to restore, or null if no undo history.
   */
  public undo(currentDoc: DocNode): DocNode | null {
    if (this.undoStack.length === 0) {
      return null;
    }
    const prevState = this.undoStack.pop()!;
    this.redoStack.push(currentDoc);
    return prevState;
  }

  /**
   * Performs a redo operation.
   * @param currentDoc The current state of the document, which will be pushed to the undo stack.
   * @returns The next document state to restore, or null if no redo history.
   */
  public redo(currentDoc: DocNode): DocNode | null {
    if (this.redoStack.length === 0) {
      return null;
    }
    const nextState = this.redoStack.pop()!;
    // When redoing, the currentDoc (which is the state *before* redo) becomes the new undo point.
    this.undoStack.push(currentDoc); 
    if (this.undoStack.length > this.maxHistory) { // Maintain max history for undo stack
        this.undoStack.shift();
    }
    return nextState;
  }

  /**
   * Clears both undo and redo history.
   */
  public clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  /**
   * Checks if there is any undo history.
   * @returns True if undo is available, false otherwise.
   */
  public hasUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /**
   * Checks if there is any redo history.
   * @returns True if redo is available, false otherwise.
   */
  public hasRedo(): boolean {
    return this.redoStack.length > 0;
  }
}

console.log("undoManager.ts defined: UndoManager class.");
