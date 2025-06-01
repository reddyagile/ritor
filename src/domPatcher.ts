import {
  BaseNode,
  // DocNode, ParagraphNode, BlockNode etc. are compatible with BaseNode.
  // Specific types might be used for casting if necessary after checks.
} from './documentModel.js'; // Assuming .js for ESM runtime
import { renderDocumentToHtml, renderNodeToHtml } from './modelRenderer.js'; // Assuming .js
import { Schema } from './schema.js'; // Schema might be needed for context in rendering

// Helper to convert HTML string to a single DOM element
function htmlToElement(html: string): HTMLElement | null {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstChild as HTMLElement | null;
}

import { TextNode as ModelTextNode } from './documentModel.js'; // For casting
import { areMarksEqual } from './modelUtils.js'; // Import areMarksEqual
import { Attrs } from './schemaSpec.js';
import { NodeType } from './schema.js';


// Helper for shallow attribute comparison
function areAttrsEqual(attrsA: Attrs | undefined, attrsB: Attrs | undefined): boolean {
  if (attrsA === attrsB) return true;
  if (!attrsA || !attrsB) return false; // One is null/undefined, the other isn't (or both are but caught by ===)

  const keysA = Object.keys(attrsA);
  const keysB = Object.keys(attrsB);

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (attrsA[key] !== attrsB[key]) {
      // For PoC, simple strict equality. Could be extended for deep attr comparison if needed.
      return false;
    }
  }
  return true;
}


export class DomPatcher {
  // This method is now part of the class to access this.schema if needed,
  // and potentially modelUtils if areMarksEqual wasn't exported.
  private areNodesEffectivelyEqual(nodeA: BaseNode | null, nodeB: BaseNode | null): boolean {
    if (nodeA === nodeB) return true; // Reference equality first
    if (!nodeA || !nodeB) return false;
    if (nodeA.type !== nodeB.type) return false; // Crucial: type is NodeType instance

    if (!areAttrsEqual(nodeA.attrs, nodeB.attrs)) return false;

    const nodeType = nodeA.type as NodeType; // Cast once

    if (nodeType.isText) {
      const textNodeA = nodeA as ModelTextNode;
      const textNodeB = nodeB as ModelTextNode;
      if (textNodeA.text !== textNodeB.text) return false;
      if (!areMarksEqual(textNodeA.marks, textNodeB.marks)) return false; // Use imported areMarksEqual
      return true;
    }

    if (nodeType.spec.atom) { // For atom nodes like hard_break
        return true; // Type and attrs already checked
    }

    // For container nodes (paragraph, doc, etc.)
    // Compare content array by reference first for performance.
    // If model logic always creates new content arrays on any child change, this is effective.
    if (nodeA.content === nodeB.content) return true;

    // If content arrays are different instances, check if their children are effectively equal.
    // This makes the check deep for content, which might be too slow.
    // For this PoC, we'll stick to reference for content array for container nodes.
    // A more advanced patcher would recursively call patch on children if content array differs.
    // The current patch() logic handles this by re-rendering inline content if block content array differs.
    // So for areNodesEffectivelyEqual, if type, attrs are same, and content array ref is different,
    // we assume it's different enough to warrant a deeper look by the patch function.
    // However, the prompt asked for `(nodeA as ParagraphNode).content === (nodeB as ParagraphNode).content`
    // which is reference equality.
    if (nodeA.content && nodeB.content) {
        if (nodeA.content === nodeB.content) return true; // Reference check for content array
        // If we need to compare content deeply (not recommended for this PoC step here, but for completeness):
        // if (nodeA.content.length !== nodeB.content.length) return false;
        // for (let i = 0; i < nodeA.content.length; i++) {
        //   if (!this.areNodesEffectivelyEqual(nodeA.content[i], nodeB.content[i])) return false;
        // }
        // For the PoC, if content array references are different, we'll let patch handle it.
        // So, if we reach here, it means type & attrs are same.
        // If it's a container and content array refs differ, it's considered different for patch.
        return false;
    } else if (nodeA.content || nodeB.content) { // One has content, the other doesn't
        return false;
    }

    return true; // All checks passed
  }

