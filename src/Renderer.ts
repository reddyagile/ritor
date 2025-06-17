// src/Renderer.ts
import Ritor from './Ritor';
import { Document, Delta, Op, OpAttributes } from './Document';

// Simple mapping for known attributes to HTML tags
// This can be expanded.
const ATTRIBUTE_TO_TAG_MAP: Record<string, string> = {
  bold: 'STRONG',
  italic: 'EM',
  underline: 'U',
  // Example for future: link: 'A' (would need href attribute)
};

// Tags that don't require a value in attributes, their presence means true.
const BOOLEAN_ATTRIBUTES: string[] = ['bold', 'italic', 'underline'];

export class Renderer {
  private ritor: Ritor;
  private $el: HTMLElement;

  constructor(ritor: Ritor) {
    this.ritor = ritor;
    this.$el = ritor.$el;
  }

  // Main method to render the document model to the DOM
  public render(doc: Document): void {
    // Clear existing content
    // A more sophisticated renderer might diff the DOM, but for now, clear and rebuild.
    this.$el.innerHTML = '';

    const delta = doc.getDelta();
    if (!delta || !delta.ops) {
      return;
    }

    delta.ops.forEach(op => {
      this.renderOp(op);
    });

    // Ensure there's always at least a bogus <br> if the editor is empty,
    // which is common practice for contentEditable.
    if (this.$el.innerHTML === '') {
      this.$el.appendChild(document.createElement('br'));
    }
  }

  // Renders a single operation
  private renderOp(op: Op): void {
    if (op.insert) {
      let textContent = op.insert;
      // Browsers often collapse multiple spaces or leading/trailing spaces in text nodes
      // depending on CSS `white-space`. For simplicity, we'll replace multiple spaces
      // with non-breaking spaces for now, which is a common rich editor behavior.
      // A more robust solution involves careful CSS and possibly span wrappers.
      // textContent = textContent.replace(/  /g, ' &nbsp;'); // Example, might be too aggressive

      // If it's just a newline and it's the only thing, it often becomes a <br>
      // or is part of a block element like <p>.
      // For now, we'll insert text directly. If it's `\n`, it might need to become a <br>
      // if it's not the last op or if the model dictates block separation.
      // This part will need refinement as block support is considered.
      if (textContent === '\n' && op.attributes == null) {
         // If it's a newline character from our initial document model,
         // and no other attributes, often this implies a paragraph break.
         // For a simple inline editor, this might be a <br>.
         // If this is the only op, render will add a <br> anyway.
         // If there are other ops, a <br> might be appropriate.
         // For now, let's make it a <br> if it's by itself.
         // This logic needs to be carefully coordinated with how Document model handles blocks.
         if (this.$el.childNodes.length > 0 && this.$el.lastChild instanceof HTMLElement) {
            this.$el.appendChild(document.createElement('br'));
         } else if (this.$el.childNodes.length === 0) {
            // If it's the very first thing, let the end-of-render br handle it.
            // Otherwise, append a br.
         }
         // Avoid rendering the literal '\n' if we handle it as a <br>
         // However, if it has attributes, it's likely formatted text that happens to be a newline.
         // This area is tricky and depends on desired newline/paragraph behavior.
         // For now, let's assume newlines in text are rendered as such,
         // and paragraph breaks are higher-level constructs not yet in our Delta.
      }

      const nodesToAppend: Node[] = this.createTextNodesAndApplyAttributes(textContent, op.attributes);
      nodesToAppend.forEach(node => this.$el.appendChild(node));

    }
    // `delete` and `retain` ops are not directly rendered in this context,
    // as they are part of the transformation to the current document state.
    // The `doc.getDelta()` should represent the content to be displayed.
  }

  private createTextNodesAndApplyAttributes(text: string, attributes?: OpAttributes): Node[] {
    let topNode: Node = document.createTextNode(text);

    if (attributes) {
      let currentParent: HTMLElement = document.createElement('span'); // Temporary wrapper
      const rootParent = currentParent;

      // Apply known attributes by wrapping in corresponding tags
      for (const attrKey in attributes) {
        if (attributes.hasOwnProperty(attrKey) && attributes[attrKey]) {
          const tagName = ATTRIBUTE_TO_TAG_MAP[attrKey];
          if (tagName) {
            if (BOOLEAN_ATTRIBUTES.includes(attrKey) && attributes[attrKey] === true) {
              const newElement = document.createElement(tagName);
              newElement.appendChild(topNode);
              topNode = newElement;
            } else if (tagName === 'A' && typeof attributes[attrKey] === 'string') {
              // Example for links:
              // const linkElement = document.createElement('A');
              // linkElement.setAttribute('href', attributes[attrKey] as string);
              // linkElement.appendChild(topNode);
              // topNode = linkElement;
            }
            // Add other attribute->tag handling here (e.g. for links with href)
          }
        }
      }
      // If topNode is still the temporary span, it means no known block/inline tags were applied
      // directly based on attributes, so just return the text node.
      // However, our loop structure implies topNode is progressively wrapped.
    }

    // Special handling for newlines within text that isn't wrapped.
    // If text contains newlines, and isn't part of a larger structure yet,
    // split by newline and insert <br> tags.
    // This is a common contentEditable behavior.
    if (text.includes('\n') && topNode.nodeType === Node.TEXT_NODE) {
        const parts = text.split('\n');
        const fragment = document.createDocumentFragment();
        parts.forEach((part, index) => {
            if (part) { // Don't append empty text nodes
                fragment.appendChild(document.createTextNode(part));
            }
            if (index < parts.length - 1) {
                fragment.appendChild(document.createElement('br'));
            }
        });
        return [fragment]; // Return as a single fragment to be appended
    }

    return [topNode];
  }

  public static deltaToHtml(delta: Delta): string {
    if (!delta || !delta.ops) {
      return '';
    }

    let html = '';
    delta.ops.forEach(op => {
      if (op.insert) {
        let text = op.insert;
        // Basic text escaping (very minimal, consider a library for robust escaping)
        text = text.replace(/&/g, '&amp;')
                   .replace(/</g, '&lt;')
                   .replace(/>/g, '&gt;')
                   .replace(/"/g, '&quot;')
                   .replace(/'/g, '&#39;');

        // Replace newlines with <br> for simple HTML representation
        // More complex block handling would require different logic
        text = text.replace(/\n/g, '<br>');


        if (op.attributes) {
          let currentText = text;
          // Apply attributes by wrapping in tags (simplified, order might matter for nesting)
          for (const attrKey in op.attributes) {
            if (op.attributes.hasOwnProperty(attrKey) && op.attributes[attrKey]) {
              const tagName = ATTRIBUTE_TO_TAG_MAP[attrKey];
              if (tagName) {
                if (op.attributes[attrKey] === true) { // Boolean attributes
                  currentText = `<${tagName}>${currentText}</${tagName}>`;
                }
                // Add handling for attributes with values like links if needed
                // else if (tagName === 'A' && typeof op.attributes[attrKey] === 'string') {
                //   currentText = `<${tagName} href="${op.attributes[attrKey]}">${currentText}</${tagName}>`;
                // }
              }
            }
          }
          html += currentText;
        } else {
          html += text;
        }
      }
      // Delete and retain ops are not directly converted to HTML string in this context,
      // as the input delta should represent the final content.
    });
    return html;
  }
}
