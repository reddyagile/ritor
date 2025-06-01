// src/schema.ts
import { NodeSpec, MarkSpec, Attrs, DOMOutputSpec } from './schemaSpec.js';
import {
  // These will be the actual node/mark instances.
  // Their definitions will be updated in documentModel.ts to include a link to NodeType/MarkType.
  BaseNode as ModelNode, // Renaming for clarity within this file
  TextNode as ModelTextNode,
  AnyMark as ModelAnyMark,
  // We'll need a generic way to create these or specific factories if they remain distinct types.
  ModelAnyMark, // Ensure ModelAnyMark is imported if not already covered by BaseNode etc.
  // attrsEq, // Attempt to import if it's exported from documentModel.js
} from './documentModel.js'; // Assuming .js for ESM runtime
import { attrsEq } from './documentModel.js'; // Explicit import for attrsEq

// Simple unique ID generator for nodes
let nextNodeId = 1;
function generateNodeId(): string {
  return `ritor-node-${nextNodeId++}`;
}

// Represents a parsed content expression token
interface ContentMatchToken {
  name: string; // Node name or group name
  isGroup: boolean;
  quantifier: '*' | '+' | '?'; // '*' (0 or more), '+' (1 or more), '?' (0 or 1)
}

// Simplified parser for content expressions
// Example: "inline*" -> [{name: "inline", isGroup: true, quantifier: "*"}]
//          "(paragraph | heading)+" -> [{name: "paragraph", isGroup: false, quantifier: "+"}, {name: "heading", isGroup: false, quantifier: "+"}]
//          "block?" -> [{name: "block", isGroup: true, quantifier: "?"}]
// This is very basic and doesn't handle complex nesting or sequences perfectly.
function parseContentExpression(expression: string, schema: Schema): ContentMatchToken[] {
  const tokens: ContentMatchToken[] = [];
  if (!expression) return tokens;

  // Handle simple OR groups like (paragraph | heading)* or (paragraph | heading)+
  const groupMatch = expression.match(/^\(([^)]+)\)([+*?]?)$/);
  if (groupMatch) {
    const groupContent = groupMatch[1];
    const quantifier = (groupMatch[2] || '*') as '*' | '+' | '?'; // Default to '*' if no quantifier
    const parts = groupContent.split(/\s*\|\s*/);
    for (const part of parts) {
      // For simplicity, assume no nested groups or complex expressions inside OR
      tokens.push({
        name: part,
        isGroup: schema.nodes[part] === undefined, // It's a group if not a defined node name
        quantifier: quantifier
      });
    }
    return tokens;
  }

  // Handle single elements like "inline*", "block+", "text?"
  const singleMatch = expression.match(/^(\w+)([+*?]?)$/);
  if (singleMatch) {
    const name = singleMatch[1];
    const quantifier = (singleMatch[2] || (name === "text" ? "*" : "+")) as '*' | '+' | '?'; // Default quantifier
    tokens.push({
      name: name,
      isGroup: schema.nodes[name] === undefined, // It's a group if not a defined node name
      quantifier: quantifier
    });
  } else if (expression) { // Fallback for unparsed simple names, assume one or more
    tokens.push({ name: expression, isGroup: schema.nodes[expression] === undefined, quantifier: '+' });
  }
  return tokens;
}


export class NodeType {
  public readonly contentMatcher: ContentMatchToken[];
  public readonly allowedMarks: Set<string> | null; // null means all, empty set means none

  constructor(
    public readonly name: string,
    public readonly spec: NodeSpec,
    public readonly schema: Schema // Reference back to the schema it belongs to
  ) {
    this.contentMatcher = parseContentExpression(spec.content || "", schema);

    if (spec.marks === "_") {
      this.allowedMarks = null; // All marks allowed
    } else if (spec.marks === "" || !spec.marks) {
      this.allowedMarks = new Set(); // No marks allowed
    } else {
      this.allowedMarks = new Set(spec.marks.split(" "));
    }
  }

  get inlineContent(): boolean {
    return this.spec.group?.includes('inline') || false; // Simplified
  }

  get isBlock(): boolean {
    return !this.spec.inline && !this.isText;
  }

  get isText(): boolean {
    return this.name === 'text';
  }

  get isLeaf(): boolean {
    return !!this.spec.atom; // Using 'atom' as per ProseMirror convention for leaf-like nodes
  }

  // Basic check, will be replaced by content expression matching
  public checkContent(content: ReadonlyArray<ModelNode>): boolean {
    if (this.isLeaf && content.length > 0) return false;
    if (this.contentMatcher.length === 0 && content.length > 0) return false; // Leaf by empty content string
    if (this.contentMatcher.length === 0 && content.length === 0) return true;


    // This is a placeholder for actual validation using this.contentMatcher
    // A real implementation would be a state machine or similar based on the matcher.
    // For PoC, we'll do very simple checks.
    if (this.contentMatcher.length > 0) {
        const firstMatcher = this.contentMatcher[0]; // Assuming only one rule for simplicity of PoC
        let count = 0;
        for (const node of content) {
            const nodeType = node.type as NodeType; // node.type is NodeType
            if (firstMatcher.isGroup) {
                if (nodeType.spec.group === firstMatcher.name) count++;
            } else {
                if (nodeType.name === firstMatcher.name) count++;
            }
        }

        if (firstMatcher.quantifier === '+' && count === 0) return false;
        if (firstMatcher.quantifier === '?' && count > 1) return false;
        // '*' allows any count, so no check needed here for it.
    }
    return true;
  }

