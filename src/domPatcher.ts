import {
  DocNode,
  ParagraphNode,
  BaseNode,
  BlockNode,
  // Factories for example usage if needed here, or assume they come from elsewhere
  createDoc,
  createParagraph,
  createText,
  createBoldMark
} from './documentModel.js'; // Assuming .js for ESM runtime
import { renderDocumentToHtml, renderNodeToHtml } from './modelRenderer.js'; // Assuming .js

// Helper to convert HTML string to a single DOM element
function htmlToElement(html: string): HTMLElement | null {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstChild as HTMLElement | null;
}

// Simple PoC node comparison
function areNodesEffectivelyEqual(nodeA: BaseNode | null, nodeB: BaseNode | null): boolean {
  if (!nodeA && !nodeB) return true; // Both null, considered equal
  if (!nodeA || !nodeB) return false; // One is null, the other isn't
  if (nodeA.type !== nodeB.type) return false; // Different types

  // For PoC, use JSON.stringify. Not performant for real use.
  // If using truly immutable nodes where changes always create new instances,
  // reference equality (nodeA === nodeB) would be better if unchanged nodes are reused.
  return JSON.stringify(nodeA) === JSON.stringify(nodeB);
}

export class DomPatcher {
  private rootElement: HTMLElement;
  private currentDoc: DocNode | null = null;

  constructor(rootElement: HTMLElement, initialDoc?: DocNode) {
    this.rootElement = rootElement;
    if (initialDoc) {
      this.patch(initialDoc);
    } else {
      // Create a default empty document if none provided
      this.currentDoc = createDoc([]);
      this.rootElement.innerHTML = renderDocumentToHtml(this.currentDoc);
    }
  }

  public patch(newDoc: DocNode): void {
    if (!this.currentDoc || this.rootElement.innerHTML === '') { // First render or empty root
      const fullHtml = renderDocumentToHtml(newDoc);
      this.rootElement.innerHTML = fullHtml;
      this.currentDoc = newDoc;
      return;
    }

    const oldBlocks = this.currentDoc.content;
    const newBlocks = newDoc.content;
    const maxLen = Math.max(oldBlocks.length, newBlocks.length);

    for (let i = 0; i < maxLen; i++) {
      const oldBlock = oldBlocks[i] || null;
      const newBlock = newBlocks[i] || null;

      const domChildAtIndex = this.rootElement.children[i] as HTMLElement | undefined;

      if (newBlock && !oldBlock) {
        // Case 1a: New block added at the end
        const newBlockHtml = renderNodeToHtml(newBlock as BaseNode); // Cast needed as renderNodeToHtml expects BaseNode
        const newBlockDom = htmlToElement(newBlockHtml);
        if (newBlockDom) {
          this.rootElement.appendChild(newBlockDom);
        }
      } else if (newBlock && oldBlock && !areNodesEffectivelyEqual(oldBlock, newBlock)) {
        // Case 1b: Block changed, or type changed
        const changedBlockHtml = renderNodeToHtml(newBlock as BaseNode);
        const changedBlockDom = htmlToElement(changedBlockHtml);
        if (changedBlockDom && domChildAtIndex) {
          this.rootElement.replaceChild(changedBlockDom, domChildAtIndex);
        } else if (changedBlockDom) {
          // Should not happen if oldBlock existed, but as a fallback
          this.rootElement.appendChild(changedBlockDom);
        }
      } else if (!newBlock && oldBlock) {
        // Case 2: Block removed
        if (domChildAtIndex) {
          this.rootElement.removeChild(domChildAtIndex);
        }
      } else {
        // Case 3: Block is effectively the same (or both null if newDoc is empty and current was also empty beyond this loop)
        // Do nothing for this PoC for identical blocks
      }
    }

    this.currentDoc = newDoc;
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
if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test_node') {
    // This block is for conceptual Node.js testing with a fake DOM.
    // Requires a DOM environment like JSDOM.
    // Example:
    // const { JSDOM } = require('jsdom');
    // const dom = new JSDOM('<!DOCTYPE html><body><div id="editor-root"></div></body>');
    // global.document = dom.window.document;
    // global.HTMLElement = dom.window.HTMLElement;
    // global.Node = dom.window.Node; // if needed by htmlToElement or other DOM uses
    // global.HTMLTemplateElement = dom.window.HTMLTemplateElement;


    console.log("--- DOM Patcher Node.js Test Sketch (requires JSDOM setup) ---");
    const mockRoot = document.createElement('div');

    const initialTestDoc = createDoc([
        createParagraph([createText("Initial Paragraph for Node Test")])
    ]);
    const patcherInstance = new DomPatcher(mockRoot, initialTestDoc);
    console.log("Initial (Node):", mockRoot.innerHTML);

    const modifiedTestDoc = createDoc([
        createParagraph([createText("Modified Paragraph for Node Test")]),
        createParagraph([createText("Second Paragraph for Node Test")])
    ]);
    patcherInstance.patch(modifiedTestDoc);
    console.log("Modified (Node):", mockRoot.innerHTML);
}

*/
console.log("DomPatcher class defined. Example usage is sketched for browser environment or Node.js with JSDOM.");
