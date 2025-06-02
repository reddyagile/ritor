// src/basicSchema.ts
import { NodeSpec, MarkSpec, Attrs, DOMOutputSpec, ParseRule } from './schemaSpec.js'; // Added ParseRule import
import { BaseNode, Mark as ModelMark } from './documentModel.js'; 

export const basicNodeSpecs: { [name: string]: NodeSpec } = {
  doc: {
    content: "(block | figure)+", // Allow blocks or figures, must have at least one.
    toDOM: (node: BaseNode): DOMOutputSpec => {
        const attrs: Attrs = { class: "ritor-document" };
        if (node.attrs?.id) { 
            attrs.id = node.attrs.id;
        }
        return ["div", attrs, 0];
    },
    // No parseDOM for doc, it's the root.
  },
  // Define special_paragraph_for_li before paragraph for parse rule precedence
  special_paragraph_for_li: { 
    content: "inline*",
    group: "block", 
    attrs: { id: {} },
    toDOM: (node: BaseNode): DOMOutputSpec => ["p", { id: node.attrs!.id, class:"special-li-p" }, 0],
    parseDOM: [{ tag: "p.special", context: "list_item/" }] 
  },
  paragraph: { // General paragraph rule
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
    parseDOM: [{ tag: "p" }] // This will only be reached if "p.special" with context didn't match
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
    content: "block+", // Simplified content model for debugging context parsing
    group: "list_item_block", 
    defining: true, 
    attrs: { id: {} },
    toDOM: (node: BaseNode): DOMOutputSpec => ["li", { id: node.attrs!.id }, 0],
    parseDOM: [{ tag: "li" }],
  },
  // special_paragraph_for_li is now defined before paragraph
  bullet_list: {
    content: "list_item+", 
    group: "block", 
    attrs: { id: {} },
    toDOM: (node: BaseNode): DOMOutputSpec => ["ul", { id: node.attrs!.id }, 0],
    parseDOM: [{ tag: "ul" }],
  },
  // Removed duplicate special_paragraph_for_li that was here
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
  },
  image: { 
    attrs: { src: { default: null }, alt: { default: null }, title: { default: null }, id: {} },
    atom: true, 
    group: "block", 
    toDOM: (node: BaseNode): DOMOutputSpec => {
        const { src, alt, title, id } = node.attrs!;
        const domAttrs: any = { id, src }; // Ensure ID is included
        if (alt) domAttrs.alt = alt;
        if (title) domAttrs.title = title;
        return ["img", domAttrs];
    },
    parseDOM: [{
        tag: "img[src]", 
        getAttrs: (dom: string | HTMLElement) => {
            if (typeof dom === 'string') return false;
            return {
                src: dom.getAttribute("src"),
                alt: dom.getAttribute("alt"),
                title: dom.getAttribute("title")
                // id will be auto-assigned if not specifically parsed
            };
        }
    }]
  },
  figcaption: { // New figcaption node
    content: "inline*",
    group: "block", // Conceptually a block, but part of figure
    attrs: { id: {} }, 
    toDOM: (node: BaseNode) => ["figcaption", { id: node.attrs!.id }, 0],
    parseDOM: [{ tag: "figcaption" }]
  },
  figure: { // New figure node with getContent
    content: "(image figcaption?)", // Model: image, then optional figcaption
    group: "block",
    attrs: { id: {} },
    toDOM: (node: BaseNode) => {
        const domAttrs: any = { id: node.attrs!.id };
        return ["figure", domAttrs, 0]; // Content hole for children
    },
    parseDOM: [{
        tag: "figure",
        getContent: (domFigure: HTMLElement, parserInst: any /* DOMParser */): BaseNode[] => {
            const children: BaseNode[] = [];
            const imgEl = domFigure.querySelector("img");
            const figcaptionEl = domFigure.querySelector("figcaption");

            if (imgEl) {
                const imgModelNode = parserInst.parseNode(imgEl); // Use instance method
                if (imgModelNode) { // parseNode returns BaseNode | null
                    // Ensure it's not an array (though parseNode for <img> should return single node or null)
                    if (!Array.isArray(imgModelNode)) {
                         children.push(imgModelNode);
                    } else if (imgModelNode.length > 0) {
                        // This case implies parseNode returned a list, which is unusual for <img>
                        // but could happen if text nodes with marks were returned. Unlikely for <img>.
                         children.push(...imgModelNode);
                    }
                }
            }
            if (figcaptionEl) {
                const figcaptionModelNode = parserInst.parseNode(figcaptionEl);
                if (figcaptionModelNode) {
                    if (!Array.isArray(figcaptionModelNode)) {
                        children.push(figcaptionModelNode);
                    } else if (figcaptionModelNode.length > 0) {
                        children.push(...figcaptionModelNode);
                    }
                }
            }
            return children;
        }
    }]
  }
};

export const basicMarkSpecs: { [name: string]: MarkSpec } = {
  bold: {
    toDOM: (_mark: ModelMark, _inline: boolean): DOMOutputSpec => ["strong", 0],
    parseDOM: [
        {tag: "strong"}, 
        {tag: "b"}, 
        // {style: "font-weight=bold"}, // Removed to prevent h1 from getting bold mark
        {style: "font-weight=700"}, 
        {style: "font-weight=600"}
        // To match "font-weight:bold" specifically on spans, use:
        // {tag: "span", style: "font-weight=bold"}
    ]
  },
  italic: {
    toDOM: (_mark: ModelMark, _inline: boolean): DOMOutputSpec => ["em", 0],
    parseDOM: [
        {tag: "i"}, 
        {tag: "em"}
        // {style: "font-style=italic"} // Remove to prevent e.g. <em> inside <i> from duplicating if styles are parsed too broadly
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
        tag: "a[href]", // Use attribute presence selector; getAttrs will still verify href
        getAttrs: (domNodeOrValue: globalThis.Node | string) => {
            const dom = domNodeOrValue as HTMLAnchorElement; 
            // href presence is already checked by the tag selector "a[href]"
            // but it's good practice to still get it here for the attribute value.
            const href = dom.getAttribute("href"); 
            // Though the rule a[href] ensures href exists, getAttribute can still return null if attr is empty string
            if (href === null) return false; // Should not happen if a[href] matched and browser enforces href presence
            return { 
                href: href, 
                title: dom.getAttribute("title") || null 
            };
        }
    }]
  }
};

console.log("basicSchema.ts defined with specs for doc, paragraph, text, hard_break, bold, italic, strikethrough, and link.");
