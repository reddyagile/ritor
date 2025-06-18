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
    this.currentBlockElement = null; // Signal that the block is "closed"
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
      this.ensureCurrentBlock().appendChild(document.createElement('br'));
    } else if (this.currentBlockElement && this.currentBlockElement.childNodes.length === 0) {
      this.currentBlockElement.appendChild(document.createElement('br'));
    } else if (!this.currentBlockElement && this.$el.lastChild &&
               this.$el.lastChild.nodeType === Node.ELEMENT_NODE &&
               (this.$el.lastChild as HTMLElement).nodeName === 'P' &&
               (this.$el.lastChild as HTMLElement).childNodes.length === 0) {
      // This comment refers to a newline character (e.g. from an insert: "
" op).
      // If currentBlock is null (meaning last op was a newline character),
      // and the last actual child is an empty P, add a BR.
      (this.$el.lastChild as HTMLElement).appendChild(document.createElement('br'));
    }
  }

  private renderOp(op: Op): void {
    if (op.insert !== undefined) {
      let text = op.insert; // This text can contain actual newline characters ('
')

      if (text.includes('
')) { // Check for actual newline characters
        const segments = text.split('
'); // Split by actual newline characters
        segments.forEach((segment, index) => {
          if (segment) {
            const block = this.ensureCurrentBlock();
            const inlineNodes = this.createTextNodesAndApplyAttributes(segment, op.attributes);
            inlineNodes.forEach(node => block.appendChild(node));
          } else if (index === 0 && segments.length > 1) {
            // Handles cases like an initial newline character ("
text")
            // or just a single newline ("
") which results in segments ["", ""].
            // Ensures a block exists, then it will be closed by the newline.
            this.ensureCurrentBlock();
          }

          if (index < segments.length - 1) { // A newline was processed
            this.closeCurrentBlock();
            // The next call to ensureCurrentBlock will create a new paragraph.
          }
        });
      } else if (text === "" && op.attributes && Object.keys(op.attributes).length > 0) {
        const block = this.ensureCurrentBlock();
        const inlineNodes = this.createTextNodesAndApplyAttributes("", op.attributes);
        inlineNodes.forEach(node => block.appendChild(node));
      } else if (text) { // Non-empty text, no newlines
        const block = this.ensureCurrentBlock();
        const inlineNodes = this.createTextNodesAndApplyAttributes(text, op.attributes);
        inlineNodes.forEach(node => block.appendChild(node));
      } else if (text === "" && !op.attributes) {
        // For an op like { insert: "" } without attributes.
        // Ensure a block is present if it's needed for structure.
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
        text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        const segments = text.split('
'); // Split by actual newline characters
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
          if (i < segments.length - 1) { // A true newline character was processed
            finalizeParagraph();
            firstBlockEnsured = true;
          }
        });
      }
    });

    if (currentParagraphContent ||
        (delta.ops.length > 0 && delta.ops[delta.ops.length-1].insert?.endsWith('
')) ||
        html === '') {
        finalizeParagraph();
    }

    return html || "<p><br></p>";
  }
}