  private updateDomAttributes(element: HTMLElement, oldAttrs: Attrs | undefined, newAttrs: Attrs | undefined) {
    oldAttrs = oldAttrs || {};
    newAttrs = newAttrs || {};

    // Remove attributes that are in oldAttrs but not in newAttrs
    for (const key in oldAttrs) {
      if (!(key in newAttrs) || newAttrs[key] === undefined || newAttrs[key] === null) {
        if (key === 'class' && !newAttrs[key]) { // Handle class specifically if needed
            element.removeAttribute('class');
        } else if (key === 'style') {
            element.style.cssText = ""; // Clear style
        }
        else {
            element.removeAttribute(key);
        }
      }
    }

    // Set/update attributes that are in newAttrs
    for (const key in newAttrs) {
      const oldValue = oldAttrs[key];
      const newValue = newAttrs[key];
      if (newValue === null || newValue === undefined) {
          if (key === 'class') element.removeAttribute('class');
          else if (key === 'style') element.style.cssText = "";
          else element.removeAttribute(key);
      } else if (oldValue !== newValue) {
        if (key === 'class') {
            element.className = newValue; // Overwrite class entirely for simplicity
        } else if (key === 'style' && typeof newValue === 'object') { // Assuming style can be an object
            // element.style.cssText = ""; // Clear existing
            // Object.assign(element.style, newValue); // Not safe for all CSS props & needs camelCase
            // For PoC, if style is a string:
             if(typeof newValue === 'string') element.style.cssText = newValue;
        } else {
            element.setAttribute(key, String(newValue));
        }
      }
    }
  }
  private rootElement: HTMLElement;
  private currentDoc: BaseNode | null = null; // DocNode is compatible with BaseNode
  private schema?: Schema; // Make DomPatcher schema-aware for passing to renderer

  constructor(rootElement: HTMLElement, initialDoc: BaseNode, schema?: Schema) {
    this.rootElement = rootElement;
    this.schema = schema; // Store the schema

    // initialDoc must be provided, old default creation is removed as factories are deprecated.
    // The RitorVDOM class will now be responsible for creating the initial document using the schema.
    this.patch(initialDoc);
  }

