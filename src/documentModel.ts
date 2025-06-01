// --- Mark Definitions ---

export interface Mark {
  readonly type: string;
  readonly attrs?: { [key: string]: any };
}

export interface BoldMark extends Mark {
  readonly type: 'bold';
}

export interface ItalicMark extends Mark {
  readonly type: 'italic';
}

export interface UnderlineMark extends Mark {
  readonly type: 'underline';
}

export interface LinkMark extends Mark {
  readonly type: 'link';
  readonly attrs: {
    href: string;
    target?: string;
  };
}

// Union type for all supported marks
export type AnyMark = BoldMark | ItalicMark | UnderlineMark | LinkMark;

// --- Node Definitions ---

export interface BaseNode {
  readonly type: string;
  readonly attrs?: { [key: string]: any };
  readonly content?: ReadonlyArray<BaseNode | TextNode | HardBreakNode>; // General content for block nodes
}

export interface TextNode extends BaseNode {
  readonly type: 'text';
  readonly text: string;
  readonly marks?: ReadonlyArray<AnyMark>;
  readonly content?: undefined; // Text nodes do not have content
}

export interface HardBreakNode extends BaseNode {
  readonly type: 'hard_break';
  readonly content?: undefined; // HardBreak nodes do not have content
}

// Union type for inline nodes
export type InlineNode = TextNode | HardBreakNode; // Add other inline nodes like ImageNode here later

export interface ParagraphNode extends BaseNode {
  readonly type: 'paragraph';
  readonly content: ReadonlyArray<InlineNode>; // Paragraphs specifically contain InlineNodes
}

// Union type for block nodes (add HeadingNode, BlockquoteNode, ListNode etc. here later)
export type BlockNode = ParagraphNode;

export interface DocNode extends BaseNode {
  readonly type: 'doc';
  readonly content: ReadonlyArray<BlockNode>; // Document specifically contains BlockNodes
}

// --- Factory Functions ---

// Marks
export function createBoldMark(): BoldMark {
  return { type: 'bold' };
}

export function createItalicMark(): ItalicMark {
  return { type: 'italic' };
}

export function createUnderlineMark(): UnderlineMark {
  return { type: 'underline' };
}

export function createLinkMark(href: string, target?: string): LinkMark {
  return { type: 'link', attrs: { href, target } };
}

// Nodes
export function createText(text: string, marks?: ReadonlyArray<AnyMark>): TextNode {
  return { type: 'text', text, marks: marks || [] };
}

export function createHardBreak(): HardBreakNode {
  return { type: 'hard_break' };
}

export function createParagraph(content: ReadonlyArray<InlineNode>): ParagraphNode {
  return { type: 'paragraph', content };
}

export function createDoc(content: ReadonlyArray<BlockNode>): DocNode {
  return { type: 'doc', content };
}

// --- Explanation ---

/*
How this model aims to address:

1.  Consistent HTML Output:
    *   **Structured Representation:** The model provides a well-defined, hierarchical structure for the document content. Each node and mark has a specific type and allowed content/attributes.
    *   **Controlled Rendering:** When converting this model to HTML, the rendering logic can iterate through this structure and deterministically generate corresponding HTML tags and attributes. Since the model is the single source of truth, variations in how users might create similar-looking content (e.g., multiple spaces vs. paragraph breaks) can be normalized within the model or during its construction.
    *   **Schema Enforcement:** The TypeScript interfaces enforce the shape of the document. This means any logic that creates or manipulates the document model must adhere to this schema, reducing the chances of malformed structures that could lead to inconsistent HTML. For instance, a 'paragraph' node can only contain 'inline' content.

2.  Providing a Foundation for Undo/Redo:
    *   **Immutability:** The factory functions create objects that are intended to be immutable (properties are `readonly`, content arrays are `ReadonlyArray`). While true deep immutability isn't enforced without libraries, the design leans towards it.
    *   **State Snapshots:** An undo/redo system can operate by storing snapshots of the `DocNode` (the entire document state) at different points in time. When a user performs an action, a new version of the `DocNode` is created (leveraging structural sharing where possible if full immutability is achieved).
    *   **Action-Based History:** Alternatively, instead of full snapshots, one could record "transformations" or "operations" that describe changes from one state of the model to the next. Applying the inverse of these operations would allow undoing, and reapplying them would allow redoing. The structured nature of the model makes defining and applying such transformations more reliable than direct DOM manipulation history.
    *   **Serialization:** The model, being a plain JavaScript object structure, can be easily serialized (e.g., to JSON). This is useful for storing history states or for more complex undo/redo mechanisms that might involve diffing states.
*/
// console.log("Document model definitions and factory functions created."); // Commented out for cleaner renderer output

// Example Usage (for testing, not part of the final file usually)
/*
const sampleDoc = createDoc([
  createParagraph([
    createText("Hello ", [createBoldMark()]),
    createText("World!", [createItalicMark()]),
  ]),
  createParagraph([
    createText("This is a link: "),
    createText("Google", [createLinkMark("http://google.com")]),
    createHardBreak(),
    createText("New line after hard break.")
  ])
]);

console.log(JSON.stringify(sampleDoc, null, 2));
*/
