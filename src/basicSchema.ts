// src/basicSchema.ts
import { NodeSpec, MarkSpec, Attrs, DOMOutputSpec } from './schemaSpec.js';
import { BaseNode, Mark as ModelMark } from './documentModel.js'; // Assuming .js for ESM runtime

export const basicNodeSpecs: { [name: string]: NodeSpec } = {
  doc: {
    content: "block+",
    // Assuming doc node itself might not need an ID in DOM if it's the root $el,
    // but if it were a nested doc or a different wrapper, it might.
    // For now, just a class for the main div.
    toDOM: (_node: BaseNode): DOMOutputSpec => ["div", { class: "ritor-document" }, 0],
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
  // Example for later:
  // heading: {
  //   attrs: { level: { default: 1 } },
  //   content: "inline*",
  //   group: "block",
  //   toDOM: (node: BaseNode) => [ `h${node.attrs?.level || 1}`, 0],
  // },
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
