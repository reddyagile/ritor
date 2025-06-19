// src/modules/DebugOutput.ts
import Ritor from '../Ritor';
import { ModuleOptions, DocSelection } from '../types'; // Import DocSelection
import { Document, Delta, OpAttributes } from '../Document'; // Import Document, Delta, OpAttributes

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
  attributesAtSelection?: OpAttributes | null;
  eventSource: string;
}

class DebugOutput {
  private ritor: Ritor;
  private options: ModuleOptions;
  private $outputEl: HTMLElement | null = null;
  private lastRenderedData: string = ""; // To prevent excessive re-renders if data is same

  constructor(ritor: Ritor, options: ModuleOptions) {
    this.ritor = ritor;
    this.options = options;

    if (options.targetOutputSelector && typeof options.targetOutputSelector === 'string') {
      this.$outputEl = document.querySelector(options.targetOutputSelector);
    } else {
      console.warn('DebugOutput module: targetOutputSelector not provided or invalid in options.');
    }

    if (this.$outputEl) {
      this.$outputEl.textContent = 'Debug output initializing...';
      this._attachListeners();
      // Perform an initial data collection and render
      this._collectAndRenderData('init');
    }
  }

  private _attachListeners(): void {
    // Using arrow functions to maintain 'this' context
    this.ritor.on('document:change', (doc: Document, newSelection?: DocSelection) => {
      this._collectAndRenderData('document:change', newSelection);
    });

    this.ritor.on('cursor:change', () => {
      // cursor:change implies DOM selection changed, Ritor itself doesn't pass the selection
      // We derive it from the cursor module.
      this._collectAndRenderData('cursor:change');
    });

    // Could add listeners for other Ritor events if needed
  }

  private _collectAndRenderData(eventSource: string, modelSelectionFromEvent?: DocSelection | null): void {
    if (!this.$outputEl || !this.ritor.docManager || !this.ritor.cursor) return; // Guard against missing core components

    const currentDelta = this.ritor.docManager.getDocument().getDelta();
    const currentDomRange = this.ritor.cursor.getDomRange();

    let currentDocSelection: DocSelection | null = null;
    let attributesAtSelection: OpAttributes | null = null;
    let domRangeToDocOutput: DocSelection | null = null;

    if (modelSelectionFromEvent !== undefined) { // From document:change
        currentDocSelection = modelSelectionFromEvent;
    } else if (currentDomRange) { // From cursor:change or init
        currentDocSelection = this.ritor.cursor.domRangeToDocSelection(currentDomRange);
    } else { // Fallback if no DOM range (e.g. editor not focused)
        currentDocSelection = this.ritor.cursor.getDocSelection(); // Try to get it anyway
    }

    if (currentDocSelection) {
        attributesAtSelection = this.ritor.getFormatAt(currentDocSelection);
    }

    if (currentDomRange) {
        domRangeToDocOutput = this.ritor.cursor.domRangeToDocSelection(currentDomRange);
    }

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
    };

    this._renderDebugInfo(debugData);
  }

  private _renderDebugInfo(data: DebugData): void {
    if (!this.$outputEl) return;

    // Basic formatting for readability
    let outputText = `Timestamp: ${data.timestamp}
`;
    outputText += `Event Source: ${data.eventSource}

`;

    outputText += `Document Delta:
${JSON.stringify(data.delta, null, 2)}

`;

    outputText += `Model DocSelection:
${JSON.stringify(data.docSelection, null, 2)}

`;

    outputText += `DOM Range:
${data.domRange ? JSON.stringify(data.domRange, null, 2) : 'null'}

`;

    outputText += `Output of domRangeToDocSelection(currentDomRange):
${JSON.stringify(data.domRangeToDocOutput, null, 2)}

`;

    outputText += `Attributes at Selection:
${JSON.stringify(data.attributesAtSelection, null, 2)}

`;

    // Only re-render if data has changed to avoid flickering or performance issues on rapid events
    if (this.lastRenderedData !== outputText) {
        if (this.$outputEl.nodeName === 'PRE' || this.$outputEl.nodeName === 'TEXTAREA') { // Check for TEXTAREA too
            (this.$outputEl as HTMLPreElement | HTMLTextAreaElement).textContent = outputText;
        } else {
            // For other elements, replace children or set innerHTML with <pre> for formatting
            this.$outputEl.innerHTML = `<pre>${outputText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`;
        }
        this.lastRenderedData = outputText;
    }
  }
}

export default DebugOutput;
