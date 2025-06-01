# Ritor VDOM - Work Done Summary (as of [Current Date])

This document summarizes the significant development work undertaken to refactor the Ritor editor towards a custom document model and a VDOM-like architecture.

## I. Core Architectural Shift

The primary goal was to move away from direct DOM manipulation to address issues of HTML inconsistency, complex state management, and difficulties in implementing features like robust undo/redo. The new architecture is built upon:

1.  **Immutable Custom Document Model:**
    *   **Description:** A tree-like data structure representing the editor's content. Nodes (document, paragraphs, text, headings, lists, etc.) and marks (bold, italic, links, etc.) are immutable.
    *   **Key Files:** `src/documentModel.ts` (defines `BaseNode`, `DocNode`, `TextNode`, `Mark` interfaces with properties like `nodeSize`, `isLeaf`, `isText`, and `Mark.eq()`).
    *   **Impact:** Provides a single source of truth, simplifies state changes, and is fundamental for transactional updates and history.

2.  **Schema System:**
    *   **Description:** Defines the allowed structure of documents – node types, mark types, their attributes, content rules (e.g., a paragraph allows inline content), and how they map to/from HTML DOM.
    *   **Key Files:** `src/schemaSpec.ts` (interfaces `NodeSpec`, `MarkSpec`, `ParseRule`, `AttributeSpec`), `src/schema.ts` (`Schema`, `NodeType`, `MarkType` classes), `src/basicSchema.ts` (concrete schema for Ritor with common block and inline elements).
    *   **Impact:** Enforces document structure, drives rendering and parsing, and makes the editor extensible.

3.  **Model-Driven Rendering & Patching:**
    *   **Description:** The custom document model is rendered to HTML based on `toDOM` rules in the schema. Changes to the model are applied to the live browser DOM efficiently.
    *   **Key Files:**
        *   `src/modelRenderer.ts`: Converts model nodes to HTML strings using schema `toDOM` rules.
        *   `src/domPatcher.ts`: Compares old and new document models (represented as HTML strings or more granularly) and applies minimal changes to the DOM. Implements keyed-diffing for block nodes using unique IDs.
    *   **Impact:** Ensures consistent HTML output across browsers and optimized DOM updates.

4.  **Transactional Updates & Step Model:**
    *   **Description:** Document changes are represented as a sequence of atomic `Step` objects (e.g., `ReplaceStep`, `AddMarkStep`, `RemoveMarkStep`). A `Transaction` bundles these steps, manages an evolving document state, tracks selection through step mappings, and ensures atomicity of changes.
    *   **Key Files:** `src/transform/step.ts` (Step interface), `src/transform/slice.ts` (Slice for content fragments), `src/transform/stepMap.ts` (PoC for mapping positions), `src/transform/mapping.ts` (PoC for accumulating StepMaps), `src/transform/replaceStep.ts`, `src/transform/addMarkStep.ts`, `src/transform/removeMarkStep.ts`, `src/transform/transaction.ts`.
    *   **Impact:** Enables reliable undo/redo, precise selection mapping, and forms the basis for future features like collaborative editing.

5.  **Input Handling & VDOM Controller:**
    *   **Description:** User input is primarily captured by `beforeinput` event listeners, translated into model operations (via Transactions), and then patched to the DOM. A `MutationObserver` acts as a (currently very basic) fallback.
    *   **Key File:** `src/RitorVDOM.ts` (the main editor controller class managing state, schema, input, updates, and selection).
    *   **Impact:** More controlled and predictable handling of user interactions compared to relying solely on `contentEditable`'s default behavior.

## II. Key Implemented Features & Components

1.  **Document Model & Schema:**
    *   Core node types: `doc`, `paragraph`, `text`, `hard_break`.
    *   Block types: `heading` (H1-H6 via attributes), `bullet_list`, `ordered_list`, `list_item`, `blockquote`.
    *   Mark types: `bold`, `italic`, `strikethrough`, `link` (with `href`, `title` attributes).
    *   `nodeSize` calculation for all nodes (critical for position mapping).
    *   Nodes have `isLeaf` and `isText` properties. Marks have an `eq()` method for comparison.

2.  **Rendering & Patching:**
    *   Schema-driven HTML rendering via `toDOM` rules.
    *   Keyed diffing in `DomPatcher` for block updates (add, remove, reorder) using `id` attributes on block nodes.
    *   Granular updates for attributes and inline content within blocks (though inline patching is still basic).

