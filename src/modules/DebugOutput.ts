// src/modules/DebugOutput.ts
import Ritor from '../Ritor';
import { ModuleOptions, DocSelection } from '../types';
import { Document, Delta, OpAttributes } from '../Document';

// Helper to serialize DOM nodes for display
function serializeNode(node: Node | null): string {
  if (!node) return 'null';
  if (node.nodeType === Node.TEXT_NODE) {
    return `#text: "${node.textContent?.substring(0, 50)}${node.textContent && node.textContent.length > 50 ? '...' : ''}"`;
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    return `<${el.tagName.toLowerCase()}${el.id ? ` id="${el.id}"` : ''}${el.className ? ` class="${el.className}"` : ''}>`;
  }
  return `Node type ${node.nodeType}`;
}

interface DebugData {
  timestamp: string;
  eventSource: string;
  delta?: Delta;
  docSelection?: DocSelection | null;
  domRange?: {
    collapsed: boolean;
    startContainer: string;
    startOffset: number;
    endContainer: string;
    endOffset: number;
  } | null;
  domRangeToDocOutput?: DocSelection | null;
  attributesAtSelection?: OpAttributes | null; // From getFormatAt
  typingAttributes?: OpAttributes | null;    // ADDED: From getTypingAttributes
}

class DebugOutput {
  private ritor: Ritor;
  private options: ModuleOptions;
  private $outputEl: HTMLElement | null = null;
  private lastRenderedData: string = "";

  constructor(ritor: Ritor, options: ModuleOptions) {
    this.ritor = ritor;
    this.options = options;

    if (options.targetOutputSelector && typeof options.targetOutputSelector === 'string') {
      this.$outputEl = document.querySelector(options.targetOutputSelector);
    } else {
      console.warn('DebugOutput module: targetOutputSelector not provided or invalid in options.');
    }

    if (this.$outputEl) {
      this._attachListeners();
      this._collectAndRenderData('init');
    }
  }

  private _attachListeners(): void {
    this.ritor.on('document:change', (doc: Document, newSelection?: DocSelection) => {
      this._collectAndRenderData('document:change', newSelection);
    });

    this.ritor.on('cursor:change', () => {
      this._collectAndRenderData('cursor:change');
    });

    // ADDED: Listen to typingattributes:change to get the most up-to-date typing attributes
    this.ritor.on('typingattributes:change', () => {
        this._collectAndRenderData('typingattributes:change');
    });
  }

  private _collectAndRenderData(eventSource: string, modelSelectionFromEvent?: DocSelection | null): void {
    // Get DocumentManager instance via public accessor on Ritor
    const docManager = this.ritor.getDocumentManager();

    // Guard clause if essential parts are missing
    if (!this.$outputEl || !docManager || !this.ritor.cursor) {
      // Optionally log an error or set a default error state for the debug output
      if (this.$outputEl) {
          this.$outputEl.textContent = 'Error: Ritor components (docManager or cursor) not available for debug output.';
      }
      return;
    }

    const currentDelta = docManager.getDocument(); // docManager.getDocument() now returns a Delta directly
    const currentDomRange = this.ritor.cursor.getDomRange();

    let currentDocSelection: DocSelection | null = null;
    let attributesAtSelection: OpAttributes | null = null;
    let domRangeToDocOutput: DocSelection | null = null;

    if (modelSelectionFromEvent !== undefined && (eventSource === 'document:change' || eventSource === 'init' || eventSource === 'typingattributes:change')) {
        currentDocSelection = modelSelectionFromEvent;
    } else if (currentDomRange) {
        currentDocSelection = this.ritor.cursor.domRangeToDocSelection(currentDomRange);
    } else {
        currentDocSelection = this.ritor.cursor.getDocSelection();
    }

    if (currentDocSelection) {
        attributesAtSelection = this.ritor.getFormatAt(currentDocSelection);
    }

    if (currentDomRange) {
        domRangeToDocOutput = this.ritor.cursor.domRangeToDocSelection(currentDomRange);
    }

    // Get current typing attributes
    const currentTypingAttributes = this.ritor.getTypingAttributes(); // ADDED

    const debugData: DebugData = {
      timestamp: new Date().toISOString(),
      eventSource: eventSource,
      delta: currentDelta,
      docSelection: currentDocSelection,
      domRange: currentDomRange ? {
        collapsed: currentDomRange.collapsed,
        startContainer: serializeNode(currentDomRange.startContainer),
        startOffset: currentDomRange.startOffset,
        endContainer: serializeNode(currentDomRange.endContainer),
        endOffset: currentDomRange.endOffset,
      } : null,
      domRangeToDocOutput: domRangeToDocOutput,
      attributesAtSelection: attributesAtSelection,
      typingAttributes: currentTypingAttributes, // ADDED
    };

    this._renderDebugInfo(debugData);
  }

  private _renderDebugInfo(data: DebugData): void {
    if (!this.$outputEl) return;

    // Build the outputText string. Actual newline characters ('
') are used for formatting.
    let outputText = `Timestamp: ${data.timestamp}
`; // Literal newline
    outputText += `Event Source: ${data.eventSource}

`; // Literal newline

    outputText += `Document Delta:
${JSON.stringify(data.delta, null, 2)}

`; // Literal newline

    outputText += `Model DocSelection:
${JSON.stringify(data.docSelection, null, 2)}

`; // Literal newline

    outputText += `Current Typing Attributes:
${JSON.stringify(data.typingAttributes, null, 2)}

`; // Literal newline

    outputText += `DOM Range:
${data.domRange ? JSON.stringify(data.domRange, null, 2) : 'null'}

`; // Literal newline

    outputText += `Output of domRangeToDocSelection(currentDomRange):
${JSON.stringify(data.domRangeToDocOutput, null, 2)}

`; // Literal newline

    outputText += `Attributes at Selection (getFormatAt):
${JSON.stringify(data.attributesAtSelection, null, 2)}

`; // Literal newline

    if (this.lastRenderedData !== outputText) {
        if (this.$outputEl.nodeName === 'PRE' || this.$outputEl.nodeName === 'TEXTAREA') {
            // For PRE/TEXTAREA, textContent handles newlines correctly.
            this.$outputEl.textContent = outputText;
        } else {
            // For other elements, wrap in <pre>.
            // First, escape HTML special characters from the entire outputText.
            const htmlEscapedOutputText = outputText
                .replace(/&/g, '&amp;') // Must be first
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
            // Then, replace actual newline characters (\n) in this escaped string with <br> tags for HTML rendering.
            this.$outputEl.innerHTML = `<pre>${htmlEscapedOutputText.replace(/\n/g, '<br>')}</pre>`;
        }
        this.lastRenderedData = outputText;
    }
  }
}

export default DebugOutput;
