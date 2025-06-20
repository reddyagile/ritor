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
  private ritor: Ritor; // Ritor context, primarily for $el
  private $el: HTMLElement; // The root element this renderer instance operates on
  private currentBlockElement: HTMLElement | null = null;

  constructor(ritor: Ritor) {
    this.ritor = ritor;
    this.$el = ritor.$el; // This renderer instance is tied to this specific $el
  }

  private ensureCurrentBlock(defaultTag: string = 'P'): HTMLElement {
    if (!this.currentBlockElement || this.currentBlockElement.parentNode !== this.$el) {
      this.currentBlockElement = document.createElement(defaultTag);
      this.$el.appendChild(this.currentBlockElement);
    }
    return this.currentBlockElement;
  }

  private closeCurrentBlock(): void {
    // If a block is being closed and it's empty, ensure it has a <br> for visibility/selection.
    // This is especially important if it's not the very last action of a full render.
    if (this.currentBlockElement && this.currentBlockElement.childNodes.length === 0) {
      this.currentBlockElement.appendChild(document.createElement('br'));
    }
    this.currentBlockElement = null;
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

  private renderOp(op: Op): void {
    if (op.insert !== undefined) {
      let text = op.insert;
      if (text.includes('\n')) {
        const segments = text.split('\n');
        segments.forEach((segment, index) => {
          // Ensure a block for any segment, even if empty, if it's before a newline
          // or if it's the first segment of an op that starts with text.
          const block = this.ensureCurrentBlock();
          if (segment) { // Only append if segment has text
            const inlineNodes = this.createTextNodesAndApplyAttributes(segment, op.attributes);
            inlineNodes.forEach(node => block.appendChild(node));
          }
          // If there's a newline character following this segment
          if (index < segments.length - 1) {
            this.closeCurrentBlock();
          }
        });
      } else { // No newlines in this insert op
        const block = this.ensureCurrentBlock(); // Ensure a block exists
        if (text === "" && op.attributes && Object.keys(op.attributes).length > 0) {
          const inlineNodes = this.createTextNodesAndApplyAttributes("", op.attributes);
          inlineNodes.forEach(node => block.appendChild(node));
        } else if (text) {
          const inlineNodes = this.createTextNodesAndApplyAttributes(text, op.attributes);
          inlineNodes.forEach(node => block.appendChild(node));
        }
        // If text is "" and no attributes, ensureCurrentBlock already made sure a block exists.
        // It might remain empty until the next op or finalization.
      }
    }
  }

  // This is the core rendering logic loop, now an instance method.
  private _doRender(delta: Delta): void {
    // this.$el is the root for this rendering pass (e.g., editor's $el or a temp div)
    // this.currentBlockElement is the state for this rendering pass

    if (!delta || !delta.ops || delta.ops.length === 0) {
      this.ensureCurrentBlock(); // Ensure at least one block
      this.closeCurrentBlock();  // Finalize it (adds <br> if empty)
      return;
    }

    delta.ops.forEach(op => {
      this.renderOp(op);
    });

    // Finalization logic for the very end of the document
    if (this.currentBlockElement === null && this.$el.childNodes.length > 0) {
      // This means the document ended with a newline character (
).
      // A new block was conceptually started by closeCurrentBlock(). We need to ensure it exists in DOM.
      this.ensureCurrentBlock(); // This will create the new empty <p>
    }

    // After all ops, if the current (last) block is empty, or if the editor is completely empty, add a <br>.
    if (this.currentBlockElement && this.currentBlockElement.childNodes.length === 0) {
      this.currentBlockElement.appendChild(document.createElement('br'));
    } else if (this.$el.childNodes.length === 0) {
      // This case should ideally be covered by the empty delta check or if currentBlockElement was handled.
      // But as a final safety, ensure at least one block with a br.
      this.ensureCurrentBlock().appendChild(document.createElement('br'));
    }
  }

  // Public render method for the main editor element
  public render(doc: Document): void {
    this.$el.innerHTML = '';        // Clear main editor element
    this.currentBlockElement = null; // Reset instance state for this render pass
    this._doRender(doc.getDelta());
  }

  // Static method to get HTML string from a delta
  public static deltaToHtml(delta: Delta): string {
    const tempDiv = document.createElement('div');
    // Create a temporary Ritor-like context. Only $el is strictly needed by Renderer's current _doRender path.
    // The Ritor instance itself isn't used by _doRender, only its $el.
    const dummyRitorContext = { $el: tempDiv } as Ritor;
    const tempRenderer = new Renderer(dummyRitorContext);

    // Call the instance rendering logic on the temporary renderer, targeting tempDiv
    tempRenderer._doRender(delta); // This will use tempRenderer.$el (which is tempDiv)
                                  // and tempRenderer.currentBlockElement

    return tempDiv.innerHTML;
  }
}