3.  **Position Conversion Utilities (`src/modelUtils.ts`):**
    *   `modelPositionToFlatOffset(doc, pos, schema)` and `flatOffsetToModelPosition(doc, flatOffset, schema)`: Extensively unit-tested functions for converting between path-based `ModelPosition` and numerical flat document offsets. These are crucial for `Step` operations.
    *   `nodeAtPath(doc, path)`: Retrieves a node by its model path.
    *   `replaceNodeAtPath(root, path, newNode, schema)`: Immutably replaces a node at a given path.
    *   `replaceNodeInPathWithMany(rootDoc, pathToOneNode, newNodes, schema)`: Immutably replaces one node with multiple nodes at a given path.
    *   `findTextNodesInRange(doc, fromFlat, toFlat, schema)`: Identifies text node segments within a flat offset range.
    *   `normalizeInlineArray(nodes, schema)` and `normalizeMarks(marks)` for canonical representations.

4.  **Input Handling (`src/RitorVDOM.ts`):**
    *   `beforeinput` handlers for:
        *   `insertText`.
        *   `insertParagraph` (Enter key), with basic behavior in lists/blockquotes.
        *   `deleteContentBackward`, `deleteContentForward` (character deletion).
        *   Browser formatting intents (`formatBold`, `formatItalic`, `formatStrikeThrough`) mapped to `toggleMark`.
        *   `insertFromPaste` (prevents default, PoC: pastes as plain text using `ReplaceStep`).
    *   Markdown-like shortcuts (e.g., `## ` for H2, `* ` for lists) are NOT YET explicitly implemented in `RitorVDOM`'s `beforeinput` but were part of earlier conceptual phases.
    *   `MutationObserver` as a basic fallback (currently logs unhandled mutations).

5.  **Selection Mapping & Management (`src/RitorVDOM.ts`, `src/selection.ts`):**
    *   `ModelPosition { path: number[]; offset: number }` and `ModelSelection { anchor, head }` structures.
    *   DOM-to-model (`domToModelPosition`) and model-to-DOM (`modelToDomPosition`) selection conversion utilities (currently PoC with known limitations, especially for complex DOM structures).
    *   Selection transformation within `Transaction` objects is now robustly based on `StepMap`s from each step, using the flat offset utilities.

6.  **Undo/Redo (`src/undoManager.ts`, `RitorVDOM.ts`):**
    *   Snapshot-based undo/redo functionality. `UndoManager` stores `DocNode` states.
    *   `RitorVDOM.updateDocument` saves the state *before* a transaction is applied to the undo manager.
    *   Standard keyboard shortcuts (Ctrl/Cmd+Z, Ctrl/Cmd+Y) are implemented.

7.  **Step Model (`src/transform/`):**
    *   `ReplaceStep`:
        *   `apply` method significantly improved for:
            *   Single-block inline content changes (text splitting, insertion, deletion).
            *   Multi-block changes (PoC level: deleting full blocks, replacing full blocks, inserting blocks, handling partially kept start/end blocks with simplified text splitting).
        *   `invert` method uses a new `modelUtils.sliceDocByFlatOffsets` helper to extract the original document content for creating the inverse step. Works for tested inline and full-block cases.
    *   `AddMarkStep`, `RemoveMarkStep`:
        *   Implemented with functional `apply` methods that iterate through text nodes in a flat range (via `findTextNodesInRange`) and replace them with new versions with modified marks (splitting text nodes as needed).
        *   `invert` methods are defined.
    *   `Transaction` class:
        *   Manages application of steps, evolving document state (`tr.doc`), and selection (`tr.selection`).
        *   Selection is now correctly mapped through each step using the step's `StepMap` and the validated flat offset utilities.
        *   Uses a `Mapping` object (`tr.mapping`) to accumulate `StepMap`s.
    *   `StepMap`: PoC implementation, but `invert()` method added.
    *   `Mapping`: PoC implementation, with `appendMap`, `appendMapping`, and `inverted` getter.

## III. Unresolved Issues & Current PoC Limitations

