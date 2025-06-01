// src/transform/step.ts

import { DocNode } from '../documentModel.js'; // Adjust path as needed
import { StepMap } from './stepMap.js';
// Slice might be needed if invert() or other methods return/deal with Slices directly.
// For now, ReplaceStep will use it internally.
import { Slice } from './slice.js';

export interface StepResult {
    /** The transformed document. Null if the step failed. */
    doc?: DocNode;
    /** A description of why the step failed, if it did. */
    failed?: string;
    /** A StepMap that maps positions in the old document to the new document. */
    map?: StepMap;
}

export interface Step {
    /**
     * Applies this step to a document, returning a StepResult.
     * @param doc The document to apply the step to.
     */
    apply(doc: DocNode): StepResult;

    /**
     * Returns a StepMap for this step.
     */
    getMap(): StepMap;

    /**
     * Creates a new step that is the inverse of this step.
     * The `doc` parameter is the document *before* this step was applied.
     * This is used for undoing the step.
     * Returns `null` if the step cannot be inverted (should be rare for well-defined steps).
     */
    invert(doc: DocNode): Step | null;

    /**
     * Future methods for transform operations:
     * map(mapping: Mappable, doc: DocNode): Step | null; // Map step through another's changes
     * merge(other: Step): Step | null; // Try to merge two steps
     * toJSON(): object; // For serialization
     */
    // static fromJSON(schema: Schema, json: object): Step; // For deserialization
}

console.log("transform/step.ts defined: Step interface and StepResult.");
