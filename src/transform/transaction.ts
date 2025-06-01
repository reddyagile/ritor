// src/transform/transaction.ts

import { DocNode, BaseNode } from '../documentModel.js';
import { Schema } from '../schema.js';
import { Step, StepResult } from './step.js';
import { ReplaceStep } from './replaceStep.js';
import { Slice } from './slice.js';
import { ModelSelection, ModelPosition } from '../selection.js';
import { StepMap } from './stepMap.js';
import { Mapping } from './mapping.js';
import { modelPositionToFlatOffset, flatOffsetToModelPosition } from '../modelUtils.js'; // Ensure correct path

export class Transaction {
    public originalDoc: DocNode;
    public doc: DocNode; // Current document state after steps
    public steps: Step[] = [];
    private maps: StepMap[] = []; // Maps for each step
    public selection: ModelSelection; // Current selection for this transaction
    private scrolledIntoView: boolean = false;
    private meta: Map<string, any> = new Map();
    public readonly schema: Schema;

    constructor(doc: DocNode, initialSelection?: ModelSelection) {
        this.originalDoc = doc;
        this.doc = doc;
        this.schema = doc.type.schema; // Assuming NodeType has a reference to its Schema

        if (initialSelection) {
            this.selection = initialSelection;
        } else {
            // Default selection: start of the document (flat offset 0 or 1, depending on model)
            // For our model, flat offset 1 is usually the start of content in the first block.
            // If doc is empty, flat offset 0 is {path:[], offset:0}
            const defaultFlatOffset = doc.content.length === 0 ? 0 : 1;
            const defaultPos = flatOffsetToModelPosition(this.doc, defaultFlatOffset, this.schema);
            this.selection = { anchor: defaultPos, head: defaultPos };
        }
    }

    // Adds a step to the transaction. Returns this for chaining.
    addStep(step: Step): this {
        // The document state before this step is applied is the current `this.doc`.
        const docBeforeStep = this.doc;
        const result = step.apply(docBeforeStep); // Apply step to current doc state

        if (result.failed) {
            console.warn("Failed to apply step:", result.failed, step);
            return this;
        }
        if (result.doc && result.map) {
            this.doc = result.doc; // Update doc state
            this.steps.push(step);
            this.maps.push(result.map);
            // Map existing selection through the new step's map.
            // The selection was relative to `docBeforeStep`.
            this.selection = this._mapSelection(this.selection, result.map, docBeforeStep);
        }
        return this;
    }

    // Helper to map a selection through a StepMap
    // `docForFlatConversion` is the document state against which the original ModelPositions of the selection were valid
    // and against which the StepMap was generated.
    private _mapSelection(sel: ModelSelection, map: StepMap, docForFlatConversion: DocNode): ModelSelection {
        const newAnchor = this._mapPosition(sel.anchor, map, docForFlatConversion);
        const newHead = this._mapPosition(sel.head, map, docForFlatConversion);
        return { anchor: newAnchor, head: newHead };
    }

    // Helper to map a ModelPosition through a StepMap
    // `docForFlatConversion` is the document state against which the `pos` is currently valid
    // and against which the `map` was generated.
    // The result is a ModelPosition valid against `this.doc` (the state after the step).
    private _mapPosition(pos: ModelPosition, map: StepMap, docForFlatConversion: DocNode): ModelPosition {
        if (!pos) return pos; // Should not happen with valid ModelPosition

        const flatInitial = modelPositionToFlatOffset(docForFlatConversion, pos, this.schema);
        const mappedFlat = map.map(flatInitial);
        // Resolve the new flat position against the transaction's current (updated) document state
        return flatOffsetToModelPosition(this.doc, mappedFlat, this.schema);
    }

    // Convenience method to create and add a ReplaceStep
    // from/to are flat document offsets.
    replace(from: number, to: number, slice: Slice): this {
        const step = new ReplaceStep(from, to, slice);
        return this.addStep(step);
    }

    replaceWith(from: number, to: number, node: BaseNode): this {
        return this.replace(from, to, Slice.fromFragment([node]));
    }

    delete(from: number, to: number): this {
        return this.replace(from, to, Slice.empty);
    }

    insert(pos: number, nodes: BaseNode[] | BaseNode): this {
        const contentArray = Array.isArray(nodes) ? nodes : [nodes];
        return this.replace(pos, pos, Slice.fromFragment(contentArray));
    }

    setSelection(selection: ModelSelection): this {
        // TODO: Validate selection against this.doc
        this.selection = selection;
        return this;
    }

    scrollIntoView(): this {
        this.scrolledIntoView = true;
        return this;
    }

    get stepsApplied(): boolean {
        return this.steps.length > 0;
    }

    get mapping(): Mapping { // Combined mapping of all steps
        return new Mapping(this.maps);
    }

    setMeta(key: string, value: any): this {
        this.meta.set(key, value);
        return this;
    }

    getMeta(key: string): any {
        return this.meta.get(key);
    }
}

console.log("transform/transaction.ts updated for schema param and refined selection mapping.");