1.  **Advanced `ReplaceStep` Operations:**
    *   **Slice `openStart`/`openEnd`:** Not yet utilized in `ReplaceStep.apply` or `sliceDocByFlatOffsets`. This limits intelligent content merging (e.g., pasting list items into an existing list and having them merge correctly, or pasting content that should "pierce" through block boundaries).
    *   **Partial Block Content (Multi-Block):** While improved, the logic for handling partially kept start/end blocks during multi-block replacements still makes simplifying assumptions about their internal structure (e.g., assumes simple text content for splitting). Complex inline content (multiple text nodes with different marks, other inline elements) at the cut points might not be handled with full fidelity.
    *   **`ReplaceStep.invert` for Complex Cases:** Inversion of replacements that involve partial block modifications or complex slice merging (once `openStart/End` are used) will be inaccurate until `sliceDocByFlatOffsets` fully supports these with correct `openStart/End` in its returned Slice.
2.  **Schema-Driven `DOMParser` (`src/domParser.ts`):**
    *   The current parser is very basic. It needs significant enhancement to:
        *   Fully support all `ParseRule` capabilities (complex selectors, context rules, `getContent` overrides, priorities).
        *   Handle ambiguities in parsing.
        *   Perform schema validation on parsed content.
    *   Integration into `insertFromPaste` needs to use this improved parser.
3.  **Comprehensive User Input Handling (`src/RitorVDOM.ts`):**
    *   **IME Input:** Not explicitly handled or tested.
    *   **Complex Deletions/Selections:** Deletions across deeply nested structures, or "triple click" style block selections, might not yet be perfectly translated to model operations or `Step`s.
    *   **Drag and Drop:** Not implemented.
    *   **Arrow Key Navigation around Complex Nodes:** Basic arrow key movement relies on browser selection + `selectionchange`. More complex nodes (e.g., tables, custom embeds later) would need custom navigation logic.
4.  **Advanced Selection/Position Mapping (`Mapping`):**
    *   The current `StepMap` and `Mapping` are simplified. A full implementation (like ProseMirror's `Mapping` which handles concurrent changes) is needed for features like true collaborative editing or more complex history (e.g., rebasing changes). The `inverted` getter in `Mapping` is also PoC.
5.  **Testing Coverage:**
    *   `modelUtils.ts` (position conversion) has good unit tests.
    *   `ReplaceStep.ts` has a growing suite but needs more tests for partial block modifications with complex inline content and various slice types.
    *   `AddMarkStep`, `RemoveMarkStep`, `Transaction`, `DOMParser`, and `RitorVDOM` itself (for input handling) need dedicated, comprehensive unit tests.
6.  **UI for Commands:** No UI (toolbar, menus) exists; commands are via keyboard shortcuts or direct method calls.
7.  **Performance:** While VDOM patching is generally efficient, performance for very large documents or rapid complex changes has not been benchmarked.
8.  **DOM-to-Model Selection (`domToModelPosition`, `modelToDomPosition`):** These are still marked as PoC and have known simplifications. They are critical for accurate selection representation and need to be made fully robust, especially with complex DOM structures or after certain mutations.

## IV. Pending Tasks & Future Direction

The immediate focus should be on solidifying the existing VDOM core and improving editing capabilities:

1.  **Robustify `ReplaceStep` and `Slice` Handling:**
    *   Fully implement `Slice.openStart`/`Slice.openEnd` usage in `ReplaceStep.apply` for intelligent content merging.
    *   Make `sliceDocByFlatOffsets` produce Slices with correct `openStart`/`openEnd` values.
    *   Refine partial block handling in `ReplaceStep.apply` for complex inline content at boundaries.
    *   Improve `ReplaceStep.invert` based on the above.
    *   Add extensive unit tests for all `ReplaceStep` scenarios.
2.  **Complete `DOMParser`:** Fully implement schema-driven parsing capabilities and integrate deeply into paste handling.
3.  **Enhance Core Input Handling:** Cover more `beforeinput` types, improve IME handling, and refine complex deletion/selection scenarios.
4.  **Robust DOM/Model Selection Mapping:** Overhaul `domToModelPosition` and `modelToDomPosition` for accuracy and edge cases.
5.  **Schema Validation:** Enforce schema constraints more strictly during parsing, step application, and node creation.
6.  **UI Layer:** Develop a basic UI (toolbar, menus) to expose editor commands.
7.  **Further Step Types (if needed):** Consider if `AttrStep` (for changing node attributes) is necessary or if `ReplaceStep` can cover these cases by replacing a node with a new version having different attributes.

This new architecture provides a strong foundation for building a highly capable and reliable rich text editor.
```
