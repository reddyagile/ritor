// src/transform/diff.ts

import { BaseNode } from '../documentModel.js';
import { Schema } from '../schema.js'; // Corrected import for Schema
import { Slice } from './slice.js';
import { Step } from './step.js';
import { ReplaceStep } from './replaceStep.js'; // Corrected import for ReplaceStep
import { areNodesEffectivelyEqual } from '../modelUtils.js';

/**
 * Compares two arrays of model nodes and generates a ReplaceStep to transform
 * the old array into the new one. This is a simplified sequence diff.
 *
 * @param oldNodes The array of old nodes.
 * @param newNodes The array of new nodes.
 * @param startFlatOffset The flat document offset where oldNodes begin.
 * @param schema The schema instance.
 * @returns An array of Steps (at most one ReplaceStep in this simplified version).
 */
export function diffFragment(
    oldNodes: ReadonlyArray<BaseNode>,
    newNodes: ReadonlyArray<BaseNode>,
    startFlatOffset: number,
    // schema: Schema // Schema might not be needed if nodeSize is always on BaseNode
): Step[] {
    let firstDiff = -1;
    for (let i = 0; i < oldNodes.length && i < newNodes.length; i++) {
        if (!areNodesEffectivelyEqual(oldNodes[i], newNodes[i])) {
            firstDiff = i;
            break;
        }
    }

    // If all nodes are common from the start (or one array is a prefix of the other and common parts are equal)
    if (firstDiff === -1) {
        if (oldNodes.length === newNodes.length) {
            return []; // Arrays are effectively equal
        }
        firstDiff = Math.min(oldNodes.length, newNodes.length);
    }

    let lastDiffOld = oldNodes.length - 1;
    let lastDiffNew = newNodes.length - 1;

    while (lastDiffOld >= firstDiff && lastDiffNew >= firstDiff && areNodesEffectivelyEqual(oldNodes[lastDiffOld], newNodes[lastDiffNew])) {
        lastDiffOld--;
        lastDiffNew--;
    }

    // Calculate flat offsets for the replacement range
    let fromFlat = startFlatOffset;
    for (let i = 0; i < firstDiff; i++) {
        fromFlat += oldNodes[i].nodeSize;
    }

    let toFlat = startFlatOffset;
    // Iterate up to and including the original lastDiffOld + 1 position if we are deleting something
    // Or up to firstDiff if all trailing nodes were different or old array was shorter
    for (let i = 0; i <= lastDiffOld; i++) {
        toFlat += oldNodes[i].nodeSize;
    }
     // If firstDiff is beyond oldNodes.length, it means all old nodes are common prefixes
    // and we are only adding. In this case, `toFlat` should be same as `fromFlat`.
    if (firstDiff >= oldNodes.length) {
        toFlat = fromFlat;
    }


    const nodesToInsert = newNodes.slice(firstDiff, lastDiffNew + 1);
    const slice = Slice.fromFragment(nodesToInsert); // openStart/End = 0 by default

    if (fromFlat < toFlat || slice.content.length > 0) {
        // Ensure `toFlat` is not less than `fromFlat` if slice is empty (pure deletion)
        // However, ReplaceStep handles from==to for insertions.
        // If old part is empty (firstDiff > lastDiffOld) and new part is also empty,
        // it means firstDiff was set to min(len,len) and then lastDiffs were reduced.
        // This check is to avoid creating empty steps if truly nothing changed.
        if (lastDiffOld < firstDiff && nodesToInsert.length === 0) {
             return []; // Nothing to delete, nothing to insert
        }
        return [new ReplaceStep(fromFlat, toFlat, slice)];
    }

    return [];
}

console.log("transform/diff.ts: diffFragment PoC implemented.");
