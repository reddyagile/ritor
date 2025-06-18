// src/Renderer.ts
import Ritor from './Ritor';
import { Document, Delta, Op, OpAttributes } from './Document';

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

    // New finalization logic
    if (this.currentBlockElement === null) {
      // This means the last op processed was a newline, or the document was empty.
      // A new block was pending. Ensure it's created and becomes current.
      this.ensureCurrentBlock();
    }

    // Now, this.currentBlockElement refers to the conceptually last block element
    // that should be in the document (either pre-existing or just created).
    // If this block is empty, add a <br> to make it selectable/visible.
    if (this.currentBlockElement && this.currentBlockElement.childNodes.length === 0) {
      this.currentBlockElement.appendChild(document.createElement('br'));
    } else if (this.$el.childNodes.length === 0) {
      // Fallback: If after all ops and the above check, the editor is still completely empty
      // (e.g., if ensureCurrentBlock somehow didn't run or currentBlockElement was detached),
      // ensure there's at least one paragraph with a <br>.
      // This call to ensureCurrentBlock will create a new one if currentBlockElement was valid but then removed,
      // or if it was null and the one created by the first `if` was somehow removed.
      // This is a safety net.
      const finalFallbackBlock = this.ensureCurrentBlock(); // ensureCurrentBlock handles appending if needed
      if(finalFallbackBlock.childNodes.length === 0){
          finalFallbackBlock.appendChild(document.createElement('br'));
      }
    }
  }

  private renderOp(op: Op): void {
    if (op.insert !== undefined) {
      let text = op.insert;

      if (text.includes('
')) { // Use single quotes with

        const segments = text.split('
'); // Use single quotes with

        segments.forEach((segment, index) => {
          if (segment) {
            const block = this.ensureCurrentBlock();
            const inlineNodes = this.createTextNodesAndApplyAttributes(segment, op.attributes);
            inlineNodes.forEach(node => block.appendChild(node));
          } else if (index === 0 && segments.length > 1) {
            this.ensureCurrentBlock();
          }

          if (index < segments.length - 1) {
            this.closeCurrentBlock();
          }
        });
      } else if (text === "" && op.attributes && Object.keys(op.attributes).length > 0) {
        const block = this.ensureCurrentBlock();
        const inlineNodes = this.createTextNodesAndApplyAttributes("", op.attributes);
        inlineNodes.forEach(node => block.appendChild(node));
      } else if (text) {
        const block = this.ensureCurrentBlock();
        const inlineNodes = this.createTextNodesAndApplyAttributes(text, op.attributes);
        inlineNodes.forEach(node => block.appendChild(node));
      } else if (text === "" && !op.attributes) {
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

    let firstBlockEnsured = false;

    delta.ops.forEach((op) => {
      if (op.insert !== undefined) {
        let text = op.insert;
        text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                   .replace(/"/g, '&quot;')
                   .replace(/'/g, '&#39;');

        const segments = text.split('
'); // Use single quotes with

        segments.forEach((segment, i) => {
          if (!firstBlockEnsured && html === '') {
              firstBlockEnsured = true;
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
          if (i < segments.length - 1) {
            finalizeParagraph();
            firstBlockEnsured = true;
          }
        });
      }
    });

    if (currentParagraphContent ||
        (delta.ops.length > 0 && delta.ops[delta.ops.length-1].insert?.endsWith('
')) || // Use single quotes with

        html === '') {
        finalizeParagraph();
    }
    return html || "<p><br></p>";
  }
}
