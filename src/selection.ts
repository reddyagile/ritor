// src/selection.ts

export interface ModelPosition {
  /**
   * Path from DocNode.content to the direct parent of the target.
   * Each number is an index into a 'content' array.
   * e.g., [0, 1] could mean doc.content[0].content[1] (0th paragraph, 1st inline node like a TextNode)
   * If the path points to a block node (e.g. paragraph), the 'offset' might refer to
   * an index among its inline children or character offset if it's the paragraph itself.
   */
  path: number[];

  /**
   * - If the path points to a Model TextNode (e.g., `path = [blockIndex, inlineTextNodeIndex]`),
   *   this is a character offset within that TextNode's `text` string.
   * - If the path points to a parent Model ElementNode (e.g., `path = [blockIndex]` for a paragraph,
   *   or `path = [listIndex, listItemIndex, paraInListItemIndex]` for a paragraph in a list item),
   *   this `offset` typically refers to an *index* among that ElementNode's *child nodes*.
   *   For example, an offset of 0 in an empty paragraph means "at the very start of the paragraph".
   *   An offset of 1 in a paragraph with one child means "after the first child".
   * - ProseMirror uses a single integer offset from the start of the document, which simplifies things
   *   but requires a robust way to count positions across all node types. This PoC uses paths.
   */
  offset: number;
}

export interface ModelSelection {
  anchor: ModelPosition;
  head: ModelPosition;
  // TODO: Add isCollapsed, from, to getters later
  // isCollapsed(): boolean { return this.anchor.path.every((val, i) => val === this.head.path[i]) && this.anchor.offset === this.head.offset; }
}

/*
Selection Transformation Problem:

When the document model changes, ModelPosition objects representing the selection
before the change may become invalid or point to the wrong place in the new document.
Naive selection restoration (re-applying the old ModelPosition to the new DOM) fails because:

1.  Insertion before selection:
    If text or nodes are inserted before the selection's original position, the original
    ModelPosition (e.g., path [0,0], offset 5) now points to a location *before* the
    actual intended text. The offset or even path needs to be adjusted forward.
    Example: Old: <p>Hello</p>, Sel: [0,0], off 2 (after 'e')
             New: <p>Hi Hello</p>, Sel should be: [0,0], off 5 (after 'e')

2.  Deletion before selection:
    If text or nodes are deleted before the selection, the original ModelPosition now
    points too far into the document. The offset or path needs to be adjusted backward.
    Example: Old: <p>Hi Hello</p>, Sel: [0,0], off 5 (after 'e')
             New: <p>Hello</p>, Sel should be: [0,0], off 2 (after 'e')

3.  Deletion containing selection:
    If the text/nodes that the selection was within are deleted, the original ModelPosition
    is now invalid. The selection should typically map to the point of deletion,
    often biased towards the start of the deleted range.
    Example: Old: <p>Hello World</p>, Sel: [0,0], off 7 (inside 'World')
             New: <p>Hello </p> (if 'World' deleted), Sel should be: [0,0], off 6 (at end of 'Hello ')

A robust solution requires a "position mapping" function that takes a position and a
description of a change, and returns a new position that is valid in the document
after the change. This often involves:
- Detailed change descriptions (deltas/operations).
- Mapping through each step of a transaction if multiple operations occur.
- Handling "gravity" or "bias" for selections at the edges of changes.

The `mapModelPosition` function in RitorVDOM.ts is a very basic PoC of this concept
for a few specific `SimpleChange` types.
*/

console.log("selection.ts defined: ModelPosition, ModelSelection, and Selection Transformation Problem documented.");
