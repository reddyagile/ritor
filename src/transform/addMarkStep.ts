// src/transform/addMarkStep.ts

import { DocNode, TextNode, Mark, BaseNode } from '../documentModel.js';
import { Schema } from '../schema.js';
import { Step, StepResult } from './step.js';
import { StepMap } from './stepMap.js';
import { findTextNodesInRange, replaceNodeInPathWithMany, normalizeMarks } from '../modelUtils.js';
import { RemoveMarkStep } from './removeMarkStep.js';

export class AddMarkStep implements Step {
    constructor(
        public readonly from: number, // Flat offset
        public readonly to: number,   // Flat offset
        public readonly mark: Mark
    ) {
        if (from > to) throw new Error("AddMarkStep: 'from' must be less than or equal to 'to'");
        if (!this.mark.type || !this.mark.type.name) throw new Error("AddMarkStep: mark type is invalid.");
    }

    apply(doc: DocNode): StepResult {
        const schema = doc.type.schema;
        let newDoc = doc;
        
        const textNodesInRange = findTextNodesInRange(doc, this.from, this.to, schema);

        if (textNodesInRange.length === 0) {
            return { doc, map: StepMap.identity }; // No change
        }

        // Iterate in reverse order of paths to avoid path invalidation due to modification
        // Path comparison: sort by length descending, then by indices descending
        textNodesInRange.sort((a, b) => {
            for (let i = 0; i < Math.min(a.path.length, b.path.length); i++) {
                if (a.path[i] !== b.path[i]) return b.path[i] - a.path[i];
            }
            return b.path.length - a.path.length;
        });

        for (const segment of textNodesInRange) {
            const { node: originalTextNode, path, startOffsetInNode, endOffsetInNode } = segment;
            
            const nodesToInsert: BaseNode[] = [];
            const text = originalTextNode.text;

            // Part before mark application (if any)
            if (startOffsetInNode > 0) {
                nodesToInsert.push(schema.text(text.slice(0, startOffsetInNode), originalTextNode.marks));
            }

            // Part with the new mark
            const markedTextContent = text.slice(startOffsetInNode, endOffsetInNode);
            if (markedTextContent.length > 0) { // Only add if there's text to mark
                let newMarks = (originalTextNode.marks || []).filter(m => m.type !== this.mark.type); // Remove old mark of same type
                newMarks.push(this.mark); 
                newMarks = normalizeMarks(newMarks); // Ensure sorted, no duplicates
                nodesToInsert.push(schema.text(markedTextContent, newMarks));
            } else if (startOffsetInNode === 0 && endOffsetInNode === 0 && text.length === 0 && originalTextNode.marks.length === 0) {
                // Special case: applying mark to an effectively empty text node placeholder (e.g. after BR, or empty para)
                // ProseMirror might store a "zero-width non-breaking space" with marks in such cases.
                // For now, if text is empty, and range is 0-width, we could add a zero-width char with mark,
                // or this implies an "active mark" for future typing.
                // Current logic: if markedTextContent is empty, it's not added.
                // This means applying mark to empty selection or empty part of text node has no effect on content here.
            }


            // Part after mark application (if any)
            if (endOffsetInNode < text.length) {
                nodesToInsert.push(schema.text(text.slice(endOffsetInNode), originalTextNode.marks));
            }
            
            // If nodesToInsert is empty (e.g. marking an empty part of an empty text node),
            // but the original node had text or marks, we might be deleting it.
            // This shouldn't happen if from < to and textNodesInRange found something.
            // If nodesToInsert is same as original node, skip.
            if (nodesToInsert.length === 1 && 
                nodesToInsert[0].isText && 
                (nodesToInsert[0] as TextNode).text === originalTextNode.text &&
                JSON.stringify(normalizeMarks([...(nodesToInsert[0].marks || [])])) === JSON.stringify(normalizeMarks([...originalTextNode.marks]))) { // Crude check
                // No actual change to this node
                continue;
            }


            const tempDoc = replaceNodeInPathWithMany(newDoc, path, nodesToInsert, schema);
            if (!tempDoc) {
                return { failed: `AddMarkStep: Failed to replace nodes at path ${path.join('/')}` };
            }
            newDoc = tempDoc;
        }
        
        return { doc: newDoc, map: StepMap.identity }; 
    }

    getMap(): StepMap {
        return StepMap.identity;
    }

    invert(doc: DocNode): Step | null {
        return new RemoveMarkStep(this.from, this.to, this.mark);
    }
}

console.log("transform/addMarkStep.ts implemented (actual apply logic).");