  // Basic check for marks
  public allowsMarkType(markType: MarkType | string): boolean {
    if (this.allowedMarks === null) return true; // All marks allowed
    const markName = typeof markType === 'string' ? markType : markType.name;
    return this.allowedMarks.has(markName);
  }

  public create(attrs?: Attrs, content?: ReadonlyArray<ModelNode> | ModelNode, _marks?: ReadonlyArray<ModelAnyMark>): ModelNode {
    if (this.isText) throw new Error("Cannot use NodeType.create() for text nodes; use Schema.text() instead.");

    let finalAttrs = this.defaultAttrs(attrs);

    // Ensure block nodes have an ID
    if (this.isBlock && (!finalAttrs || finalAttrs.id === undefined)) {
        finalAttrs = { ...finalAttrs, id: this.schema.generateNodeId() };
    }

    const finalContent = Array.isArray(content) ? content : (content ? [content] : []);

    if (!this.checkContent(finalContent)) {
        console.warn(`Invalid content for node type ${this.name}:`, finalContent);
        // Depending on strictness, could throw error or try to recover
    }

    // This is where the generic ModelNode structure is created.
    // The concrete types like ParagraphNode, DocNode might become less important,
    // or this create method needs to return those specific types.
    // For now, returning a structure compatible with BaseNode.

    let calculatedContentSize = 0;
    if (finalContent) {
        for (const child of finalContent) {
            // Child nodes must have their nodeSize defined by this point
            calculatedContentSize += child.nodeSize;
        }
    }

    let calculatedNodeSize: number;
    const isNodeLeaf = !!this.spec.atom; // Atom nodes are leaves
    const isNodeText = this.name === 'text';

    if (this.name === this.schema.topNodeType.name) { // Document node itself
        calculatedContentSize = finalContent.reduce((sum, child) => sum + child.nodeSize, 0);
        calculatedNodeSize = calculatedContentSize;
    } else if (isNodeLeaf) {
        calculatedNodeSize = 1; // Leaf nodes like <br> or <img> count as 1
        calculatedContentSize = 0; // Leaf nodes have no content
    } else if (this.isBlock || this.spec.group?.includes("block") || this.spec.group?.includes("list_item_block")) { // Block nodes
        calculatedContentSize = finalContent.reduce((sum, child) => sum + child.nodeSize, 0);
        calculatedNodeSize = 2 + calculatedContentSize; // 1 for open tag, 1 for close tag
    } else if (this.spec.inline && !isNodeText) { // Inline, non-text, non-leaf (e.g. a hypothetical styled span with content)
        // This case is complex. If it's an inline node that doesn't get its own tags from its type
        // (e.g. marks provide the tags like <a> for a link mark on a text node),
        // then its size might just be its contentSize.
        // If the inline node type itself implies tags (e.g. <span class="foo">...</span>), then it's 2 + content.
        // For now, let's assume inline non-text, non-leaf nodes are like blocks regarding size calculation if they have content.
        // This might need refinement based on how marks vs. inline nodes with styles are handled.
        calculatedContentSize = finalContent.reduce((sum, child) => sum + child.nodeSize, 0);
        calculatedNodeSize = (finalContent.length > 0 ? 2 : 0) + calculatedContentSize; // Only add for tags if it has content or is meant to be non-empty
    } else { // Fallback (should primarily be text nodes, handled by schema.text, or misconfigured nodes)
        calculatedContentSize = finalContent.reduce((sum, child) => sum + child.nodeSize, 0);
        console.warn(`Node type ${this.name} using fallback size calculation. Assuming content size only.`);
        calculatedNodeSize = calculatedContentSize;
    }

    const nodeObject: ModelNode = {
      type: this,
      attrs: finalAttrs,
      content: finalContent.length > 0 ? finalContent : [], // Ensure content is an array, even if empty
      nodeSize: calculatedNodeSize,
      isLeaf: isNodeLeaf,
      isText: isNodeText,
      // marks: For non-text inline nodes, marks could be passed via _marks
    } as unknown as ModelNode;

    if (this.name === this.schema.topNodeType.name) {
      (nodeObject as any).contentSize = calculatedContentSize;
    }

    return nodeObject;
  }

  public defaultAttrs(attrs?: Attrs): Attrs {
    const defaulted: Attrs = {};
    for (const attrName in this.spec.attrs) {
      const attrSpec = this.spec.attrs[attrName];
      if (attrs && attrs[attrName] !== undefined) {
        defaulted[attrName] = attrs[attrName];
      } else if (attrSpec.default !== undefined) {
        defaulted[attrName] = attrSpec.default;
      } else {
        // Attribute not provided and no default: error or skip?
        // For now, skip. Could add validation later.
      }
    }
    return defaulted;
  }

