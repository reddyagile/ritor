# Ritor Next Phase Development: From PoC to Enhanced Editor

This document summarizes the findings from the recent Proof-of-Concept (PoC) development focused on a custom document model for Ritor and outlines a high-level plan for the next phase of development.

## I. PoC Findings Report Summary

### 1. Objective Recap
The primary goals of the PoC were to explore the feasibility of a custom, immutable document model to:
*   Address the inherent HTML inconsistency issues stemming from direct `contentEditable` manipulation.
*   Provide a more robust foundation for implementing complex features like undo/redo.

### 2. Achievements
The PoC phase successfully delivered:
*   **Immutable Document Model (`documentModel.ts`):** Basic TypeScript interfaces and factory functions for `DocNode`, `ParagraphNode`, `TextNode`, `HardBreakNode`, and marks like `BoldMark`, `ItalicMark`. The design emphasizes immutability.
*   **Model-to-HTML Renderer (`modelRenderer.ts`):** A renderer that converts `DocNode` instances into HTML strings, demonstrating consistent output for the supported node and mark types.
*   **Rudimentary DOM Patcher (`domPatcher.ts`):** A `DomPatcher` class implementing a simple, block-level diffing and patching mechanism to update the live DOM based on changes between `DocNode` states.
*   **Minimal Editor Controller (`RitorVDOM.ts`):** An orchestrator class that manages the current document state (`currentViewDoc`) and uses `DomPatcher` to render updates. It includes example methods for programmatically modifying the document.

### 3. Key Outcomes & Evaluation

*   **HTML Consistency:** The PoC strongly validated that a model-driven approach, where the custom document model is the single source of truth for rendering, leads to significantly more consistent and predictable HTML output compared to relying on the browser's `contentEditable` behavior. The `modelRenderer.ts` ensures that a given document state always produces the same HTML.
*   **Undo/Redo Feasibility:** The design, particularly the use of immutable `DocNode` states and centralized updates via `RitorVDOM.updateDocument()`, provides a clear and straightforward path to implementing a snapshot-based undo/redo mechanism. This is a major improvement over the complexities of managing undo history with direct DOM manipulation.
*   **Overall Validation:** The PoC successfully demonstrated that adopting a custom document model is a viable and beneficial architectural direction for Ritor. It lays the groundwork for a more robust, maintainable, and feature-rich editor by directly addressing fundamental `contentEditable` challenges.

### 4. Identified Challenges & PoC Limitations
The `poc_review.md` highlighted several critical areas where the PoC is simplified and requires substantial development:

*   **User Input & Selection Mapping:** This is the most significant gap. The PoC does not handle user interactions within the `contentEditable` element (e.g., typing, deletions, formatting commands) nor does it map DOM selection to a model-based selection and vice-versa.
*   **Diffing/Patching Performance & Granularity:** The `DomPatcher` uses `JSON.stringify` for node comparison and performs block-level replacements. This is not performant for real-world use and lacks the granularity to update only specific inline changes.
*   **Schema System:** The current TypeScript interfaces provide structure, but a formal schema system (defining node types, attributes, content rules) is missing. This is crucial for validation, extensibility, and more complex document structures.
*   **Feature Completeness:** The document model and renderer currently support only a very limited set of nodes (paragraph, text, hard_break) and marks (bold, italic, underline, link). Essential features like headings, lists, images, etc., are absent.
*   **Cursor Management:** Restoring and managing the cursor position accurately after DOM patches is not handled.

## II. Proposed Next Phase Development Plan

This plan outlines the key areas of focus to evolve the PoC into a more functional and robust editor core, building upon the validated custom document model architecture.

### 1. Develop a Robust Document Schema System
*   **Goal:** Establish a formal system for defining the structure, constraints, and behavior of all document elements (nodes and marks).
*   **Tasks:**
    *   Design schema specification objects/interfaces (e.g., `NodeSpec`, `MarkSpec`) to define properties like content expressions (what children a node can have), attributes, parsing rules (from DOM), and rendering rules (`toDOM`).
    *   Implement a `Schema` class that compiles these specifications and provides utility methods for creating nodes/marks and validating document structure.
    *   Refactor `documentModel.ts` so that node/mark instances are strongly typed by their schema definition.
    *   Update `modelRenderer.ts` to derive rendering information (e.g., tag names, attributes) from the schema's `toDOM` rules.
*   **Rationale:** A formal schema is fundamental for a structured, extensible, and validatable document. It underpins parsing, rendering, and command logic.

