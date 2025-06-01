import {
  DocNode,
  ParagraphNode,
  TextNode,
  HardBreakNode,
  AnyMark,
  // LinkMark,
  BaseNode,
  TextNode as ModelTextNode, // Use alias if TextNode name conflicts or for clarity
  // DocNode, ParagraphNode, HardBreakNode specific types might be replaced by BaseNode checks + node.type.name
} from './documentModel.js';
import { NodeType, MarkType } from './schema.js'; // Import NodeType and MarkType
import { DOMOutputSpec, Attrs } from './schemaSpec.js';

// --- HTML Escaping Utility ---
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// --- Removed Mark to Tag Mapping ---
// This will now be handled by MarkType.toDOM defined in the schema.

// --- Node Rendering Logic ---

function renderDOMOutputSpec(spec: DOMOutputSpec, contentRenderer?: () => string): string {
  if (typeof spec === 'string') {
    return spec; // e.g., "br"
  }

  const tag = spec[0];
  let html = `<${tag}`;
  let contentHtml = "";
  let hasContentHole = false;

  const attrs = spec[1];
  if (typeof attrs === 'object' && attrs !== null && !Array.isArray(attrs)) { // Check if it's an Attrs object
    for (const key in attrs) {
      if (attrs[key] !== null && attrs[key] !== undefined) {
        html += ` ${key}="${escapeHtml(String(attrs[key]))}"`;
      }
    }
    if (spec.length > 2 && spec[2] === 0) { // ["tag", {attrs}, 0, ...more]
      hasContentHole = true;
    }
  } else if (attrs === 0) { // ["tag", 0, ...more]
    hasContentHole = true;
  }

  // For void elements like <br>, <hr>, <img>, they shouldn't have a closing tag or content.
  // A proper list of void elements would be better.
  const voidElements = ["br", "hr", "img"];
  if (voidElements.includes(tag)) {
      html += ">";
      return html;
  }

  html += ">"; // Close opening tag

  if (hasContentHole) {
    if (contentRenderer) {
      contentHtml = contentRenderer();
    }
    html += contentHtml;
  } else if (typeof attrs !== 'object' && contentRenderer) {
    // If attrs was not an object (e.g. it was the content hole 0, or not provided)
    // and there's a content renderer, render the content.
    // This path is taken if spec is like ["tag", 0] or just ["tag"] and content is expected.
    // However, for ["tag"], content is usually not from a hole but direct children.
    // This needs careful handling based on DOMOutputSpec structure.
    // For now, assume if contentRenderer is provided, it's for the hole.
  }


  html += `</${tag}>`;
  return html;
}

// Exported for use in DomPatcher for more granular updates
export function renderInlineNodes(nodes: ReadonlyArray<BaseNode>, schema: any): string {
  let html = '';
  let activeMarks: ReadonlyArray<AnyMark> = [];

  function getMarkTags(mark: AnyMark, opening: boolean): string {
    const markType = mark.type as MarkType; // Mark.type is MarkType
    const spec = markType.toDOM(mark, true); // true for inline context
    if (typeof spec === 'string') return ""; // Simple string spec not for wrapping

    let tagHtml = "";
    if (spec[0]) { // Has a tag name
        if (opening) {
            tagHtml = `<${spec[0]}`;
            if (typeof spec[1] === 'object' && spec[1] !== null) {
                for (const key in spec[1]) {
                    tagHtml += ` ${key}="${escapeHtml(String(spec[1][key]))}"`;
                }
            }
            tagHtml += ">";
        } else {
            tagHtml = `</${spec[0]}>`;
        }
    }
    return tagHtml;
  }

  for (const node of nodes) {
    const nodeType = node.type as NodeType; // node.type is NodeType
    if (nodeType.isText) {
      const textNode = node as TextNode;
      const desiredMarks = textNode.marks || [];

      // Close marks that are no longer active
      // Iterate in reverse order of active marks to close inner ones first
      for (let i = activeMarks.length - 1; i >= 0; i--) {
        const currentMark = activeMarks[i];
        // If currentMark is not in desiredMarks (compare by type and attrs for robustness)
        if (!desiredMarks.some(m => m.type === currentMark.type && JSON.stringify(m.attrs) === JSON.stringify(currentMark.attrs))) {
          html += getMarkTags(currentMark, false); // false for closing tag
        }
      }

      // Open new marks
      const newMarksToOpen: AnyMark[] = [];
      for (const desiredMark of desiredMarks) {
        if (!activeMarks.some(m => m.type === desiredMark.type && JSON.stringify(m.attrs) === JSON.stringify(desiredMark.attrs))) {
          newMarksToOpen.push(desiredMark);
        }
      }
      // Open in the order they appear in desiredMarks
      for (const markToOpen of newMarksToOpen) {
          html += getMarkTags(markToOpen, true); // true for opening tag
      }

      html += escapeHtml(textNode.text);
      activeMarks = [...desiredMarks]; // Update active marks, ensure copy

    } else if (nodeType.spec.atom) { // e.g., hard_break
      // Close any active marks before an atom node if they shouldn't span it
      for (let i = activeMarks.length - 1; i >= 0; i--) {
        html += getMarkTags(activeMarks[i], false);
      }
      activeMarks = []; // Reset active marks

      const domSpec = nodeType.toDOM(node);
      html += renderDOMOutputSpec(domSpec); // Render the atom node itself
    }
    // Other inline non-text, non-atom nodes could be handled here if any
  }

  // Close any remaining active marks at the end of the inline content
  for (let i = activeMarks.length - 1; i >= 0; i--) {
    html += getMarkTags(activeMarks[i], false);
  }

  return html;
}

