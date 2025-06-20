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
    if (!this.$outputEl || !this.ritor.docManager || !this.ritor.cursor) return;

    const currentDelta = this.ritor.docManager.getDocument().getDelta();
    const currentDomRange = this.ritor.cursor.getDomRange();

    let currentDocSelection: DocSelection | null = null;
    let attributesAtSelection: OpAttributes | null = null; // From getFormatAt
    let domRangeToDocOutput: DocSelection | null = null;

    // Determine current DocSelection
    if (modelSelectionFromEvent !== undefined && (eventSource === 'document:change' || eventSource === 'init')) {
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

    let outputText = `Timestamp: ${data.timestamp}\n`; // Use \n for literal
 in output string
    outputText += `Event Source: ${data.eventSource}\n\n`;

    outputText += `Document Delta:\n${JSON.stringify(data.delta, null, 2)}\n\n`;
    outputText += `Model DocSelection:\n${JSON.stringify(data.docSelection, null, 2)}\n\n`;
    outputText += `Current Typing Attributes:\n${JSON.stringify(data.typingAttributes, null, 2)}\n\n`; // ADDED
    outputText += `DOM Range:\n${data.domRange ? JSON.stringify(data.domRange, null, 2) : 'null'}\n\n`;
    outputText += `Output of domRangeToDocSelection(currentDomRange):\n${JSON.stringify(data.domRangeToDocOutput, null, 2)}\n\n`;
    outputText += `Attributes at Selection (getFormatAt):\n${JSON.stringify(data.attributesAtSelection, null, 2)}\n\n`;

    if (this.lastRenderedData !== outputText) {
        // For <pre> or <textarea>, setting textContent with \n will render as newlines.
        // For other HTML elements, replace \n with <br> if direct HTML injection is used.
        if (this.$outputEl.nodeName === 'PRE' || this.$outputEl.nodeName === 'TEXTAREA') {
            this.$outputEl.textContent = outputText;
        } else {
            // Replace \n with <br> for general HTML elements, and escape HTML special chars from the data.
            const safeOutput = outputText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
            this.$outputEl.innerHTML = `<pre>${safeOutput}</pre>`; // Wrap in pre for consistent formatting
        }
        this.lastRenderedData = outputText;
    }
  }
}

export default DebugOutput;