### 2. Implement Core User Input Handling & Model Synchronization (Iterative)
*   **Goal:** Capture basic user input within the `contentEditable` area and translate these actions into consistent updates to the custom document model, which then re-renders to the DOM.
*   **Tasks (Iterative Approach):**
    *   **DOM Observation & Reconciliation:**
        *   Utilize `MutationObserver` to detect changes made by the browser within the editable DOM.
        *   On mutation, re-parse the minimal changed portion of the DOM.
        *   Diff the parsed DOM segment against the corresponding part of the `currentViewDoc`.
        *   Translate these differences into a transaction (a sequence of model update operations).
    *   **Transaction & Update Cycle:**
        *   Apply the generated transaction to `currentViewDoc` to produce a new, immutable `DocNode`.
        *   Call `RitorVDOM.updateDocument()` with the new `DocNode`, triggering `DomPatcher`.
    *   **`beforeinput` Interception:** Start intercepting specific `beforeinput` events (e.g., for 'Enter', 'Backspace', character insertion) to translate them directly into model operations, preventing default browser actions where appropriate and allowing for more controlled model changes.
    *   **Focus:** Begin with plain text typing, then 'Enter' key (new paragraph), then backspace/delete for characters.
*   **Rationale:** This is the most complex and critical part of bridging `contentEditable` with a custom model. An iterative approach, potentially drawing inspiration from how libraries like ProseMirror handle reconciliation, is recommended.

### 3. Selection Mapping and Management
*   **Goal:** Accurately represent and manage user selection within the context of the custom document model, and ensure the DOM selection is correctly updated after model changes.
*   **Tasks:**
    *   Define a model-based selection representation (e.g., using start/end character offsets within the document, or anchor/head positions relative to model nodes/offsets).
    *   Implement robust functions to convert DOM `Selection` objects (and `Range`s) into this model selection format.
    *   Implement functions to convert a model selection back into a DOM selection and apply it to the view.
    *   Ensure `DomPatcher` and input handling logic correctly manage and restore selection after updates.
*   **Rationale:** Precise selection mapping is essential for any user-initiated editing operation (applying marks, inserting text at the cursor, etc.).

### 4. Refine Diffing and Patching Mechanism (`DomPatcher`)
*   **Goal:** Improve the performance, accuracy, and granularity of the DOM patching process.
*   **Tasks:**
    *   Replace `JSON.stringify` in `areNodesEffectivelyEqual` with more efficient comparison logic. For immutable nodes, reference equality is a primary check. For content, specific attribute checks or shallow content array comparisons might be needed.
    *   Enhance `DomPatcher` to perform more granular updates. Instead of always re-rendering an entire block for any change, aim to:
        *   Update only text content of a DOM element if only a `TextNode`'s text changed.
        *   Modify only attributes if only node attributes changed.
        *   Handle inline content changes more precisely (though this is advanced).
    *   Introduce unique IDs ("keys") for block nodes in the document model to allow the `DomPatcher` to correctly identify and handle reordered blocks without full re-renders.
*   **Rationale:** Efficient patching is crucial for a responsive user experience, especially with larger documents or frequent edits.

### 5. Implement Basic Undo/Redo Functionality
*   **Goal:** Leverage the immutable document model to provide a working undo/redo history.
*   **Tasks:**
    *   Design and implement an undo manager that stores snapshots of `DocNode` states.
    *   Integrate this with `RitorVDOM`: before applying an update that should be undoable, push the `currentViewDoc` onto an undo stack.
    *   Implement `undo()` and `redo()` methods in `RitorVDOM` that swap `currentViewDoc` with states from the undo/redo stacks and trigger `domPatcher.patch()`.
*   **Rationale:** This is a core editor feature that the PoC's architecture was designed to simplify. Achieving a basic version will be a significant milestone.

### 6. Expand Supported Node/Mark Types (Gradual Expansion)
*   **Goal:** Incrementally increase the richness of documents Ritor can represent and edit.
*   **Tasks (Examples, guided by schema development):**
    *   Add support for **Headings** (e.g., `h1`, `h2`).
    *   Implement **Lists** (ordered and unordered, list items).
    *   Enhance **Link** handling (e.g., commands to create/edit links).
    *   Each new element will require: schema definition, rendering logic in `modelRenderer.ts` (driven by schema), specific input handling rules, and potentially new commands/UI.
*   **Rationale:** To move towards a practically useful editor capable of handling common rich text content.

This plan represents a substantial body of work. Each point, especially input handling and selection mapping, will require careful design and iterative implementation. The focus should remain on leveraging the strengths of the custom document model to build a more predictable and maintainable editor core.
