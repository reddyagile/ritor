// src/modelUtils.ts
import { BaseNode, TextNode as ModelTextNode, AnyMark } from "./documentModel.js";
import { Schema } from "./schema.js";
import { NodeType } from "./schema.js";

// Helper for deep equality check of marks arrays
// Exported for use in DomPatcher
export function areMarksEqual(marksA: ReadonlyArray<AnyMark> | undefined, marksB: ReadonlyArray<AnyMark> | undefined): boolean {
  if (marksA === marksB) return true;
  if (!marksA || !marksB) return false;
  if (marksA.length !== marksB.length) return false;

  for (let i = 0; i < marksA.length; i++) {
    const markA = marksA[i];
    const markB = marksB[i];
    // For PoC, assume marks are sorted or order matters.
    // A more robust check would involve sorting or checking for set equality.
    if (markA.type !== markB.type || JSON.stringify(markA.attrs) !== JSON.stringify(markB.attrs)) {
      return false;
    }
  }
  return true;
}

export class ModelUtils {
  constructor(private schema: Schema) {}

  public normalizeInlineArray(nodes: ReadonlyArray<BaseNode>): BaseNode[] {
    if (!nodes || nodes.length === 0) {
      return [this.schema.text("")]; // Ensure paragraph isn't completely empty of nodes.
    }

    const result: BaseNode[] = [];
    let lastNode: BaseNode | null = null;

    for (const node of nodes) {
      if (lastNode && (lastNode.type as NodeType).isText && (node.type as NodeType).isText) {
        const textNodeA = lastNode as ModelTextNode;
        const textNodeB = node as ModelTextNode;
        if (areMarksEqual(textNodeA.marks, textNodeB.marks)) {
          // Merge B into A (which is already in result via lastNode)
          const mergedText = textNodeA.text + textNodeB.text;
          // Create a new text node with merged text and original marks
          // The previous lastNode in `result` needs to be replaced.
          if (result.length > 0) {
            result[result.length - 1] = this.schema.text(mergedText, textNodeA.marks);
            lastNode = result[result.length - 1]; // Update lastNode to the new merged node
          } else {
            // Should not happen if lastNode was set, but as a fallback
            const newNode = this.schema.text(mergedText, textNodeA.marks);
            result.push(newNode);
            lastNode = newNode;
          }
          continue; // Skip adding node B as it's merged
        }
      }

      // Remove empty text nodes unless it's the only node left and it's supposed to be an empty text node
      if ((node.type as NodeType).isText && (node as ModelTextNode).text === "") {
        if (nodes.length === 1 && result.length === 0) { // This is the only node
          result.push(this.schema.text("")); // Keep one empty text node
          lastNode = result[result.length - 1];
        }
        // else, skip adding this empty text node
      } else {
        result.push(node);
        lastNode = node;
      }
    }

    // If, after all processing, the result is empty (e.g., only empty text nodes were provided),
    // ensure there's at least one empty text node to represent an empty paragraph.
    if (result.length === 0) {
      return [this.schema.text("")];
    }

    return result;
  }
}

console.log("modelUtils.ts defined with ModelUtils class and normalizeInlineArray method.");
