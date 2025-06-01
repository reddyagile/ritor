// src/transform/replaceStep.ts

import { DocNode, BaseNode, TextNode } from '../documentModel.js'; // Adjust path as needed
import { Step, StepResult } from './step.js';
import { StepMap } from './stepMap.js';
import { Slice } from './slice.js';
// ModelUtils might be needed for more complex operations later, but not for this PoC apply/invert.
// import { ModelUtils } from '../modelUtils.js';

export class ReplaceStep implements Step {
    constructor(
        public readonly from: number, // Position in document
        public readonly to: number,   // Position in document
        public readonly slice: Slice  // The content to insert
    ) {
        if (from > to) throw new Error("ReplaceStep: 'from' must be less than or equal to 'to'");
    }

    apply(doc: DocNode): StepResult {
        // PoC Simplification:
        // - Assumes 'from' and 'to' map directly to indices in the doc.content array (for blocks).
        // - Assumes slice.content is also a flat array of block nodes.
        // - Assumes slice.openStart and slice.openEnd are 0.
        // - Does not handle partial node replacements (splitting nodes).
        // - Positions are based on node counts, not deep character offsets for this PoC.

        if (this.from < 0 || this.to > doc.content.length) { // Simplified check using array length
            // A proper check would use doc.contentSize and character-level positions
            return { failed: "Invalid from/to for ReplaceStep PoC (maps to block indices)" };
        }

        // Check if 'from' and 'to' are at node boundaries (essential for PoC)
        // This simplified check assumes each block node has size 1 for positioning at block level
        // A real check would use accumulated nodeSize.
        // For this PoC, we are effectively treating 'from' and 'to' as block indices.

        const newContent: BaseNode[] = [];

        // 1. Add content before 'from'
        for (let i = 0; i < this.from; i++) {
            newContent.push(doc.content[i]);
        }

        // 2. Add content from the slice
        if (this.slice.content.length > 0) {
            newContent.push(...this.slice.content);
        }

        // 3. Add content after 'to'
        for (let i = this.to; i < doc.content.length; i++) {
            newContent.push(doc.content[i]);
        }

        // Create new DocNode. Attributes and schema type are taken from the original document.
        // The `create` method on NodeType is responsible for calculating new nodeSize/contentSize.
        const newDoc = doc.type.create(doc.attrs, newContent) as DocNode;

        // The StepMap for this simplified ReplaceStep.
        // Maps the range [from, to] in the old doc to [from, from + slice.size] in the new doc.
        // Here, slice.size is the number of new blocks inserted for this PoC.
        // A real slice.size would be character length or sum of nodeSizes.
        let insertedSize = 0;
        for(const node of this.slice.content) {
            insertedSize += (node.nodeSize || 1); // Using nodeSize as defined, fallback to 1
        }
        const map = new StepMap([this.from, this.to, this.from, this.from + insertedSize]);

        return { doc: newDoc, map };
    }

    getMap(): StepMap {
        let insertedSize = 0;
        for(const node of this.slice.content) {
            insertedSize += (node.nodeSize || 1);
        }
        return new StepMap([this.from, this.to, this.from, this.from + insertedSize]);
    }

    invert(doc: DocNode): Step | null {
        // To invert a ReplaceStep, we create a new ReplaceStep that:
        // - Starts at 'this.from'.
        // - Ends at 'this.from + this.slice.size' (the length of the content inserted by this step).
        // - The slice to insert is the content that was originally deleted by this step,
        //   which is the content of 'doc' (the document *before* this step) from 'this.from' to 'this.to'.

        // PoC sliceContent:
        const originalDeletedContent: BaseNode[] = [];
        if (this.from < this.to) { // If there was actual content deleted
            // Assuming 'from' and 'to' are block indices for PoC
            for (let i = this.from; i < this.to; i++) {
                if (doc.content[i]) { // Check if node exists
                     originalDeletedContent.push(doc.content[i]);
                } else {
                    console.warn(`ReplaceStep.invert: Invalid index ${i} when slicing original doc content.`);
                    return null; // Cannot reliably invert
                }
            }
        }
        const originalSlice = new Slice(originalDeletedContent, 0, 0); // PoC: always closed slice

        let currentSliceSize = 0;
         for(const node of this.slice.content) {
            currentSliceSize += (node.nodeSize || 1);
        }

        return new ReplaceStep(this.from, this.from + currentSliceSize, originalSlice);
    }

    // toJSON / fromJSON would be needed for serialization if steps were sent over network or stored.
    // static fromJSON(schema: Schema, json: any): ReplaceStep {
    //   return new ReplaceStep(json.from, json.to, Slice.fromJSON(schema, json.slice));
    // }
    // toJSON(): any {
    //   return { stepType: "replace", from: this.from, to: this.to, slice: this.slice.toJSON() };
    // }
}

console.log("transform/replaceStep.ts defined: ReplaceStep class.");
