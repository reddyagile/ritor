// src/transform/removeMarkStep.ts

import { DocNode, TextNode, Mark, MarkType, BaseNode } from '../documentModel.js';
import { Schema } from '../schema.js';
import { Step, StepResult } from './step.js';
import { StepMap } from './stepMap.js';
import { findTextNodesInRange, replaceNodeInPathWithMany, normalizeMarks, marksEq } from '../modelUtils.js'; // Added marksEq
import { AddMarkStep } from './addMarkStep.js';

export class RemoveMarkStep implements Step {
    constructor(
        public readonly from: number, 
        public readonly to: number,   
        public readonly markToRemove: Mark | MarkType 
    ) {
        if (from > to) throw new Error("RemoveMarkStep: 'from' must be less than or equal to 'to'");
    }

    apply(doc: DocNode): StepResult {
        const schema = doc.type.schema;
        let newDoc = doc;
        
        const textNodesInRange = findTextNodesInRange(doc, this.from, this.to, schema);

        if (textNodesInRange.length === 0) {
            return { doc, map: StepMap.identity };
        }

        textNodesInRange.sort((a, b) => { // Reverse path order
            for (let i = 0; i < Math.min(a.path.length, b.path.length); i++) {
                if (a.path[i] !== b.path[i]) return b.path[i] - a.path[i];
            }
            return b.path.length - a.path.length;
        });

        for (const segment of textNodesInRange) {
            const { node: originalTextNode, path, startOffsetInNode, endOffsetInNode } = segment;
            
            const nodesToInsert: BaseNode[] = [];
            const text = originalTextNode.text;
            const originalMarks = originalTextNode.marks || [];

            // Part before the segment where mark might be removed
            if (startOffsetInNode > 0) {
                nodesToInsert.push(schema.text(text.slice(0, startOffsetInNode), originalMarks));
            }

            // Part to change (remove mark)
            const textToChange = text.slice(startOffsetInNode, endOffsetInNode);
            if (textToChange.length > 0) {
                let newMarks: Mark[];
                if (typeof (this.markToRemove as any).eq === 'function') { // It's a specific Mark instance
                    newMarks = originalMarks.filter(m => !m.eq(this.markToRemove as Mark));
                } else { // It's a MarkType instance
                    newMarks = originalMarks.filter(m => m.type !== (this.markToRemove as MarkType));
                }
                // Normalizing might not be strictly necessary if filter is the only op, but good practice.
                newMarks = normalizeMarks(newMarks); 
                nodesToInsert.push(schema.text(textToChange, newMarks));
            }

            // Part after the segment
            if (endOffsetInNode < text.length) {
                nodesToInsert.push(schema.text(text.slice(endOffsetInNode), originalMarks));
            }

            // If after processing, the node is identical to original (e.g. mark wasn't present), skip replacement
            if (nodesToInsert.length === 1 && 
                nodesToInsert[0].isText && 
                (nodesToInsert[0] as TextNode).text === originalTextNode.text &&
                marksEq(nodesToInsert[0].marks || [], originalMarks)) {
                continue;
            }
            
            const tempDoc = replaceNodeInPathWithMany(newDoc, path, nodesToInsert, schema);
            if (!tempDoc) {
                return { failed: `RemoveMarkStep: Failed to replace nodes at path ${path.join('/')}` };
            }
            newDoc = tempDoc;
        }
        
        return { doc: newDoc, map: StepMap.identity };
    }

    getMap(): StepMap {
        return StepMap.identity;
    }

    invert(doc: DocNode): Step | null {
        if (typeof (this.markToRemove as any).eq === 'function') { // Was a specific Mark instance
            return new AddMarkStep(this.from, this.to, this.markToRemove as Mark);
        } else { 
            console.warn("RemoveMarkStep.invert: Cannot reliably invert removal by MarkType alone; specific attributes of removed marks are unknown.");
            return null; 
        }
    }
}

console.log("transform/removeMarkStep.ts implemented (actual apply logic).");