  public patch(newDoc: BaseNode): void { // newDoc is a BaseNode (specifically a DocNode)
    if (this.currentDoc === newDoc) { // Strict reference check first
      // console.log("DomPatcher: Skipping patch for identical document reference.");
      return;
    }
    const renderOpts = this.schema;

    if (!this.currentDoc || this.rootElement.innerHTML === '' || !this.currentDoc.content || this.currentDoc.content.length === 0) {
      const fullHtml = renderDocumentToHtml(newDoc, renderOpts);
      this.rootElement.innerHTML = fullHtml;
      this.currentDoc = newDoc;
      return;
    }

    const oldBlockNodes = this.currentDoc.content || [];
    const newBlockNodes = newDoc.content || [];

    const oldBlockKeys = new Set<string>();
    const oldKeyToDOMNode = new Map<string, HTMLElement>();
    const oldKeyToModelNode = new Map<string, BaseNode>();

    oldBlockNodes.forEach(node => {
      if (node.attrs?.id) {
        oldBlockKeys.add(node.attrs.id as string);
        oldKeyToModelNode.set(node.attrs.id as string, node);
      }
    });

    for (let i = 0; i < this.rootElement.children.length; i++) {
        const domNode = this.rootElement.children[i] as HTMLElement;
        if (domNode.id) {
            // Only map if this ID was actually in our old model keys.
            // This avoids mapping unrelated DOM elements if rootElement is shared.
            if(oldKeyToModelNode.has(domNode.id)) {
                 oldKeyToDOMNode.set(domNode.id, domNode);
            }
        }
    }

    let lastPlacedNode: ChildNode | null = null;

    // Iterate newBlockNodes to update/add/move
    newBlockNodes.forEach((newBlockNode, index) => {
      const newKey = newBlockNode.attrs?.id as string | undefined;
      let domNodeToUpdate: HTMLElement | undefined = undefined;
      let oldModelNode: BaseNode | undefined = undefined;

      if (newKey) {
        oldModelNode = oldKeyToModelNode.get(newKey);
        domNodeToUpdate = oldKeyToDOMNode.get(newKey);
      } else {
        // This is a new node without a key, or an old node that lost its key.
        // For PoC, we might try to find an unkeyed node at the same position if appropriate,
        // but keyed diffing prefers keys. If no key, it's generally treated as new.
        // However, our current ID generation ensures all blocks have IDs.
        console.warn("New block node without an ID encountered:", newBlockNode);
        // Fallback: treat as new and insert.
      }

      if (domNodeToUpdate && oldModelNode) { // Keyed node found in old DOM and model
        // Node exists, potentially update and move
        if (oldModelNode.type !== newBlockNode.type) {
          const newRenderedHtml = renderNodeToHtml(newBlockNode, renderOpts);
          const newRenderedDom = htmlToElement(newRenderedHtml);
          if (newRenderedDom) {
            this.rootElement.replaceChild(newRenderedDom, domNodeToUpdate);
            domNodeToUpdate = newRenderedDom; // Update reference to the new DOM node
          }
        } else {
          // Types are same, granular update
          if (!areAttrsEqual(oldModelNode.attrs, newBlockNode.attrs)) {
            this.updateDomAttributes(domNodeToUpdate, oldModelNode.attrs, newBlockNode.attrs);
          }
          if ( (oldModelNode.type as NodeType).name === 'paragraph' && // Example for paragraph
               (oldModelNode.content !== newBlockNode.content || !this.areNodesEffectivelyEqual(oldModelNode, newBlockNode))
             ) {
                if (newBlockNode.content) {
                    domNodeToUpdate.innerHTML = renderInlineNodes(newBlockNode.content, this.schema);
                } else {
                    domNodeToUpdate.innerHTML = "";
                }
          } else if (!(oldModelNode.type as NodeType).isText && !(oldModelNode.type as NodeType).spec.atom && oldModelNode.content !== newBlockNode.content) {
             // Generic container content change - simplified to re-render if content array ref differs
             if (newBlockNode.content) {
                domNodeToUpdate.innerHTML = renderInlineNodes(newBlockNode.content, this.schema); // Assuming renderInlineNodes works for generic BaseNode[]
             } else {
                domNodeToUpdate.innerHTML = "";
             }
          }
        }

        // Positioning
        const expectedNextSibling = lastPlacedNode ? lastPlacedNode.nextSibling : this.rootElement.firstChild;
        if (expectedNextSibling !== domNodeToUpdate) {
            this.rootElement.insertBefore(domNodeToUpdate, expectedNextSibling);
        }
        lastPlacedNode = domNodeToUpdate;
        if (newKey) oldBlockKeys.delete(newKey); // Mark as processed

      } else { // New node (either new key or no key)
        const newRenderedHtml = renderNodeToHtml(newBlockNode, renderOpts);
        const newRenderedDom = htmlToElement(newRenderedHtml);
        if (newRenderedDom) {
          const EOLMarker = lastPlacedNode ? lastPlacedNode.nextSibling : this.rootElement.firstChild;
          this.rootElement.insertBefore(newRenderedDom, EOLMarker);
          lastPlacedNode = newRenderedDom;
          // If this new node had a key that was somehow in oldBlockKeys (e.g. duplicate new keys), remove it.
          if (newKey) oldBlockKeys.delete(newKey);
        }
      }
    });

    // Cleanup: Remove old nodes that are no longer present
    oldBlockKeys.forEach(keyToRemove => {
      const domNodeToRemove = oldKeyToDOMNode.get(keyToRemove);
      if (domNodeToRemove) {
        this.rootElement.removeChild(domNodeToRemove);
      }
    });

    this.currentDoc = newDoc;
  }
  }
}

// --- Example Usage Sketch ---
// This would typically be in an HTML file or a separate main script for browser environment

