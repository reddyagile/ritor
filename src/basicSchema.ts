// src/basicSchema.ts
import { NodeSpec, MarkSpec, Attrs, DOMOutputSpec, ParseRule } from './schemaSpec.js'; // Added ParseRule import
import { BaseNode, Mark as ModelMark } from './documentModel.js';

export const basicNodeSpecs: { [name: string]: NodeSpec } = {
  doc: {
    content: "block*", // Allow empty doc (0 or more blocks)
    toDOM: (node: BaseNode): DOMOutputSpec => {
        const attrs: Attrs = { class: "ritor-document" };
        if (node.attrs?.id) {
            attrs.id = node.attrs.id;
        }
        return ["div", attrs, 0];
    },
    // No parseDOM for doc, it's the root.
  },
  paragraph: {
    content: "inline*",
    group: "block",
    attrs: { id: {} },
    toDOM: (node: BaseNode): DOMOutputSpec => {
      const attrs: Attrs = {};
      if (node.attrs?.id) {
        attrs.id = node.attrs.id;
      }
      return ["p", attrs, 0];
    },
    parseDOM: [{ tag: "p" }]
  },
  text: {
    group: "inline",
    inline: true,
    // atom: false, // Text nodes are not atoms, they have content (the text chars)
    // No toDOM for text nodes, handled by parent/serializer.
    // No parseDOM for text nodes, DOMParser handles TEXT_NODE directly.
  },
  hard_break: {
    inline: true,
    atom: true, // This makes it a leaf node with nodeSize 1
    group: "inline",
    toDOM: (_node: BaseNode): DOMOutputSpec => ["br"],
    parseDOM: [{ tag: "br" }]
  },
  heading: {
    attrs: {
        level: { default: 1 },
        id: {}
    },
    content: "inline*",
    group: "block",
    defining: true,
    toDOM: (node: BaseNode): DOMOutputSpec => {
        const attrs: Attrs = {};
        if (node.attrs?.id) {
            attrs.id = node.attrs.id;
        }
        return [`h${node.attrs?.level || 1}`, attrs, 0];
    },
    parseDOM: [
        { tag: "h1", getAttrs: (_domNode) => ({level: 1}) }, // getAttrs now consistent
        { tag: "h2", getAttrs: (_domNode) => ({level: 2}) },
        { tag: "h3", getAttrs: (_domNode) => ({level: 3}) },
        { tag: "h4", getAttrs: (_domNode) => ({level: 4}) },
        { tag: "h5", getAttrs: (_domNode) => ({level: 5}) },
        { tag: "h6", getAttrs: (_domNode) => ({level: 6}) },
    ],
  },
  list_item: {
    content: "paragraph+",
    group: "list_item_block",
    defining: true,
    attrs: { id: {} },
    toDOM: (node: BaseNode): DOMOutputSpec => ["li", { id: node.attrs!.id }, 0],
    parseDOM: [{ tag: "li" }],
  },
  bullet_list: {
    content: "list_item+",
    group: "block",
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
        getAttrs: (domNode: globalThis.Node | string) => { // Changed dom to domNode
            const htmlElement = domNode as HTMLElement;
            const start = htmlElement.getAttribute("start");
            return {
                order: start ? parseInt(start, 10) : 1,
                // id will be handled by default if not specified by getAttrs
            };
        },
    }],
  },
  blockquote: {
    content: "block+",
    group: "block",
    defining: true,
    attrs: { id: {} },
    toDOM: (node: BaseNode): DOMOutputSpec => ["blockquote", { id: node.attrs!.id }, 0],
    parseDOM: [{ tag: "blockquote" }],
  }
};

export const basicMarkSpecs: { [name: string]: MarkSpec } = {
  bold: {
    toDOM: (_mark: ModelMark, _inline: boolean): DOMOutputSpec => ["strong", 0],
    parseDOM: [
        {tag: "strong"},
        {tag: "b"},
        {style: "font-weight=bold"},
        {style: "font-weight=700"}, // Order matters, more specific might go first if needed
        {style: "font-weight=600"}
    ]
  },
  italic: {
    toDOM: (_mark: ModelMark, _inline: boolean): DOMOutputSpec => ["em", 0],
    parseDOM: [
        {tag: "i"},
        {tag: "em"},
        {style: "font-style=italic"}
    ]
  },
  strikethrough: {
    toDOM: (_mark: ModelMark, _inline: boolean): DOMOutputSpec => ["s", 0],
    parseDOM: [
        { tag: "s" },
        { tag: "del" },
        { tag: "strike" },
        { style: "text-decoration=line-through" },
        { style: "text-decoration-line=line-through" } // More modern CSS property
    ]
  },
  link: {
    attrs: {
        href: { default: "" }, // Ensure href is always present
        title: { default: null }
    },
    inclusive: false,
    toDOM: (mark: ModelMark, _inline: boolean): DOMOutputSpec => {
        const markAttrs = mark.attrs as { href: string, title?: string };
        const domAttrs: Attrs = { href: markAttrs.href };
        if (markAttrs.title) {
            domAttrs.title = markAttrs.title;
        }
        return ["a", domAttrs, 0];
    },
    parseDOM: [{
        tag: "a", // Simpler tag, check for href in getAttrs
        getAttrs: (domNodeOrValue: globalThis.Node | string) => {
            const dom = domNodeOrValue as HTMLAnchorElement;
            const href = dom.getAttribute("href");
            if (!href) return false; // Don't match if 'a' tag has no href
            return {
                href: href,
                title: dom.getAttribute("title") || null // Ensure title is null if not present
            };
        }
    }]
  }
};

console.log("basicSchema.ts defined with specs for doc, paragraph, text, hard_break, bold, italic, strikethrough, and link.");
