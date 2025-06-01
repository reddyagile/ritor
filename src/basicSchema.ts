// src/basicSchema.ts
import { NodeSpec, MarkSpec, Attrs, DOMOutputSpec } from './schemaSpec.js';
import { BaseNode, Mark as ModelMark } from './documentModel.js'; // Assuming .js for ESM runtime

export const basicNodeSpecs: { [name: string]: NodeSpec } = {
  doc: {
    content: "block+",
    // Assuming doc node itself might not need an ID in DOM if it's the root $el,
    // but if it were a nested doc or a different wrapper, it might.
    // For now, just a class for the main div.
    toDOM: (node: BaseNode): DOMOutputSpec => {
        // Doc node might also want an ID if we have multiple docs or nested ones later
        const attrs: Attrs = { class: "ritor-document" };
        if (node.attrs?.id) { // If doc nodes were to have IDs
            attrs.id = node.attrs.id;
        }
        return ["div", attrs, 0];
    },
  },
  paragraph: {
    content: "inline*",
    group: "block",
    attrs: { id: {} }, // Declare id as a possible attribute
    toDOM: (node: BaseNode): DOMOutputSpec => {
      const attrs: Attrs = {};
      if (node.attrs?.id) {
        attrs.id = node.attrs.id;
      }
      // Add other paragraph-specific attributes from node.attrs if any
      // For example, if paragraphs could have classes: attrs.class = node.attrs.class || "";
      return ["p", attrs, 0];
    },
  },
  text: {
    group: "inline",
    inline: true, // Explicitly inline
    // No toDOM for text nodes, handled by parent.
    // No content spec for text nodes, they are atomic regarding content.
  },
  hard_break: {
    inline: true,
    atom: true, // Leaf node
    group: "inline",
    toDOM: (_node: BaseNode): DOMOutputSpec => ["br"],
  },
  heading: {
    attrs: {
        level: { default: 1 },
        id: {} // Headings should also have IDs for keyed diffing
    },
    content: "inline*",
    group: "block",
    defining: true,
    toDOM: (node: BaseNode): DOMOutputSpec => {
        const attrs: Attrs = {};
        if (node.attrs?.id) {
            attrs.id = node.attrs.id;
        }
        // Add other heading-specific attributes from node.attrs if any
        return [`h${node.attrs?.level || 1}`, attrs, 0];
    },
    parseDOM: [
        { tag: "h1", attrs: { level: 1 } },
        { tag: "h2", attrs: { level: 2 } },
        { tag: "h3", attrs: { level: 3 } },
        // H4-H6 omitted for brevity but would follow the pattern
    ],
  },
  list_item: {
    content: "paragraph+", // Each list item contains one or more paragraphs
    group: "list_item_block", // A distinct group for list items to be contained by lists
    defining: true, // Important for joining behavior: you can't easily join two list items by backspace
    attrs: { id: {} },
    toDOM: (node: BaseNode): DOMOutputSpec => ["li", { id: node.attrs!.id }, 0],
    parseDOM: [{ tag: "li" }],
  },
  bullet_list: {
    content: "list_item+", // Must contain one or more list items
    group: "block", // Lists are top-level blocks
    attrs: { id: {} },
    toDOM: (node: BaseNode): DOMOutputSpec => ["ul", { id: node.attrs!.id }, 0],
    parseDOM: [{ tag: "ul" }],
  },
  ordered_list: {
    content: "list_item+",
    group: "block",
    attrs: {
        order: { default: 1 },
        id: {}
    },
    toDOM: (node: BaseNode): DOMOutputSpec => {
        const domAttrs: Attrs = { id: node.attrs!.id };
        if (node.attrs!.order !== null && node.attrs!.order !== undefined && node.attrs!.order !== 1) {
            domAttrs.start = node.attrs!.order;
        }
        return ["ol", domAttrs, 0];
    },
    parseDOM: [{
        tag: "ol",
        getAttrs: (dom: unknown) => {
            const htmlElement = dom as HTMLElement; // Type assertion
            const start = htmlElement.getAttribute("start");
            return {
                order: start ? parseInt(start, 10) : 1,
            };
        },
    }],
  }
};

export const basicMarkSpecs: { [name: string]: MarkSpec } = {
  bold: {
    toDOM: (_mark: ModelMark, _inline: boolean): DOMOutputSpec => ["strong", 0],
  },
  italic: {
    toDOM: (_mark: ModelMark, _inline: boolean): DOMOutputSpec => ["em", 0],
  },
  // Example for later:
  // link: {
  //   attrs: { href: {}, title: { default: null } },
  //   inclusive: false,
  //   toDOM: (mark: ModelMark, _inline: boolean): DOMOutputSpec => {
  //     const { href, title } = mark.attrs as { href: string, title?: string };
  //     const attrs: Attrs = { href };
  //     if (title) attrs.title = title;
  //     return ["a", attrs, 0];
  //   }
  // }
};

console.log("basicSchema.ts defined with specs for doc, paragraph, text, hard_break, bold, italic.");