/*
// index.html:
// <!DOCTYPE html>
// <html>
// <head><title>Ritor DOM Patcher Test</title></head>
// <body>
//   <div id="editor-root"></div>
//   <button id="updateButton">Update Document</button>
//   <script type="module" src="example.js"></script>
// </body>
// </html>

// example.js (conceptual - needs browser environment to run)
// import { DomPatcher } from './domPatcher.js';
// import { createDoc, createParagraph, createText, createBoldMark, createItalicMark } from './documentModel.js';

function runExample() {
  const editorRoot = document.getElementById('editor-root');
  if (!editorRoot) {
    console.error("Editor root element not found!");
    return;
  }

  const initialDoc = createDoc([
    createParagraph([createText("Hello, ")]),
    createParagraph([createText("World!", [createBoldMark()])])
  ]);

  const patcher = new DomPatcher(editorRoot, initialDoc);
  console.log("Initial document patched.");
  console.log("Root HTML:", editorRoot.innerHTML);


  const updateButton = document.getElementById('updateButton');
  if (updateButton) {
    updateButton.onclick = () => {
      console.log("Updating document...");
      const modifiedDoc = createDoc([
        createParagraph([createText("Hello, ")]), // Same
        createParagraph([createText("Patched World!", [createItalicMark()])]), // Changed
        createParagraph([createText("This is a new paragraph.")]) // Added
      ]);
      patcher.patch(modifiedDoc);
      console.log("Modified document patched.");
      console.log("Root HTML:", editorRoot.innerHTML);

      // Test removing a paragraph
      const furtherModifiedDoc = createDoc([
        createParagraph([createText("Hello, ")]),
        createParagraph([createText("This is a new paragraph.")])
      ]);
      patcher.patch(furtherModifiedDoc);
      console.log("Further modified document patched (paragraph removed).");
      console.log("Root HTML:", editorRoot.innerHTML);


      // Test empty document
      const emptyDoc = createDoc([]);
      patcher.patch(emptyDoc);
      console.log("Emptied document.");
      console.log("Root HTML:", editorRoot.innerHTML);


      // Test rendering to empty root again
      const finalDoc = createDoc([createParagraph([createText("Final Text.")])]);
      patcher.patch(finalDoc);
      console.log("Final document to empty root.");
      console.log("Root HTML:", editorRoot.innerHTML);

    };
  }
}

// To run this, you'd typically use a simple HTTP server (like `npx serve`)
// and open the HTML file in a browser with the console open.
// The `DomPatcher` class itself doesn't have a main execution block for Node.js direct run.
// For Node.js direct run for testing (requires jsdom or similar):
// This example usage part needs to be updated to use schema for document creation if run.
/*
if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test_node') {
    // This block is for conceptual Node.js testing with a fake DOM.
    // Requires a DOM environment like JSDOM and a schema instance.
    // Example:
    // const { JSDOM } = require('jsdom');
    // const dom = new JSDOM('<!DOCTYPE html><body><div id="editor-root"></div></body>');
    // global.document = dom.window.document;
    // global.HTMLElement = dom.window.HTMLElement;
    // global.Node = dom.window.Node;
    // global.HTMLTemplateElement = dom.window.HTMLTemplateElement;
    // const { Schema } = require('./schema.js'); // Adjust path
    // const { basicNodeSpecs, basicMarkSpecs } = require('./basicSchema.js'); // Adjust path
    // const testSchema = new Schema({ nodes: basicNodeSpecs, marks: basicMarkSpecs });


    console.log("--- DOM Patcher Node.js Test Sketch (requires JSDOM setup) ---");
    const mockRoot = document.createElement('div');

    const initialTestDoc = testSchema.node("doc", null, [
        testSchema.node("paragraph", null, [testSchema.text("Initial Paragraph for Node Test")])
    ]);
    const patcherInstance = new DomPatcher(mockRoot, initialTestDoc, testSchema);
    console.log("Initial (Node):", mockRoot.innerHTML);

    const modifiedTestDoc = testSchema.node("doc", null, [
        testSchema.node("paragraph", null, [testSchema.text("Modified Paragraph for Node Test")]),
        testSchema.node("paragraph", null, [testSchema.text("Second Paragraph for Node Test")])
    ]);
    patcherInstance.patch(modifiedTestDoc);
    console.log("Modified (Node):", mockRoot.innerHTML);
}
*/
console.log("DomPatcher class defined. Example usage is sketched for browser environment or Node.js with JSDOM.");
