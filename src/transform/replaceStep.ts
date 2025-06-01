// src/transform/replaceStep.ts

import { DocNode, BaseNode, TextNode, InlineNode } from '../documentModel.js';
import { Step, StepResult } from './step.js';
import { StepMap } from './stepMap.js';
import { Slice } from './slice.js';
import { modelPositionToFlatOffset, flatOffsetToModelPosition, normalizeInlineArray, nodeAtPath, replaceNodeAtPath } from '../modelUtils.js';
import { Schema } from '../schema.js';


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

        const fromPos = flatOffsetToModelPosition(doc, this.from, schema);
        const toPos = flatOffsetToModelPosition(doc, this.to, schema);

        if (!fromPos || !toPos) {
            return { failed: "Invalid from/to position for ReplaceStep." };
        }

        // --- PoC Focus: Replacement within a single block's inline content ---
        if (fromPos.path.length === 0 || toPos.path.length === 0) {
             // This PoC handles inline changes. Top-level block changes could be a separate case or require more complex path logic.
             // For now, if path is empty, it means from/to are offsets in doc.content (list of blocks).
             // This was handled by a previous version of ReplaceStep.apply.
             // Let's add a simplified block-level replacement here for now.
            if (fromPos.path.length === 0 && toPos.path.length === 0 && fromPos.offset <= (doc.content || []).length && toPos.offset <= (doc.content || []).length) {
                const newDocContent: BaseNode[] = [];
                const currentDocContent = doc.content || [];
                for(let i=0; i < fromPos.offset; i++) newDocContent.push(currentDocContent[i]);
                newDocContent.push(...this.slice.content);
                for(let i=toPos.offset; i < currentDocContent.length; i++) newDocContent.push(currentDocContent[i]);

                const newDoc = schema.node(doc.type, doc.attrs, newDocContent) as DocNode;
                const map = new StepMap([this.from, this.to, this.from, this.from + this.slice.size]);
                return { doc: newDoc, map };

            } else {
                return { failed: "ReplaceStep PoC: Path resolution for top-level replacement is complex or paths are mixed." };
            }
        }

        // Assuming path like [blockIndex, inlineNodeIndex] for fromPos, or [blockIndex] for fromPos if offset points to block content array
        // For inline replacement, path must be at least 2 deep (block -> inline_node) or 1 deep if offset points to text node directly under block (not typical for current model)
        // Let's refine path logic: fromPos.path points *to the node* where replacement starts.
        // fromPos.offset is *within* that node (char offset for text, child index for element).

        // Parent path for inline content is one level up from the inline node itself.
        const fromParentPath = fromPos.path.slice(0, -1);
        const toParentPath = toPos.path.slice(0, -1);

        if (fromParentPath.join(',') !== toParentPath.join(',')) {
            return { failed: "ReplaceStep PoC: Inline range cannot span multiple parent blocks yet." };
        }
        if (fromParentPath.length === 0 && doc.type.name !== 'doc' && !doc.type.inlineContent) { // Path like [0] (e.g. first text child of a block)
             return { failed: "ReplaceStep PoC: Cannot replace direct children of non-doc root using this inline logic."};
        }


        const parentBlockNode = nodeAtPath(doc, fromParentPath) as BaseNode;
        if (!parentBlockNode || !parentBlockNode.content || parentBlockNode.isLeaf) {
            // If fromParentPath is empty, parentBlockNode is the doc itself.
            // This logic is for inline content within a *child* block of the doc.
            // If parentBlockNode is doc, content is list of blocks, not inline.
             if (parentBlockNode === doc && fromPos.path.length === 1 && toPos.path.length === 1 && fromPos.path[0] === toPos.path[0]) {
                // This means from/to are within the same top-level block.
                // The fromParentPath would be empty.
                // The node to modify is doc.content[fromPos.path[0]].
                // This is effectively replacing a block, or content within that block.
                // This is the primary case this PoC aims to handle.
             } else {
                return { failed: "ReplaceStep PoC: Invalid parent block for inline replacement. Path: " + fromParentPath.join(',') };
             }
        }

        // All slice content must be inline if parentBlockNode is a text block (e.g. paragraph)
        if (parentBlockNode.type.spec.content?.includes("inline") && // e.g. "inline*"
            !this.slice.content.every(n => n.type.spec.inline || n.isText)) {
            return { failed: "ReplaceStep PoC: Cannot insert block content into an inline content parent." };
        }


        const inlineContent = parentBlockNode.content as ReadonlyArray<BaseNode>;
        const fromInlineNodeIndex = fromPos.path[fromPos.path.length - 1]; // Index of the text/inline node
        const fromInlineCharOffset = fromPos.offset; // Character offset within that text/inline node
        const toInlineNodeIndex = toPos.path[toPos.path.length - 1];
        const toInlineCharOffset = toPos.offset;

        const newInlineContent: BaseNode[] = [];

        // Part 1: Content before the starting inline node
        for (let i = 0; i < fromInlineNodeIndex; i++) {
            newInlineContent.push(inlineContent[i]);
        }

        // Part 2: Handle the starting inline node (potentially split)
        const startNode = inlineContent[fromInlineNodeIndex];
        if (!startNode) return { failed: "Start node for replacement not found."};

        if (startNode.isText && !startNode.isLeaf) { // Text node
            if (fromInlineCharOffset > 0) {
                newInlineContent.push(schema.text(startNode.text.slice(0, fromInlineCharOffset), startNode.marks));
            }
        } else if (fromInlineCharOffset !== 0) { // Non-text inline node, offset must be 0 if not splitting
            return { failed: "ReplaceStep PoC: Offset within a non-text inline node must be 0 unless it's a container (not handled yet)." };
        } else if (fromInlineCharOffset === 0 && fromInlineNodeIndex !== toInlineNodeIndex) {
            // If replacing this whole non-text inline node and range continues, it's omitted here.
            // If range starts and ends at this node (offset 0 to its end), it's also omitted.
        } else if (fromInlineCharOffset === 0 && fromInlineNodeIndex === toInlineNodeIndex && toInlineCharOffset === 0 && this.slice.content.length === 0) {
            // Special case: deleting a 0-width range at start of a non-text inline node (no-op, but include node)
            // This case means from == to, and slice is empty. We are deleting nothing.
            // However, the loop for Part 5 will skip this node if fromInlineNodeIndex === toInlineNodeIndex.
            // So, if it's a no-op replacement *at* this node, it should be included.
            // This is complex. For now, if from==to, the original node remains or is replaced by slice.
        }


        // Part 3: Insert the slice content
        newInlineContent.push(...this.slice.content);


        // Part 4: Handle the ending inline node (potentially split)
        const endNode = inlineContent[toInlineNodeIndex];
        if (!endNode) return { failed: "End node for replacement not found."};

        if (endNode.isText && !endNode.isLeaf) { // Text node
            if (toInlineCharOffset < endNode.text.length) {
                newInlineContent.push(schema.text(endNode.text.slice(toInlineCharOffset), endNode.marks));
            }
        } else if (toInlineCharOffset !== (endNode.isLeaf ? 1 : (endNode.content?.length || 0)) && toInlineCharOffset !== 0 ) {
             // If not text, and not leaf with offset 1 (after), or not container with offset at end of children
             // and not offset 0 (before/at start), then it's an unhandled split of non-text inline.
             // For leaf node, toInlineCharOffset could be 1 (meaning after the leaf).
             // If toInlineCharOffset is 0, it means end of range is at start of this node.
            if (!endNode.isLeaf || toInlineCharOffset !== 1) { // Allow offset 1 for end of leaf node
               // console.warn("ReplaceStep PoC: Offset within a non-text inline node at end of range is complex.", endNode, toInlineCharOffset);
            }
        }


        // Part 5: Content after the ending inline node
        for (let i = toInlineNodeIndex + 1; i < inlineContent.length; i++) {
            newInlineContent.push(inlineContent[i]);
        }

        const normalizedNewInlineContent = normalizeInlineArray(newInlineContent as InlineNode[], schema);

        // Create the new parent block node with the modified inline content
        // The path to this parent block node is `fromParentPath`.
        const newDoc = replaceNodeAtPath(doc, fromParentPath, 0,
            schema.node(parentBlockNode.type, parentBlockNode.attrs, normalizedNewInlineContent, parentBlockNode.marks),
            schema
        ) as DocNode | null;

        if (!newDoc) {
            return { failed: "Failed to replace node in path using ModelUtils.replaceNodeAtPath." };
        }

        const map = new StepMap([this.from, this.to, this.from, this.from + this.slice.size]);
        return { doc: newDoc, map };
    }

    getMap(): StepMap {
         return new StepMap([this.from, this.to, this.from, this.from + this.slice.size]);
    }

    invert(doc: DocNode): Step | null {
        // This remains highly simplified. A robust invert needs doc.sliceContent(fromFlat, toFlat).
        const schema = doc.type.schema;
        const fromModelPos = flatOffsetToModelPosition(doc, this.from, schema);
        const toModelPos = flatOffsetToModelPosition(doc, this.to, schema);

        if (!fromModelPos || !toModelPos) return null;

        let originalDeletedContent: BaseNode[] = [];

        // Simplified inversion for top-level blocks or same-text-node
        if (fromModelPos.path.length === 0 && toModelPos.path.length === 0 && this.from < this.to) {
            originalDeletedContent = (doc.content || []).slice(fromModelPos.offset, toModelPos.offset);
        } else {
            // Attempt to get content if path points to a single node (parent of change)
            const parentPath = fromPos.path.slice(0, -1);
            const parentNode = nodeAtPath(doc, parentPath);
            if (parentNode && parentNode.content) {
                 const startIndex = fromModelPos.path[fromPos.path.length -1];
                 const endIndex = toModelPos.path[toPos.path.length -1];
                 if (fromModelPos.path.join(',') === toModelPos.path.join(',')) { // Change within one node
                    const targetNode = parentNode.content[startIndex];
                    if (targetNode.isText) {
                        originalDeletedContent = [schema.text((targetNode as TextNode).text.substring(fromModelPos.offset, toModelPos.offset), targetNode.marks)];
                    } else if (!targetNode.isLeaf) { // Element node, content is array of children
                        originalDeletedContent = (targetNode.content || []).slice(fromModelPos.offset, toModelPos.offset);
                    } else { // Leaf node - if it was replaced, its old self is the content
                         if (fromModelPos.offset === 0 && toModelPos.offset === targetNode.nodeSize) { // replaced whole leaf
                            originalDeletedContent = [targetNode];
                         }
                    }
                 } else { // Spans multiple inline nodes within same parent
                    for(let i = startIndex; i <= endIndex; i++) {
                        // This is still too simple, doesn't handle partial start/end nodes in multi-node span
                        originalDeletedContent.push(parentNode.content[i]);
                    }
                 }
            } else {
                 console.warn("ReplaceStep.invert PoC: Cannot reliably invert complex or cross-parent deletions.");
                 return null;
            }
        }

        const originalSlice = new Slice(originalDeletedContent, 0, 0);
        return new ReplaceStep(this.from, this.from + this.slice.size, originalSlice);
    }
}

console.log("transform/replaceStep.ts updated for more robust inline content replacement (still PoC).");
