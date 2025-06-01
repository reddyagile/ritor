import {
  DocNode,
  ParagraphNode,
  TextNode,
  AnyMark,
  InlineNode,
  createDoc,
  createParagraph,
  createText,
  createBoldMark,
  // Potentially createItalicMark, createHardBreak etc. if used in examples
} from './documentModel.js'; // Assuming .js for ESM runtime
import { DomPatcher } from './domPatcher.js';   // Assuming .js for ESM runtime
// renderDocumentToHtml is not directly needed by RitorVDOM if DomPatcher handles initial render

export class RitorVDOM {
  public $el: HTMLElement;
  public currentViewDoc: DocNode;
  private domPatcher: DomPatcher;

  constructor(target: string | HTMLElement) {
    if (typeof target === 'string') {
      const element = document.querySelector(target) as HTMLElement;
      if (!element) {
        throw new Error(`Target element "${target}" not found.`);
      }
      this.$el = element;
    } else {
      this.$el = target;
    }

    // Initialize with a simple default document
    this.currentViewDoc = createDoc([
      createParagraph([createText('Hello VDOM world!')]),
    ]);

    this.domPatcher = new DomPatcher(this.$el, this.currentViewDoc);

    // Make contentEditable for basic input testing (actual input handling is more complex)
    this.$el.contentEditable = 'true';

    // Rudimentary keydown listener for testing addParagraph
    this.$el.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault(); // Prevent default Enter behavior
        // This is a very basic example; real implementation would involve cursor position etc.
        // this.addParagraph("New Para from Enter");
        console.log("'Enter' pressed. Call editor.addParagraph('New Para from Enter') from console to test.");
      }
    });
  }

  public updateDocument(newDoc: DocNode): void {
    this.currentViewDoc = newDoc;
    this.domPatcher.patch(this.currentViewDoc);
    console.log("Document updated. New viewDoc:", this.currentViewDoc);
    console.log("Current HTML:", this.$el.innerHTML);
  }

  // --- Example Modification Methods ---

  public addParagraph(text: string): void {
    const newParagraph = createParagraph([createText(text)]);
    const newContent = [...this.currentViewDoc.content, newParagraph];
    const newDoc = createDoc(newContent);
    this.updateDocument(newDoc);
  }

  public changeParagraphText(paraIndex: number, newText: string): void {
    if (paraIndex < 0 || paraIndex >= this.currentViewDoc.content.length) {
      console.warn(`Paragraph index ${paraIndex} out of bounds.`);
      return;
    }

    const newContent = this.currentViewDoc.content.map((block, index) => {
      if (index === paraIndex && block.type === 'paragraph') {
        // Create a new paragraph with the new text node
        return createParagraph([createText(newText)]);
      }
      return block; // Return original block if not the target or not a paragraph
    });

    const newDoc = createDoc(newContent as ReadonlyArray<ParagraphNode>); // Cast if sure only paras
    this.updateDocument(newDoc);
  }

  public toggleBoldOnFirstWordInParagraph(paraIndex: number): void {
    if (paraIndex < 0 || paraIndex >= this.currentViewDoc.content.length) {
      console.warn(`Paragraph index ${paraIndex} out of bounds.`);
      return;
    }

    const newContent = this.currentViewDoc.content.map((block, index) => {
      if (index === paraIndex && block.type === 'paragraph') {
        const paraNode = block as ParagraphNode;
        if (!paraNode.content || paraNode.content.length === 0) return paraNode;

        const firstInlineNode = paraNode.content[0];
        if (firstInlineNode.type !== 'text') return paraNode; // Can only bold text

        const textNode = firstInlineNode as TextNode;
        const words = textNode.text.split(/(\s+)/); // Split by space, keeping spaces
        if (words.length === 0) return paraNode;

        const firstWord = words[0];
        const restOfText = words.slice(1).join('');

        const currentMarks = textNode.marks || [];
        const isBold = currentMarks.some(mark => mark.type === 'bold');

        let newFirstWordMarks: AnyMark[];
        if (isBold) {
          newFirstWordMarks = currentMarks.filter(mark => mark.type !== 'bold');
        } else {
          newFirstWordMarks = [...currentMarks, createBoldMark()];
        }

        const newInlineContent: InlineNode[] = [
          createText(firstWord, newFirstWordMarks),
        ];

        if (restOfText) {
          // Preserve marks of the original text node for the rest of the text
          newInlineContent.push(createText(restOfText, currentMarks));
        }

        // Add remaining original inline nodes if any
        newInlineContent.push(...paraNode.content.slice(1));

        return createParagraph(newInlineContent);
      }
      return block;
    });
    const newDoc = createDoc(newContent as ReadonlyArray<ParagraphNode>);
    this.updateDocument(newDoc);
  }

  public getDocJson(): string {
      return JSON.stringify(this.currentViewDoc, null, 2);
  }
}

// --- Conceptual HTML and Script for testing ---
/*
index.html:
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Ritor VDOM Test</title>
    <style>
        #editor { border: 1px solid #ccc; min-height: 100px; padding: 10px; }
    </style>
</head>
<body>
    <h1>Ritor VDOM Test</h1>
    <div id="editor"></div>

    <h2>Controls</h2>
    <input type="text" id="paraText" value="New paragraph text">
    <button id="addParaBtn">Add Paragraph</button>
    <br><br>
    <input type="number" id="paraIndexChange" value="0" style="width: 50px;">
    <input type="text" id="paraNewText" value="Updated text">
    <button id="changeParaBtn">Change Paragraph Text</button>
    <br><br>
    <input type="number" id="paraIndexBold" value="0" style="width: 50px;">
    <button id="boldParaBtn">Toggle Bold First Word</button>
    <br><br>
    <button id="logDocBtn">Log Current Document JSON</button>

    <script type="module">
        import { RitorVDOM } from './src/RitorVDOM.js'; // Adjust path if necessary

        const editorElement = document.getElementById('editor');
        if (editorElement) {
            const editor = new RitorVDOM(editorElement);
            window.editor = editor; // Expose to console for easy testing

            document.getElementById('addParaBtn').onclick = () => {
                const text = document.getElementById('paraText').value || "Empty Para";
                editor.addParagraph(text);
            };
            document.getElementById('changeParaBtn').onclick = () => {
                const index = parseInt(document.getElementById('paraIndexChange').value);
                const text = document.getElementById('paraNewText').value || "Empty Text";
                editor.changeParagraphText(index, text);
            };
            document.getElementById('boldParaBtn').onclick = () => {
                const index = parseInt(document.getElementById('paraIndexBold').value);
                editor.toggleBoldOnFirstWordInParagraph(index);
            };
            document.getElementById('logDocBtn').onclick = () => {
                console.log("Current RitorVDOM Document Model:");
                console.log(editor.getDocJson());
            };

            console.log("RitorVDOM initialized. Try `editor.addParagraph('Hello from console!')`");
        } else {
            console.error("#editor element not found");
        }
    </script>
</body>
</html>

To run this:
1. Save the RitorVDOM.ts, domPatcher.ts, modelRenderer.ts, documentModel.ts in their respective paths.
2. Ensure they use '.js' for relative imports.
3. Create the index.html file as above.
4. Serve the directory using a simple HTTP server (e.g., `npx serve .`).
5. Open index.html in a browser and use the buttons or browser console.
*/

console.log("RitorVDOM class defined. Example usage is sketched for browser environment.");
