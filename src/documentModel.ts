// src/documentModel.ts
import type { NodeType, MarkType } from './schema.js'; // Use type import for circular dependency avoidance if necessary at runtime
import type { Attrs } from './schemaSpec.js'; // Attrs type

// Base Mark Interface - now links to MarkType
export interface Mark {
  readonly type: MarkType; // Changed from string to MarkType
  readonly attrs: Attrs;
  eq(other: Mark): boolean; // Method to compare this mark with another
}

// Specific mark interfaces can still exist for type narrowing if needed,
// but their `type` property will be a MarkType instance.
export interface BoldMark extends Mark {
  readonly type: MarkType & { name: 'bold' }; // Example of narrowing if type name is fixed
}
export interface ItalicMark extends Mark {
  readonly type: MarkType & { name: 'italic' };
}
export interface UnderlineMark extends Mark {
  readonly type: MarkType & { name: 'underline' };
}
export interface LinkMark extends Mark {
  readonly type: MarkType & { name: 'link' };
  readonly attrs: {
    href: string;
    target?: string;
  } & Attrs; // Ensure it includes base Attrs structure if any
}

export type AnyMark = Mark; // Generic Mark is now sufficient, specific types for convenience

// Base Node Interface - now links to NodeType
export interface BaseNode {
  readonly type: NodeType; // Changed from string to NodeType
  readonly attrs: Attrs; // attrs.id will store the unique ID for block nodes
  readonly content?: ReadonlyArray<BaseNode>; // Content is always BaseNode array
  readonly marks?: ReadonlyArray<AnyMark>; // Marks for inline content, esp. TextNode
  // id?: string; // This was considered but ID should be part of attrs for schema consistency
  readonly nodeSize: number; // Calculated size of the node
  readonly isLeaf?: boolean; // Indicates if the node is a leaf node
  readonly isText?: boolean; // Indicates if the node is a text node
}

// TextNode now also uses NodeType
export interface TextNode extends BaseNode {
  readonly type: NodeType & { name: 'text' }; // Example of narrowing
  readonly text: string;
  // Marks are on BaseNode now, particularly relevant for TextNode
  // readonly content?: undefined; // Text nodes should not have content in this model
}

// HardBreakNode - type also becomes NodeType
export interface HardBreakNode extends BaseNode {
  readonly type: NodeType & { name: 'hard_break' };
  // readonly content?: undefined;
}

export type InlineNode = BaseNode; // Generic BaseNode can represent inline nodes, type.isInline check
export type BlockNode = BaseNode;  // Generic BaseNode can represent block nodes, type.isBlock check

// DocNode - type also becomes NodeType
export interface DocNode extends BaseNode {
  readonly type: NodeType & { name: 'doc' };
  readonly content: ReadonlyArray<BlockNode>;
  readonly contentSize: number; // Sum of nodeSize of content nodes
}


// --- Deprecated Factory Functions ---
// These will be replaced by schema.node() and schema.text() methods.
// Keeping them here commented out or removed shows the transition.

/*
export function createBoldMark(): BoldMark { ... }
export function createItalicMark(): ItalicMark { ... }
export function createUnderlineMark(): UnderlineMark { ... }
export function createLinkMark(href: string, target?: string): LinkMark { ... }

export function createText(text: string, marks?: ReadonlyArray<AnyMark>): TextNode { ... }
export function createHardBreak(): HardBreakNode { ... }
export function createParagraph(content: ReadonlyArray<InlineNode>): ParagraphNode { ... }
export function createDoc(content: ReadonlyArray<BlockNode>): DocNode { ... }
*/

// The explanation of how the model addresses HTML consistency and undo/redo
// is still valid but now operates in conjunction with the Schema.

// Utility function to compare attribute objects (simple equality)
export function attrsEq(attrsA: Attrs, attrsB: Attrs): boolean {
    if (attrsA === attrsB) return true;
    if (!attrsA || !attrsB) return false;
    const keysA = Object.keys(attrsA);
    const keysB = Object.keys(attrsB);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
        if (attrsA[key] !== attrsB[key]) return false;
    }
    return true;
}


console.log("documentModel.ts updated: Mark interface now includes eq method. Factory functions are deprecated.");
