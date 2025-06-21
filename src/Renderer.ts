// src/Renderer.ts
// import Ritor from './Ritor'; // This import might become unused if 'ritor' property is removed
import { Document, Delta, Op, OpAttributes } from './Document';

const ATTRIBUTE_TO_TAG_MAP: Record<string, string> = {
  bold: 'STRONG',
  italic: 'EM',
  underline: 'U',
};
const BOOLEAN_ATTRIBUTES: string[] = ['bold', 'italic', 'underline'];

export class Renderer {
  // private ritor: Ritor; // No longer used directly by most methods after constructor change
  private $el: HTMLElement;
  private currentBlockElement: HTMLElement | null = null;

  constructor(el: HTMLElement) {
    this.$el = el;
  }

  private ensureCurrentBlock(defaultTag: string = 'P'): HTMLElement {
    if (!this.currentBlockElement || this.currentBlockElement.parentNode !== this.$el) {
      this.currentBlockElement = document.createElement(defaultTag);
      this.$el.appendChild(this.currentBlockElement);
    }
    return this.currentBlockElement;
  }

  private closeCurrentBlock(): void {
    if (this.currentBlockElement && this.currentBlockElement.childNodes.length === 0) {
      this.currentBlockElement.appendChild(document.createElement('br'));
    }
    this.currentBlockElement = null;
  }

  private createTextNodesAndApplyAttributes(text: string, attributes?: OpAttributes): Node[] {
    const textWithNbsp = text.replace(/ /g, '\u00a0');

    if (textWithNbsp === "" && attributes && Object.keys(attributes).length > 0) {
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
    if (textWithNbsp === "") return [document.createTextNode("")];

    let topNode: Node = document.createTextNode(textWithNbsp);
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

  private renderOp(op: Op): void {
    if (op.insert !== undefined) {
      if (typeof op.insert === 'string') {
        let text = op.insert;
        const block = this.ensureCurrentBlock();

        if (text === "" && op.attributes && Object.keys(op.attributes).length > 0) {
          const inlineNodes = this.createTextNodesAndApplyAttributes("", op.attributes);
          inlineNodes.forEach(node => block.appendChild(node));
        } else if (text) {
          const segments = text.split('\n');
          segments.forEach((segment, index) => {
            if (segment) {
              const inlineNodes = this.createTextNodesAndApplyAttributes(segment, op.attributes);
              inlineNodes.forEach(node => block.appendChild(node));
            }
            if (index < segments.length - 1) {
              block.appendChild(document.createElement('br'));
            }
          });
        }
      } else if (typeof op.insert === 'object' && op.insert !== null && (op.insert as any).paragraphBreak === true) {
        this.closeCurrentBlock();
      }
    }
  }

  private _doRender(delta: Delta): void {
    if (!delta || !delta.ops || delta.ops.length === 0) {
      this.ensureCurrentBlock();
      this.closeCurrentBlock();
      return;
    }
    delta.ops.forEach(op => {
      this.renderOp(op);
    });
    if (this.currentBlockElement === null && this.$el.childNodes.length > 0) {
      this.ensureCurrentBlock();
    }
    if (this.currentBlockElement && this.currentBlockElement.childNodes.length === 0) {
      this.currentBlockElement.appendChild(document.createElement('br'));
    } else if (this.$el.childNodes.length === 0) {
      this.ensureCurrentBlock().appendChild(document.createElement('br'));
    }
  }

  public render(doc: Document): void {
    this.$el.innerHTML = '';
    this.currentBlockElement = null;
    this._doRender(doc.getDelta());
  }

  public static deltaToHtml(delta: Delta): string {
    let html = '';
    let currentParagraphContent = '';
    let firstBlockEnsured = false;

    const finalizeParagraph = () => {
      html += `<p>${currentParagraphContent || '<br>'}</p>`;
      currentParagraphContent = '';
      firstBlockEnsured = true;
    };

    if (!delta || !delta.ops || delta.ops.length === 0) {
        return '<p><br></p>';
    }

    delta.ops.forEach((op) => {
      if (op.insert !== undefined) {
        if (typeof op.insert === 'string') {
          let text = op.insert;
          text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                     .replace(/"/g, '&quot;')
                     .replace(/'/g, '&#39;');

          const segments = text.split('\n');
          segments.forEach((segment, i) => {
            if (!firstBlockEnsured && (segment || i < segments.length -1) ) {
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
              segmentHtml = segmentHtml.replace(/ /g, '&nbsp;');
              currentParagraphContent += segmentHtml;
            }
            if (i < segments.length - 1) {
              currentParagraphContent += '<br>';
            }
          });
        } else if (typeof op.insert === 'object' && op.insert !== null && (op.insert as any).paragraphBreak === true) {
          if (currentParagraphContent || !firstBlockEnsured || (html.length > 0 && !html.endsWith("</p>")) ) {
             finalizeParagraph();
          } else if (firstBlockEnsured) {
             finalizeParagraph();
          }
        }
      }
    });

    if (currentParagraphContent || !firstBlockEnsured ) {
      finalizeParagraph();
    }

    return html || "<p><br></p>";
  }
}
