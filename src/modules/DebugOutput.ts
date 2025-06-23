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
    // Correcting the event listener signature to match Ritor's emission
    this.ritor.on('document:change', (eventData: { newDocument: Delta, newSelection?: DocSelection }) => {
      this._collectAndRenderData('document:change', eventData.newSelection);
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

  private _renderDebugInfo(data: DebugData): void { // data parameter is kept for signature consistency, but not used in this minimal version
    if (!this.$outputEl) return;

    // Replace the entire body with a minimal hardcoded assignment.
    // Using textContent as it's safer and the original code used it for PRE/TEXTAREA.
    // If the output element is not PRE/TEXTAREA, this will just show plain text.
    this.$outputEl.textContent = 'Debug output is currently hardcoded for testing.';

    // The lastRenderedData logic is removed for this minimal version to simplify further.
    // If this fixes the error, lastRenderedData logic can be added back with the placeholder.
  }
}

export default DebugOutput;
