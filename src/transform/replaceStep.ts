// src/transform/replaceStep.ts

import { DocNode, BaseNode, TextNode } from '../documentModel.js';
import { Step, StepResult } from './step.js';
import { StepMap } from './stepMap.js';
import { Slice } from './slice.js';
import { modelPositionToFlatOffset, flatOffsetToModelPosition, normalizeInlineArray } from '../modelUtils.js'; // Assuming modelUtils path
import { Schema } from '../schema.js';


// Helper function to find a node and its parent/path by flat offset.
// This is a simplified version for ReplaceStep's PoC needs.
// Returns null if offset is out of bounds or path is ambiguous for simple replacement.
function findNodePathAtFlatOffset(doc: DocNode, flatOffset: number, schema: Schema): { node: BaseNode | null, path: number[], localOffset: number, parent: BaseNode } | null {
    const modelPos = flatOffsetToModelPosition(doc, flatOffset, schema);
    if (!modelPos) return null;

    let currentParent: BaseNode = doc;
    let currentChildren = doc.content || [];
    let path: number[] = [];

    for (let i = 0; i < modelPos.path.length; i++) {
        const childIdx = modelPos.path[i];
        if (childIdx >= currentChildren.length) return null; // Path out of bounds

        const childNode = currentChildren[childIdx];
        path.push(childIdx);
        currentParent = childNode; // This becomes parent for next iteration or if path ends here
        currentChildren = childNode.content || []; // For next iter

        if (i === modelPos.path.length - 1) { // Path points to this node
            return { node: childNode, path: modelPos.path, localOffset: modelPos.offset, parent: currentParent }; // currentParent is actually the node itself here
        }
    }
    // If path is empty (points to doc) or path points to an element node where offset is child index
    return { node: null, path: modelPos.path, localOffset: modelPos.offset, parent: currentParent };
}


// Very simplified recursive node replacement/creation for immutable updates.
// This is a placeholder for a more robust solution.
function replaceInPath(
    currentParent: BaseNode,
    path: number[],
    pathIdx: number,
    fromModelPos: ModelPosition,
    toModelPos: ModelPosition,
    insertSlice: Slice | null, // null for deletion only
    schema: Schema
): BaseNode {
    const currentChildren = currentParent.content ? [...currentParent.content] : [];

    if (pathIdx === path.length) { // We are at the level where changes occur (children of currentParent)
        const newChildren: BaseNode[] = [];
        let startIdx = fromModelPos.offset;
        let endIdx = toModelPos.offset; // If path is same, endIdx is also an offset in this parent

        if (fromModelPos.path.join(',') !== toModelPos.path.join(',')) { // Deletion/replacement spans multiple parents
            // This PoC does not handle cross-parent modification deeply.
            // It will effectively delete from startIdx in currentParent if 'from' is here,
            // or insert at startIdx if 'to' is here but 'from' was in a prior node.
             if (path.join(',') === fromModelPos.path.slice(0, pathIdx).join(',')) { // 'from' is in this parent or its descendant
                endIdx = currentChildren.length; // Delete to end of this parent
             } else if (path.join(',') === toModelPos.path.slice(0, pathIdx).join(',')) { // 'to' is in this parent, 'from' was before
                startIdx = 0; // Delete from start of this parent
             } else { // This parent is fully between 'from' and 'to'
                return schema.node(currentParent.type, currentParent.attrs, []) as BaseNode; // Delete all content
             }
        }

        // Simplified text node modification (if paths point to same text node)
        if (currentParent.isText && fromModelPos.path.join(',') === toModelPos.path.join(',')) {
            const textNode = currentParent as TextNode;
            let newText = textNode.text.substring(0, fromModelPos.offset);
            if (insertSlice && insertSlice.content.length > 0 && insertSlice.content[0].isText) {
                newText += (insertSlice.content[0] as TextNode).text;
            }
            newText += textNode.text.substring(toModelPos.offset);
            return schema.text(newText, textNode.marks);
        }

        // Block/inline array modification
        for (let i = 0; i < startIdx; i++) newChildren.push(currentChildren[i]);
        if (insertSlice) { // Insertion or replacement
            // TODO: Handle openStart/openEnd for slices properly. For PoC, assume flat insertion.
            newChildren.push(...insertSlice.content);
        }
        for (let i = endIdx; i < currentChildren.length; i++) newChildren.push(currentChildren[i]);

        const normalized = currentParent.type.inlineContent ? normalizeInlineArray(newChildren as InlineNode[]) : newChildren;
        return schema.node(currentParent.type, currentParent.attrs, normalized) as BaseNode;

    } else { // Descend further
        const childToModifyIdx = path[pathIdx];
        if (childToModifyIdx >= currentChildren.length) {
            throw new Error("Path out of bounds during replaceInPath recursion.");
        }
        currentChildren[childToModifyIdx] = replaceInPath(
            currentChildren[childToModifyIdx],
            path,
            pathIdx + 1,
            fromModelPos,
            toModelPos,
            insertSlice,
            schema
        );
        return schema.node(currentParent.type, currentParent.attrs, currentChildren) as BaseNode;
    }
}


