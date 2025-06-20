// src/Renderer.ts
// import Ritor from './Ritor'; // This import might become unused
import { Document, Delta, Op, OpAttributes } from './Document';

const ATTRIBUTE_TO_TAG_MAP: Record<string, string> = {
  bold: 'STRONG',
  italic: 'EM',
  underline: 'U',
};
const BOOLEAN_ATTRIBUTES: string[] = ['bold', 'italic', 'underline'];

export class Renderer {
  // private ritor: Ritor; // REMOVE this if not used elsewhere
  private $el: HTMLElement;
  private currentBlockElement: HTMLElement | null = null;

  constructor(el: HTMLElement) { // CHANGED parameter
    // this.ritor = ritor; // REMOVE
    this.$el = el;         // CHANGED to use the passed element
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

  private renderOp(op: Op): void { // This uses instance methods ensureCurrentBlock, closeCurrentBlock
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

  private _doRender(delta: Delta): void {
    // Assumes this.$el is already an empty container for this render pass,
    // and this.currentBlockElement has been reset to null by the caller.

    if (!delta || !delta.ops || delta.ops.length === 0) {
      this.ensureCurrentBlock();
      this.closeCurrentBlock();
      return;
    }

    delta.ops.forEach(op => {
      this.renderOp(op); // renderOp uses this.ensureCurrentBlock and this.closeCurrentBlock
    });

    // Finalization logic
    if (this.currentBlockElement === null && this.$el.childNodes.length > 0) {
      // This means the document ended with a newline character.
      // A new block was conceptually started by closeCurrentBlock(). We need to ensure it exists in DOM.
      this.ensureCurrentBlock();
    }

    if (this.currentBlockElement && this.currentBlockElement.childNodes.length === 0) {
      this.currentBlockElement.appendChild(document.createElement('br'));
    } else if (this.$el.childNodes.length === 0) {
      // This case covers if all ops resulted in no children (e.g. delta of only deletes on empty content)
      // or if the delta was empty and the initial check was bypassed.
      // As a final safety, ensure at least one block with a br.
      this.ensureCurrentBlock().appendChild(document.createElement('br'));
    }
  }

  public render(doc: Document): void {
    this.$el.innerHTML = '';        // Clear main editor element
    this.currentBlockElement = null; // Reset instance state for this render pass
    this._doRender(doc.getDelta());  // Call the core logic
  }

  public static deltaToHtml(delta: Delta): string {
    const tempDiv = document.createElement('div');
    const tempRenderer = new Renderer(tempDiv); // CHANGED: Pass tempDiv directly

    tempRenderer.currentBlockElement = null; // Ensure fresh state for this temporary renderer
    // Note: _doRender assumes its $el (tempDiv here) is already cleared by the caller's setup.
    // tempRenderer.$el.innerHTML = ''; // This is done by _doRender if it's the instance method, or by public render.
    // The public render() method clears this.$el.
    // Our _doRender does not. So, deltaToHtml needs to clear its tempDiv before calling _doRender on tempRenderer.
    // However, the _doRender method in the prompt for *this step* does not do the clearing.
    // The public render() does. So, to mirror that:
    tempDiv.innerHTML = ''; // Clear the tempDiv, as public render() would do for this.$el

    tempRenderer._doRender(delta);

    return tempDiv.innerHTML;
  }
}
