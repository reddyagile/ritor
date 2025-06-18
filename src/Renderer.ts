// src/Renderer.ts
import Ritor from './Ritor'; // Keep Ritor import if needed for $el or other context
import { Document, Delta, Op, OpAttributes } from './Document';

const ATTRIBUTE_TO_TAG_MAP: Record<string, string> = {
  bold: 'STRONG',
  italic: 'EM',
  underline: 'U',
};
const BOOLEAN_ATTRIBUTES: string[] = ['bold', 'italic', 'underline'];

export class Renderer {
  private ritor: Ritor; // Keep if needed, e.g. for this.ritor.$el
  private $el: HTMLElement;
  private currentBlockElement: HTMLElement | null = null; // To manage the current <p> tag

  constructor(ritor: Ritor) {
    this.ritor = ritor;
    this.$el = ritor.$el;
  }

  private ensureCurrentBlock(defaultTag: string = 'P'): HTMLElement {
    if (!this.currentBlockElement || this.currentBlockElement.parentNode !== this.$el) {
      // If currentBlockElement is null, or detached (e.g. from previous render or bad op)
      // or if its tag doesn't match what we expect for a new block (though defaultTag isn't used this way here yet)
      this.currentBlockElement = document.createElement(defaultTag);
      this.$el.appendChild(this.currentBlockElement);
    }
    return this.currentBlockElement;
  }

  private closeCurrentBlock() {
      // Future: If currentBlockElement is empty and it's not the only block,
      // browsers often need a <br> inside it to make it visible and selectable.
      // We'll handle this more explicitly after all ops are processed.
      if (this.currentBlockElement && this.currentBlockElement.childNodes.length === 0) {
          // For now, let renderer ensure <br> if editor is totally empty at the end.
          // Or, if this specific empty block needs a BR.
          // This logic might be better at the end of render()
      }
      this.currentBlockElement = null; // Signal that the block is "closed"
  }