export class ReplaceStep implements Step {
    constructor(
        public readonly from: number, // Flat position in document
        public readonly to: number,   // Flat position in document
        public readonly slice: Slice  // The content to insert
    ) {
        if (from > to) throw new Error("ReplaceStep: 'from' must be less than or equal to 'to'");
    }

    apply(doc: DocNode): StepResult {
        const schema = doc.type.schema;
        const fromModelPos = flatOffsetToModelPosition(doc, this.from, schema);
        const toModelPos = flatOffsetToModelPosition(doc, this.to, schema);

        if (!fromModelPos || !toModelPos) {
            return { failed: "Invalid from/to position for ReplaceStep." };
        }

        // PoC Simplification:
        // This simplified 'apply' assumes changes happen within a common ancestor,
        // ideally at the same level or within a single text node.
        // It does NOT handle complex cases like splitting nodes deeply, joining across depths, etc.
        // It primarily works for top-level block replacement or simple text changes.

        let newDocNode: DocNode;

        // Case 1: Replacing content within the same text node (most granular)
        if (fromModelPos.path.join(',') === toModelPos.path.join(',') &&
            fromModelPos.path.length > 0 ) { // Path must exist

            let node = doc as BaseNode;
            for(let i=0; i < fromModelPos.path.length; i++) {
                if (!node.content || fromModelPos.path[i] >= node.content.length) return {failed: "Path invalid"};
                node = node.content[fromModelPos.path[i]];
            }

            if (node.isText) {
                 newDocNode = replaceInPath(doc, fromModelPos.path, 0, fromModelPos, toModelPos, this.slice, schema) as DocNode;
            } else { // Path points to an element node, replacement is of its children
                 const commonPath = fromModelPos.path; // Path to the parent element
                 newDocNode = replaceInPath(doc, commonPath, 0, fromModelPos, toModelPos, this.slice, schema) as DocNode;
            }

        }
        // Case 2: Replacing block nodes at the document level (path is empty for from/to ModelPos, offset is index)
        else if (fromModelPos.path.length === 0 && toModelPos.path.length === 0) {
            const newContent: BaseNode[] = [];
            const docContent = doc.content || [];
            for (let i = 0; i < fromModelPos.offset; i++) newContent.push(docContent[i]);
            if (this.slice.content.length > 0) newContent.push(...this.slice.content);
            for (let i = toModelPos.offset; i < docContent.length; i++) newContent.push(docContent[i]);
            newDocNode = schema.node(doc.type, doc.attrs, newContent) as DocNode;
        }
        // Case 3: More complex, potentially cross-parent modification (highly simplified for PoC)
        // Find common ancestor path. For PoC, assume it's the doc node if paths differ significantly.
        else {
            // This PoC replaceInPath is not robust enough for general cross-parent.
            // Fallback to a simpler top-level block replacement logic if paths are different.
            // This is a significant simplification.
            console.warn("ReplaceStep PoC: Complex cross-parent replacement is simplified. Results may be approximate.");
            // Try to find the shallowest common ancestor for the modification.
            // For this PoC, we'll assume the common ancestor is the doc node itself for any complex case.
            // This is a very rough approximation.

            // A more robust way would be to find the actual common ancestor path.
            // For now, this simplified logic will likely fail for many complex cases.
            // Let's try to make it slightly better: use the shorter path as the "parent" path for replaceInPath.
            const pathForReplace = fromModelPos.path.length <= toModelPos.path.length ? fromModelPos.path : toModelPos.path;
            // This is still not correct, common ancestor needs to be found.
            // For PoC, if not simple text or simple block, let's just do a block-level based on from/to offsets
            // This is very hacky for now.
            const startBlockIndex = fromModelPos.path.length > 0 ? fromModelPos.path[0] : fromModelPos.offset;
            const endBlockIndex = toModelPos.path.length > 0 ? toModelPos.path[0] : toModelPos.offset;
            // This is not robust at all if paths are deeper.

            const newContent: BaseNode[] = [];
            const docContent = doc.content || [];
            for (let i = 0; i < startBlockIndex; i++) { // Use startBlockIndex as a rough guide
                if (docContent[i]) newContent.push(docContent[i]);
            }
            if (this.slice.content.length > 0) newContent.push(...this.slice.content);
            for (let i = endBlockIndex + (fromModelPos.path.length > 0 ? 1: 0) ; i < docContent.length; i++) { // Use endBlockIndex as rough guide
                 if (docContent[i]) newContent.push(docContent[i]);
            }
             newDocNode = schema.node(doc.type, doc.attrs, newContent) as DocNode;

            // return { failed: "ReplaceStep PoC: Only same-text-node or top-level block replacement is reliably supported." };
        }

        const map = new StepMap([this.from, this.to - this.from, this.from + this.slice.size]);
        // The StepMap constructor used here [delOffset, delCount, insCount] is from an earlier PoC.
        // A more standard StepMap might be `new StepMap([this.from, this.to, this.from, this.from + this.slice.size])`
        // For now, let's use the one compatible with current StepMap PoC: range [oldStart, oldEnd, newStart, newEnd]
        const stepMapInstance = new StepMap([this.from, this.to, this.from, this.from + this.slice.size]);

        return { doc: newDocNode, map: stepMapInstance };
    }