  public toDOM(node: ModelNode): DOMOutputSpec {
    if (this.spec.toDOM) {
      return this.spec.toDOM(node);
    }
    // Default simple rendering if no toDOM spec
    // This is very basic and would need more sophistication
    if (this.isBlock) return ["div", 0]; // 0 is content hole
    if (this.spec.inline) return ["span", 0];
    return ""; // Should not happen for valid nodes
  }
}

export class MarkType {
  constructor(
    public readonly name: string,
    public readonly spec: MarkSpec,
    public readonly schema: Schema // Reference back to the schema it belongs to
  ) {}

  public create(attrs?: Attrs): ModelAnyMark {
    const defaultedAttrs = this.defaultAttrs(attrs);
    const markInstance: ModelAnyMark = {
      type: this,
      attrs: defaultedAttrs,
      eq(other: ModelAnyMark): boolean {
        if (this === other) return true;
        if (!other) return false;
        // Ensure attrsEq is available here. If not imported, it needs to be defined in this file.
        return this.type === other.type && attrsEq(this.attrs, other.attrs);
      }
    };
    return markInstance;
  }

  private defaultAttrs(attrs?: Attrs): Attrs {
    const defaulted: Attrs = {};
    for (const attrName in this.spec.attrs) {
      const attrSpec = this.spec.attrs[attrName];
      if (attrs && attrs[attrName] !== undefined) {
        defaulted[attrName] = attrs[attrName];
      } else if (attrSpec.default !== undefined) {
        defaulted[attrName] = attrSpec.default;
      }
    }
    return defaulted;
  }

  public toDOM(mark: ModelAnyMark, inlineContent: boolean): DOMOutputSpec {
    if (this.spec.toDOM) {
      return this.spec.toDOM(mark, inlineContent);
    }
    // Default simple rendering
    return [this.name, 0]; // e.g., ["strong", 0]
  }
}

export class Schema {
  public readonly nodes: { [name: string]: NodeType };
  public readonly marks: { [name: string]: MarkType };
  public readonly topNodeType: NodeType; // Usually 'doc'
  private nodeIdCounter: number = 1; // Instance-specific counter for IDs

  constructor(config: {
    nodes: { [name: string]: NodeSpec };
    marks: { [name: string]: MarkSpec };
  }) {
    this.nodes = {};
    this.marks = {};

    // Initialize NodeTypes
    for (const name in config.nodes) {
      this.nodes[name] = new NodeType(name, config.nodes[name], this);
    }

    // Initialize MarkTypes
    for (const name in config.marks) {
      this.marks[name] = new MarkType(name, config.marks[name], this);
    }

    if (!this.nodes.doc) throw new Error("Schema must define a 'doc' node type.");
    if (!this.nodes.text) throw new Error("Schema must define a 'text' node type.");

    this.topNodeType = this.nodes.doc;

    // TODO: Further validation (e.g., content expressions refer to existing nodes)
    // TODO: Resolve mark allow/disallow lists (`spec.marks` in NodeType)
  }

  public node(
    type: string | NodeType,
    attrs?: Attrs,
    content?: ReadonlyArray<ModelNode> | ModelNode, // Should be ModelNode once refactored
    marks?: ReadonlyArray<ModelAnyMark> // Marks are typically for text nodes, but inline nodes can have them.
  ): ModelNode {
    const nodeType = typeof type === 'string' ? this.nodes[type] : type;
    if (!nodeType) throw new Error(`Unknown node type: ${type}`);
    if (nodeType.isText) throw new Error("Cannot use schema.node() for text nodes; use schema.text() instead.");

    return nodeType.create(attrs, content, marks);
  }

  public text(text: string, marks?: ReadonlyArray<ModelAnyMark>): ModelTextNode {
    const textNodeType = this.nodes.text;
    if (!textNodeType) throw new Error("Text node type not defined in schema");

    const defaultedAttrs = textNodeType.defaultAttrs(null); // Text nodes typically don't have specific attrs beyond defaults

    return {
      type: textNodeType,
      attrs: defaultedAttrs,
      text: text,
      marks: marks || [], // Ensure marks is an array
      nodeSize: text.length, // nodeSize for text node is its length
      isText: true,          // Mark as text node
      isLeaf: false,         // Text nodes are not considered leaves in the same way <br> is; they have "content" (the text itself)
      content: [],           // Text nodes don't have child nodes, so content is empty array
    } as unknown as ModelTextNode;
  }

  public generateNodeId(): string {
    return `ritor-node-${this.nodeIdCounter++}`;
  }

  // Helper to create a top-level document node
  public createDoc(content: ReadonlyArray<ModelNode>): ModelNode {
      return this.topNodeType.create(null, content);
  }
}

console.log("schema.ts defined: Schema, NodeType, MarkType classes.");