  public render(doc: Document): void {
    this.$el.innerHTML = ''; // Clear existing content
    this.currentBlockElement = null; // Reset current block state

    const delta = doc.getDelta();
    if (!delta || !delta.ops || delta.ops.length === 0) { // Check ops length too
      // If delta is empty or has no ops, ensure there's at least one empty paragraph
      // This handles a completely empty document.
      this.ensureCurrentBlock().appendChild(document.createElement('br')); // Add BR to make it selectable
      return; // Nothing more to render
    }

    delta.ops.forEach(op => {
      this.renderOp(op);
    });

    // After all ops, if the editor is still effectively empty (e.g. only empty <p> tags),
    // or if the last block is empty, ensure it's selectable.
    if (this.$el.childNodes.length === 0) {
        // This case should be covered by the initial check in render if delta.ops is empty.
        // If ops ran but produced no visible children in $el (e.g. only empty <p>s that got removed),
        // create a default block.
        this.ensureCurrentBlock().appendChild(document.createElement('br'));
    } else if (this.currentBlockElement && this.currentBlockElement.childNodes.length === 0) {
        // If the very last block is empty, add a <br> to make it visible/selectable.
        // This is a common WYSIWYG behavior.
        this.currentBlockElement.appendChild(document.createElement('br'));
    } else if (!this.currentBlockElement && this.$el.lastChild && this.$el.lastChild.nodeName === 'P' && (this.$el.lastChild as HTMLElement).childNodes.length === 0){
        // If currentBlock is null (meaning last op was
), and the last actual child is an empty P
        (this.$el.lastChild as HTMLElement).appendChild(document.createElement('br'));
    } else if (this.currentBlockElement === null && this.$el.childNodes.length > 0) {
        // If currentBlockElement is null (e.g. last op was a newline), it means a new paragraph was implicitly started
        // but might not have been added to DOM if there were no more ops.
        // This case should ideally be handled by ensuring the last op (if it's a newline)
        // results in an empty paragraph being created and selected.
        // The logic in renderOp where it splits should handle creating the last paragraph.
        // This else if might be redundant if ensureCurrentBlock is always called when needed.
    }
  }

  private renderOp(op: Op): void {
    if (op.insert !== undefined) { // Check for insert key, even if string is empty
      let text = op.insert;

      if (text.includes('\n')) {
        const segments = text.split('\n');
        segments.forEach((segment, index) => {
          if (segment) { // If there's text in the segment
            const block = this.ensureCurrentBlock();
            const inlineNodes = this.createTextNodesAndApplyAttributes(segment, op.attributes);
            inlineNodes.forEach(node => block.appendChild(node));
          } else if (index === 0 && segments.length > 1) {
            // If the first segment is empty AND there are newlines (e.g. "
text")
            // This means the current block (if any) should be closed by this first newline.
            // If there's content in currentBlockElement already, this newline closes it.
            // If currentBlockElement is fresh, this newline effectively confirms it's an empty line.
            this.ensureCurrentBlock(); // Ensure a block exists, even if it remains empty before closing
          }

          if (index < segments.length - 1) { // This is a newline character's position
            this.closeCurrentBlock(); // Close current <p>
            // The next ensureCurrentBlock (either by next segment or next op) will create a new <p>
          }
        });
        // If the very last char was a newline, segments ends with an empty string,
        // and closeCurrentBlock was called. The next op or end of render() needs to handle this.
        // If segments was ["", ""], meaning op.insert was "
",
        // first segment is "", ensureCurrentBlock, then closeCurrentBlock.
        // The next op or end of render should create the new empty paragraph.
        if (text === "\n" && segments.length === 2 && segments[0] === "" && segments[1] === "") {
             // This was an op like { insert: "
" }.
             // Ensure a block was created for the first part (empty)
             // and then closed. The next op will start a new one.
             // If this is the last op, render() finalization handles empty last block.
        }

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
        // This is an op like { insert: "" } - typically a no-op.
        // However, ensure a block is present if it's the start of content.
        this.ensureCurrentBlock();
      }
    }
  }

  private createTextNodesAndApplyAttributes(text: string, attributes?: OpAttributes): Node[] {
    if (text === "" && attributes && Object.keys(attributes).length > 0) {
        let styledNode: HTMLElement | Text = document.createTextNode("");
         for (const attrKey in attributes) {
            if (attributes.hasOwnProperty(attrKey) && attributes[attrKey]) {
              const tagName = ATTRIBUTE_TO_TAG_MAP[attrKey];
              if (tagName && BOOLEAN_ATTRIBUTES.includes(attrKey) && attributes[attrKey] === true) {
                const newElement = document.createElement(tagName);
                newElement.appendChild(styledNode);
                styledNode = newElement;
              }
            }
          }
        return [styledNode];
    }
    // If text is "" and no attributes, let renderOp decide if a block is needed.
    // Here, we just return an empty text node if text is empty.
    if (text === "") return [document.createTextNode("")];


    let topNode: Node = document.createTextNode(text);
    if (attributes) {
      for (const attrKey in attributes) {
        if (attributes.hasOwnProperty(attrKey) && attributes[attrKey]) {
          const tagName = ATTRIBUTE_TO_TAG_MAP[attrKey];
          if (tagName) {
            if (BOOLEAN_ATTRIBUTES.includes(attrKey) && attributes[attrKey] === true) {
              const newElement = document.createElement(tagName);
              newElement.appendChild(topNode);
              topNode = newElement;
            }
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
      // Only add P tag if there's content or if it's the very first block needed
      if (currentParagraphContent || html === '') {
        html += `<p>${currentParagraphContent || '<br>'}</p>`;
      }
      currentParagraphContent = '';
    };

    if (!delta || !delta.ops || delta.ops.length === 0) {
        return '<p><br></p>'; // Default for empty delta
    }

    delta.ops.forEach((op, opIndex) => {
      if (op.insert !== undefined) {
        let text = op.insert;
        text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        const segments = text.split('\n');
        segments.forEach((segment, i) => {
          if (segment) {
            let segmentHtml = segment;
            if (op.attributes) {
              for (const attrKey in op.attributes) {
                // Ensure attribute is true for boolean formats
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
          if (i < segments.length - 1) { // Newline encountered
            finalizeParagraph();
          }
        });
      }
    });

    // Finalize any remaining paragraph content or if the last op was a newline.
    // If currentParagraphContent is not empty, it means the last op didn't end with
.
    // If it IS empty, but the last op *was* a
 (or document was empty), we need a paragraph.
    if (currentParagraphContent || (delta.ops.length > 0 && delta.ops[delta.ops.length-1].insert?.includes('\n')) || delta.ops.length === 0) {
        finalizeParagraph();
    }

    return html || "<p><br></p>"; // Fallback if HTML is still empty (e.g. delta with only empty ops)
  }
}
