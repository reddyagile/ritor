// src/schemaSpec.ts

// src/schemaSpec.ts

export type Attrs = { [key: string]: any } | null;

/**
 * Defines the structure for rendering a node or mark to the DOM.
 * Examples:
 *  - ["p", 0]  // A paragraph tag, 0 is the content hole
 *  - ["div", {class: "foo"}, 0] // A div with attributes
 *  - "br" // A simple tag, no attributes or content hole (for leaf nodes like hard_break)
 *  - ["a", {href: "url"}, 0] // An anchor tag for a link mark
 */
export type DOMOutputSpec = [string, Attrs | 0, ...any[]] | [string, ...any[]] | string;

// Simplified ParseRule for now

// Forward declare DOMParser for ParseRule.getContent
// We have to use 'any' here because DOMParser class is in a different file and imports this one.
// This creates a circular dependency if we try to import DOMParser type directly.
export type DOMParserInstance = any; 

export interface ParseRule {
  tag?: string; // e.g., "p", "li", "a[href]" (simple tags first, then selectors)
  style?: string; // e.g., "font-weight=bold" (key=value)
  context?: string; // e.g., "list_item/" or "blockquote/paragraph/"
  // priority?: number;
  getAttrs?: (domNodeOrValue: HTMLElement | string) => Attrs | false | null | undefined;
  getContent?: (domNode: HTMLElement, parser: DOMParserInstance) => import('./documentModel.js').BaseNode[]; // Allow custom content parsing
  // Other conditions like node name, class, etc. could be added
}
// Removed the "| any" from ParseRule to make it more specific.
// Ensure dependent files are updated if they relied on 'any'.


export interface AttributeSpec {
  default?: any;
  // Future: compute?: (attrs: Attrs) => any; validate?: (value: any) => boolean;
}

export interface NodeSpec {
  /**
   * A content expression, describing the allowed content for this node.
   * Examples: "inline*", "block+", "(paragraph | heading)*", "text*", "" (for leaf nodes)
   */
  content?: string;

  /**
   * The marks that are allowed on the content of this node.
   * Space-separated string of mark names, "_" for all, or "" for none.
   */
  marks?: string;

  /**
   * Attributes that nodes of this type can have.
   */
  attrs?: { [name: string]: AttributeSpec };

  /**
   * The group or category this node type belongs to (e.g., "block", "inline").
   */
  group?: string;

  /**
   * Indicates if this node is an inline node.
   */
  inline?: boolean;

  /**
   * Indicates if this node is a leaf node (cannot have content).
   * If true, 'content' should typically be empty or not defined.
   */
  atom?: boolean; // ProseMirror uses 'atom' for nodes treated as a single, indivisible unit. 'leaf' might also be suitable.

  /**
   * Defines how this node should be rendered to the DOM.
   * (node: ModelNode) refers to the node instance from documentModel.ts
   */
  toDOM?: (node: import('./documentModel.js').BaseNode) => DOMOutputSpec;

  /**
   * Rules for parsing this node type from DOM elements.
   */
  parseDOM?: ParseRule[];

  // --- Ritor Specific Additions (Consider later) ---
  // selectable?: boolean;
  // draggable?: boolean;
  // code?: boolean; // Is this a code block?
  defining?: boolean; // Does this node mark a point where attributes are no longer inherited?
}

export interface MarkSpec {
  /**
   * Attributes that marks of this type can have.
   */
  attrs?: { [name: string]: AttributeSpec };

  /**
   * Whether this mark should be active when the cursor is at its edge.
   * (ProseMirror concept, useful for behavior of marks like links)
   */
  inclusive?: boolean;

  /**
   * Defines how this mark should be rendered to the DOM.
   * (mark: ModelMark, inline: boolean) refers to mark instance and if content is inline.
   */
  toDOM?: (mark: import('./documentModel.js').Mark, inline: boolean) => DOMOutputSpec;

  /**
   * Rules for parsing this mark type from DOM elements.
   */
  parseDOM?: ParseRule[];

  // --- Ritor Specific Additions (Consider later) ---
  // group?: string; // Group for marks, e.g., "fontStyle"
  // excludes?: string; // Space-separated names of marks that this mark excludes
  // excludesGroup?: string; // Marks from this group are excluded
}

console.log("schemaSpec.ts defined: NodeSpec, MarkSpec, AttributeSpec, DOMOutputSpec, ParseRule");