    getMap(): StepMap {
         return new StepMap([this.from, this.to, this.from, this.from + this.slice.size]);
    }

    invert(doc: DocNode): Step | null {
        // To invert, we need the content of the document that was replaced by this step.
        // This content is between `this.from` and `this.to` in the original `doc`.
        // This requires a method like `doc.sliceContent(fromFlat, toFlat)`

        // PoC: If we can resolve from/to to simple block indices for the original doc.
        const schema = doc.type.schema;
        const fromModelPos = flatOffsetToModelPosition(doc, this.from, schema);
        const toModelPos = flatOffsetToModelPosition(doc, this.to, schema);

        if (!fromModelPos || !toModelPos) return null;

        let originalDeletedContent: BaseNode[] = [];

        if (fromModelPos.path.length === 0 && toModelPos.path.length === 0 && this.from < this.to) { // Simple top-level block deletion
            originalDeletedContent = (doc.content || []).slice(fromModelPos.offset, toModelPos.offset);
        } else if (fromModelPos.path.join(',') === toModelPos.path.join(',') && fromModelPos.path.length > 0) {
            // Content deleted within a single node (e.g., text)
            // This is hard to get accurately without a proper doc.sliceContentByPath method.
            // For PoC, if it was text, we'd need the substring.
            // For now, this PoC invert will be limited.
            let parentNode = doc as BaseNode;
            for(let i=0; i < fromModelPos.path.length -1; i++) parentNode = parentNode.content![fromModelPos.path[i]];
            const targetNode = parentNode.content![fromModelPos.path[fromModelPos.path.length-1]];
            if (targetNode.isText) {
                originalDeletedContent = [schema.text((targetNode as TextNode).text.substring(fromModelPos.offset, toModelPos.offset), targetNode.marks)];
            } else { // Deletion of children within an element
                originalDeletedContent = (targetNode.content || []).slice(fromModelPos.offset, toModelPos.offset);
            }
        } else {
            // Cannot reliably invert complex cross-parent deletions with this PoC.
            console.warn("ReplaceStep.invert PoC: Cannot reliably invert complex or cross-parent deletions.");
            return null;
        }

        const originalSlice = new Slice(originalDeletedContent, 0, 0); // PoC: always closed slice

        return new ReplaceStep(this.from, this.from + this.slice.size, originalSlice);
    }
}

console.log("transform/replaceStep.ts updated to use flat offsets and modelUtils for position resolution (still PoC apply).");