export function renderNodeToHtml(node: BaseNode, schema?: any): string { // Schema might be needed for inline rendering context
  const nodeType = node.type as NodeType; // node.type is NodeType

  if (nodeType.isText) { // Text nodes are handled by their parent's inline rendering
    return escapeHtml((node as TextNode).text);
  }

  const domSpec = nodeType.toDOM(node);

  return renderDOMOutputSpec(domSpec, () => {
    let contentHtml = "";
    if (node.content && node.content.length > 0) {
      if (nodeType.inlineContent || nodeType.name === 'paragraph') { // Paragraphs contain inline content
        contentHtml = renderInlineNodes(node.content, schema);
      } else { // Block content
        for (const contentNode of node.content) {
          contentHtml += renderNodeToHtml(contentNode, schema);
        }
      }
    }
    return contentHtml;
  });
}

export function renderDocumentToHtml(doc: BaseNode, schema?: any): string { // Doc is a BaseNode
  // Ensure schema is passed down if it's needed by renderNodeToHtml, esp. for inline content within blocks
  return renderNodeToHtml(doc, schema);
}

import { pathToFileURL } from 'node:url';
import process from 'node:process';

// --- Example Usage (will be updated to use Schema) ---
// Check if the module is being run directly
const isMainModule = import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  console.log('--- Model Renderer Examples (Schema-driven) ---');

  // This example usage will need to be updated once RitorVDOM uses the schema
  // For now, it will break because createDoc etc. are deprecated / behave differently.
  // We'll test the renderer via RitorVDOM's initialization and methods later.

  // To manually test renderer with schema-based nodes (conceptual):
  /*
  const mySchema = new Schema({ nodes: basicNodeSpecs, marks: basicMarkSpecs }); // Assuming basicNodeSpecs/Marks are imported

  const simpleDoc = mySchema.createDoc([
    mySchema.node("paragraph", null, [
      mySchema.text("Hello, "),
      mySchema.text("World!", [mySchema.marks.bold.create()]),
      mySchema.text(" This is "),
      mySchema.text("italic and underlined", [mySchema.marks.italic.create(), mySchema.marks.underline.create()]), // Assuming underline is added to basicMarkSpecs
      mySchema.text(". And this is a "),
      mySchema.text("link", [mySchema.marks.link.create({ href: "https://example.com" })]), // Assuming link is added
      mySchema.text(".")
    ]),
    mySchema.node("paragraph", null, [
      mySchema.text("Another paragraph with a "),
      mySchema.node("hard_break"),
      mySchema.text(" new line.")
    ])
  ]);

  console.log('\nSimple Schema Document (JSON):');
  // JSON.stringify won't be as readable with NodeType/MarkType objects directly,
  // might need a custom serializer for nodes if deep logging is needed.
  // console.log(JSON.stringify(simpleDoc, (key, value) => {
  //   if (key === 'type' && (value instanceof NodeType || value instanceof MarkType)) {
  //     return value.name; // Serialize type by name for readability
  //   }
  //   return value;
  // }, 2));

  console.log('\nRendered HTML (Schema-driven):');
  const htmlOutput = renderDocumentToHtml(simpleDoc);
  console.log(htmlOutput);
  */
  console.log("Renderer example needs update after RitorVDOM schema integration.");
}
