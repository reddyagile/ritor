// src/transform/transaction.ts

import { DocNode, BaseNode, Mark, MarkType } from '../documentModel.js';
import { Schema } from '../schema.js';
import { Step, StepResult } from './step.js';
import { ReplaceStep } from './replaceStep.js';
import { Slice } from './slice.js';
import { ModelSelection, ModelPosition } from '../selection.js';
import { StepMap } from './stepMap.js';
import { Mapping } from './mapping.js'; // Ensure Mapping is imported
import { modelPositionToFlatOffset, flatOffsetToModelPosition } from '../modelUtils.js';
import { AddMarkStep } from './addMarkStep.js';
import { RemoveMarkStep } from './removeMarkStep.js';

export class Transaction {
    public originalDoc: DocNode;
    public doc: DocNode;
    public steps: Step[] = [];
    private _mapping: Mapping; // Changed from maps: StepMap[]
    public selection: ModelSelection;
    private scrolledIntoView: boolean = false;
    private meta: Map<string, any> = new Map();
    public readonly schema: Schema;

    constructor(doc: DocNode, initialSelection?: ModelSelection) {
        this.originalDoc = doc;
        this.doc = doc;
        this.schema = doc.type.schema;
        this._mapping = Mapping.identity; // Initialize with identity mapping

        if (initialSelection) {
            this.selection = initialSelection;
        } else {
            const defaultFlatOffset = (doc.content || []).length === 0 ? 0 : 1; // Handle empty doc case for offset
            const defaultPos = flatOffsetToModelPosition(this.doc, defaultFlatOffset, this.schema);
            this.selection = { anchor: defaultPos, head: defaultPos };
        }
    }

    addStep(step: Step): this {
        const docBeforeStep = this.doc; // Document state before this step
        const result = step.apply(docBeforeStep);

        if (result.failed) {
            console.warn("Failed to apply step:", result.failed, step);
            return this;
        }
        if (result.doc && result.map) {
            this.doc = result.doc;
            this.steps.push(step);
            this._mapping = this._mapping.appendMap(result.map); // Append StepMap to Mapping

            // Map existing selection through the new step's map.
            // The selection was relative to `docBeforeStep`.
            this.selection = this._mapSelection(this.selection, result.map, docBeforeStep);
        }
        return this;
    }

    private _mapSelection(sel: ModelSelection, map: StepMap, docForFlatConversion: DocNode): ModelSelection {
        const newAnchor = this._mapPosition(sel.anchor, map, docForFlatConversion);
        const newHead = this._mapPosition(sel.head, map, docForFlatConversion);
        return { anchor: newAnchor, head: newHead };
    }

    private _mapPosition(pos: ModelPosition, map: StepMap, docForFlatConversion: DocNode): ModelPosition {
        if (!pos) return pos;

        const flatInitial = modelPositionToFlatOffset(docForFlatConversion, pos, this.schema);
        const mappedFlat = map.map(flatInitial);
        // Resolve the new flat position against the transaction's current (updated) document state (`this.doc`)
        return flatOffsetToModelPosition(this.doc, mappedFlat, this.schema);
    }

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
        // (e.g., ensure paths/offsets are within bounds of this.doc)
        // For now, directly setting it.
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

    get mapping(): Mapping {
        return this._mapping;
    }

    setMeta(key: string, value: any): this {
        this.meta.set(key, value);
        return this;
    }

    getMeta(key: string): any {
        return this.meta.get(key);
    }

    addMark(from: number, to: number, mark: Mark): this {
        return this.addStep(new AddMarkStep(from, to, mark));
    }

    removeMark(from: number, to: number, markOrType: Mark | MarkType): this {
        return this.addStep(new RemoveMarkStep(from, to, markOrType));
    }
}

console.log("transform/transaction.ts updated: uses Mapping, refined selection mapping context.");
