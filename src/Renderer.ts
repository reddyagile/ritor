// src/Renderer.ts
import Ritor from './Ritor';
import { Document, Delta, Op, OpAttributes } from './Document';

// These constants should be defined at the module level to be accessible by the static deltaToHtml method.
const ATTRIBUTE_TO_TAG_MAP: Record<string, string> = {
  bold: 'STRONG',
  italic: 'EM',
  underline: 'U',
};
const BOOLEAN_ATTRIBUTES: string[] = ['bold', 'italic', 'underline'];

export class Renderer {
  private ritor: Ritor;
  private $el: HTMLElement;
  private currentBlockElement: HTMLElement | null = null;

  constructor(ritor: Ritor) {
    this.ritor = ritor;
    this.$el = ritor.$el;
  }

  private ensureCurrentBlock(defaultTag: string = 'P'): HTMLElement {
    if (!this.currentBlockElement || this.currentBlockElement.parentNode !== this.$el) {
      this.currentBlockElement = document.createElement(defaultTag);
      this.$el.appendChild(this.currentBlockElement);
    }
    return this.currentBlockElement;
  }

  private closeCurrentBlock(): void {
    this.currentBlockElement = null;
  }

  public render(doc: Document): void {
    this.$el.innerHTML = '';
    this.currentBlockElement = null;

    const delta = doc.getDelta();
    if (!delta || !delta.ops || delta.ops.length === 0) {
      this.ensureCurrentBlock().appendChild(document.createElement('br'));
      return;
    }

    delta.ops.forEach(op => {
      this.renderOp(op);
    });

    if (this.$el.childNodes.length === 0) {
      // If ops ran but produced nothing (e.g. delta with only empty inserts without attributes)
      this.ensureCurrentBlock().appendChild(document.createElement('br'));
    } else if (this.currentBlockElement && this.currentBlockElement.childNodes.length === 0) {
      // If the last active block is empty
      this.currentBlockElement.appendChild(document.createElement('br'));
    } else if (!this.currentBlockElement && this.$el.lastChild &&
               this.$el.lastChild.nodeType === Node.ELEMENT_NODE && // Ensure lastChild is an Element
               (this.$el.lastChild as HTMLElement).nodeName === 'P' &&
               (this.$el.lastChild as HTMLElement).childNodes.length === 0) {
      // If last op was a newline (currentBlockElement is null), and the actual last <P> is empty
      (this.$el.lastChild as HTMLElement).appendChild(document.createElement('br'));
    }
  }

  private renderOp(op: Op): void {
    if (op.insert !== undefined) {
      let text = op.insert; // Should be actual newline characters '
' from Delta

      if (text.includes('
')) {
        const segments = text.split('
');
        segments.forEach((segment, index) => {
          if (segment) { // If there's text in the segment
            const block = this.ensureCurrentBlock();
            const inlineNodes = this.createTextNodesAndApplyAttributes(segment, op.attributes);
            inlineNodes.forEach(node => block.appendChild(node));
          } else if (index === 0 && segments.length > 1) {
            // Handles "
text" or "
" - ensures a block exists before it's closed by the newline
            this.ensureCurrentBlock();
          }

          if (index < segments.length - 1) { // A newline was processed
            this.closeCurrentBlock();
            // The next call to ensureCurrentBlock (from next segment or next op) will create a new <p>
            // If this newline is the last character of the op's text (e.g. "text
"),
            // and it's the last op, render() finalization will handle the new empty block.
          }
        });
      } else if (text === "" && op.attributes && Object.keys(op.attributes).length > 0) {
        // Empty insert with attributes (format placeholder)
        const block = this.ensureCurrentBlock();
        const inlineNodes = this.createTextNodesAndApplyAttributes("", op.attributes);
        inlineNodes.forEach(node => block.appendChild(node));
      } else if (text) { // Non-empty text, no newlines
        const block = this.ensureCurrentBlock();
        const inlineNodes = this.createTextNodesAndApplyAttributes(text, op.attributes);
        inlineNodes.forEach(node => block.appendChild(node));
      } else if (text === "" && !op.attributes) {
        // { insert: "" } without attributes. Ensure a block exists if it's the first op or part of content flow.
        this.ensureCurrentBlock();
      }
    }
  }

  private createTextNodesAndApplyAttributes(text: string, attributes?: OpAttributes): Node[] {
    if (text === "" && attributes && Object.keys(attributes).length > 0) {
        let styledNodeInner: Node = document.createTextNode("");
        let topStyledNode: HTMLElement | Node = styledNodeInner;
         for (const attrKey in attributes) {
            if (attributes.hasOwnProperty(attrKey) && attributes[attrKey] === true) {
              const tagName = ATTRIBUTE_TO_TAG_MAP[attrKey];
              if (tagName && BOOLEAN_ATTRIBUTES.includes(attrKey)) {
                const newElement = document.createElement(tagName);
                newElement.appendChild(topStyledNode);
                topStyledNode = newElement;
              }
            }
          }
        return [topStyledNode];
    }
    if (text === "") return [document.createTextNode("")];

    let topNode: Node = document.createTextNode(text);
    if (attributes) {
      for (const attrKey in attributes) {
        if (attributes.hasOwnProperty(attrKey) && attributes[attrKey] === true) {
          const tagName = ATTRIBUTE_TO_TAG_MAP[attrKey];
          if (tagName && BOOLEAN_ATTRIBUTES.includes(attrKey)) {
            const newElement = document.createElement(tagName);
            newElement.appendChild(topNode);
            topNode = newElement;
          }
        }
      }
    }
    return [topNode];
  }

  public static deltaToHtml(delta: Delta): string {
    let html = '';
    let currentParagraphContent = '';

    const finalizeParagraph = () => {
      html += `<p>${currentParagraphContent || '<br>'}</p>`;
      currentParagraphContent = '';
    };

    if (!delta || !delta.ops || delta.ops.length === 0) {
        return '<p><br></p>';
    }

    let firstBlockNeeded = true; // Flag to track if we are about to start the first paragraph

    delta.ops.forEach((op) => {
      if (op.insert !== undefined) {
        let text = op.insert;
        text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        const segments = text.split('
');
        segments.forEach((segment, i) => {
          if (firstBlockNeeded && html === '') {
              // This is the very beginning of processing, content will go into the first paragraph.
              // No need to call finalizeParagraph() before this first content.
              firstBlockNeeded = false;
          }

          if (segment) {
            let segmentHtml = segment;
            if (op.attributes) {
              for (const attrKey in op.attributes) {
                if (op.attributes.hasOwnProperty(attrKey) && op.attributes[attrKey] === true) {
                  const tagName = ATTRIBUTE_TO_TAG_MAP[attrKey];
                  if (tagName && BOOLEAN_ATTRIBUTES.includes(attrKey)) {
                    segmentHtml = `<${tagName}>${segmentHtml}</${tagName}>`;
                  }
                }
              }
            }
            currentParagraphContent += segmentHtml;
          }

          if (i < segments.length - 1) { // A true newline character was processed
            finalizeParagraph();
            firstBlockNeeded = false; // A paragraph has been closed, so the next one isn't the "first needed" in the same way.
          }
        });
      }
    });

    if (currentParagraphContent || (delta.ops.length > 0 && delta.ops[delta.ops.length-1].insert?.endsWith('
')) || html === '') {
        finalizeParagraph();
    }

    return html || "<p><br></p>"; // Final fallback
  }
}
