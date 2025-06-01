// src/transform/replaceStep.ts

import { DocNode, BaseNode, TextNode, InlineNode } from '../documentModel.js';
import { Step, StepResult } from './step.js';
import { StepMap } from './stepMap.js';
import { Slice } from './slice.js';
import { modelPositionToFlatOffset, flatOffsetToModelPosition, normalizeInlineArray, nodeAtPath, replaceNodeAtPath } from '../modelUtils.js';
import { Schema } from '../schema.js';


// Helper to get the content of a node, defaulting to an empty array
function getContent(node: BaseNode | null | undefined): ReadonlyArray<BaseNode> {
    return node?.content || [];
}

// Helper to get text of a text node, defaulting to empty string
function getText(node: BaseNode | null | undefined): string {
    if (node && node.isText && !node.isLeaf) {
        return (node as TextNode).text;
    }
    return "";
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

        // Handle simplest case: replacing all content
        if (this.from === 0 && this.to === doc.nodeSize) {
            // Ensure slice content is block nodes if doc only accepts blocks
            let newContent = this.slice.content;
            if (doc.type.contentMatcher.length > 0 && doc.type.contentMatcher[0].name === "block" && // doc expects blocks
                this.slice.content.some(n => n.type.spec.inline || n.isText)) { // slice has inline nodes
                // Wrap inline content in default block (paragraph)
                const defaultBlockType = schema.nodes.paragraph || schema.defaultBlockType();
                if (!defaultBlockType) return {failed: "Cannot wrap inline slice content: no default block type (e.g. paragraph) in schema."};
                newContent = [defaultBlockType.create(null, this.slice.content)];
            }
            const newDoc = schema.node(doc.type, doc.attrs, newContent) as DocNode;
            const map = new StepMap([this.from, this.to, this.from, this.from + newDoc.content.reduce((s,n)=>s+n.nodeSize,0)]); // slice.size might be different if wrapped
            return { doc: newDoc, map };
        }

        const fromPos = flatOffsetToModelPosition(doc, this.from, schema);
        const toPos = flatOffsetToModelPosition(doc, this.to, schema);

        if (!fromPos || !toPos) {
            return { failed: "Invalid from/to position for ReplaceStep." };
        }

        // If both positions are within the same block's inline content (common case for text editing)
        // This assumes path structure [blockIndex, inlineIndex1, inlineIndex2, ...]
        // For path like [blockIndex, textNodeIndex], parent path is [blockIndex]
        const fromParentPath = fromPos.path.slice(0, -1);
        const toParentPath = toPos.path.slice(0, -1);

        if (fromPos.path.length > 0 && toPos.path.length > 0 && fromParentPath.join(',') === toParentPath.join(',')) {
            const parentBlockPath = fromParentPath;
            const parentBlockNode = nodeAtPath(doc, parentBlockPath) as BaseNode;

            if (parentBlockNode && parentBlockNode.content && !parentBlockNode.isLeaf && parentBlockNode.type.spec.content?.includes("inline")) {
                // This is the inline replacement logic from the previous subtask
                const inlineContent = parentBlockNode.content as ReadonlyArray<BaseNode>;
                const fromInlineNodeIndex = fromPos.path[fromPos.path.length - 1];
                const fromInlineCharOffset = fromPos.offset;
                const toInlineNodeIndex = toPos.path[toPos.path.length - 1];
                const toInlineCharOffset = toPos.offset;

                const newInlineContent: BaseNode[] = [];

                for (let i = 0; i < fromInlineNodeIndex; i++) newInlineContent.push(inlineContent[i]);

                const startNode = inlineContent[fromInlineNodeIndex];
                if (startNode) {
                    if (startNode.isText && !startNode.isLeaf) {
                        if (fromInlineCharOffset > 0) newInlineContent.push(schema.text(getText(startNode).slice(0, fromInlineCharOffset), startNode.marks));
                    } else if (fromInlineCharOffset !== 0) return {failed: "PoC: Offset in non-text start node."};
                }

                newInlineContent.push(...this.slice.content);

                const endNode = inlineContent[toInlineNodeIndex];
                if (endNode) {
                    if (endNode.isText && !endNode.isLeaf) {
                        if (toInlineCharOffset < getText(endNode).length) newInlineContent.push(schema.text(getText(endNode).slice(toInlineCharOffset), endNode.marks));
                    } else if (endNode.isLeaf && toInlineCharOffset === 0) { // if range ends before a leaf, that leaf remains
                        // This means the leaf node itself was not part of the "to be deleted" range if to==from
                    } else if (toInlineCharOffset !== (endNode.isLeaf ? 1 : (endNode.content?.length || 0))) {
                        // console.warn("Offset in non-text end node may not be fully handled.");
                    }
                }

                for (let i = toInlineNodeIndex + 1; i < inlineContent.length; i++) newInlineContent.push(inlineContent[i]);

                const normalizedNewInlineContent = normalizeInlineArray(newInlineContent as InlineNode[], schema);
                const newParentBlock = schema.node(parentBlockNode.type, parentBlockNode.attrs, normalizedNewInlineContent, parentBlockNode.marks);

                const newDoc = replaceNodeAtPath(doc, parentBlockPath, 0, newParentBlock, schema) as DocNode | null;

                if (!newDoc) return { failed: "Failed to replace node in path for inline modification." };

                const map = new StepMap([this.from, this.to, this.from, this.from + this.slice.size]);
                return { doc: newDoc, map };
            }
        }

        // --- Handle multi-block or full-block replacements ---
        // Determine the range of top-level blocks affected.
        // fromPos.path[0] is the index of the block where `from` offset lands.
        // toPos.path[0] is the index of the block where `to` offset lands.
        // fromPos.offset is offset within that block (char for text, or child index for element) OR block index if path is empty.

        let firstAffectedBlockIndex: number;
        let lastAffectedBlockIndex: number;
        let startBlockCutoffOffset: number = 0; // Char offset if from is inside start block's text
        let endBlockCutoffOffset: number = -1;  // Char offset if to is inside end block's text (-1 means full block)

        if (fromPos.path.length === 0) { // `from` points to the doc node itself, offset is block index
            firstAffectedBlockIndex = fromPos.offset;
        } else {
            firstAffectedBlockIndex = fromPos.path[0];
            if (fromPos.path.length > 1) { // `from` is inside the block's inline content
                // For PoC, we only handle if fromPos points to a text node within the block
                const fromBlock = doc.content[firstAffectedBlockIndex];
                const fromInlineNode = fromBlock?.content?.[fromPos.path[1]];
                if (fromInlineNode?.isText) startBlockCutoffOffset = fromPos.offset;
                else startBlockCutoffOffset = 0; // Treat as start of block if not simple text offset
            } else { // Path is [blockIndex], offset is within block's children (not typical for this model's pos)
                startBlockCutoffOffset = 0; // Treat as start of block
            }
        }

        if (toPos.path.length === 0) { // `to` points to the doc node itself, offset is block index
            lastAffectedBlockIndex = toPos.offset -1; // toPos.offset is exclusive end index
        } else {
            lastAffectedBlockIndex = toPos.path[0];
            if (toPos.path.length > 1) {
                const toBlock = doc.content[lastAffectedBlockIndex];
                const toInlineNode = toBlock?.content?.[toPos.path[1]];
                if (toInlineNode?.isText) endBlockCutoffOffset = toPos.offset;
                // else endBlockCutoffOffset remains -1 (full block)
            }
             // if path.length is 1, toPos.offset is usually child index, for full block, effectively -1
        }

        const finalDocContent: BaseNode[] = [];

        // 1. Add blocks before the first affected block
        for (let i = 0; i < firstAffectedBlockIndex; i++) {
            finalDocContent.push(doc.content[i]);
        }

        // 2. Handle the first affected block (if partially kept)
        if (startBlockCutoffOffset > 0 && firstAffectedBlockIndex <= lastAffectedBlockIndex) {
            const startBlockNode = doc.content[firstAffectedBlockIndex];
            if (startBlockNode && startBlockNode.type.spec.content?.includes("inline")) { // Check if it's a text block
                // Simplified: assumes first child of startBlockNode is the text node to be cut.
                // A robust solution would use the full fromPos.path to find the exact text node.
                const textNodeToSplit = startBlockNode.content?.[0] as TextNode; // Highly simplified
                if (textNodeToSplit && textNodeToSplit.isText && startBlockCutoffOffset < getText(textNodeToSplit).length) {
                    const leadingText = schema.text(getText(textNodeToSplit).slice(0, startBlockCutoffOffset), textNodeToSplit.marks);
                    // For PoC, assume only this leading text is kept from the start block
                    finalDocContent.push(schema.node(startBlockNode.type, startBlockNode.attrs, [leadingText]));
                } else if (textNodeToSplit && textNodeToSplit.isText && startBlockCutoffOffset === getText(textNodeToSplit).length) {
                    // from is at the very end of the text node, so the whole block is kept if it's not also the end block
                     finalDocContent.push(startBlockNode);
                } else { // Cannot split or offset is at start/end, so block is either fully kept or fully replaced
                    // If startBlockCutoffOffset > 0 but not a simple text split, this PoC might drop the block.
                    // For safety, if we can't do a partial, and it's not fully removed, keep it.
                    // This part is tricky: if from is inside, but not simple text, what to do?
                    // For now, if startBlockCutoffOffset > 0, we assume we processed it.
                    // If it's 0, the block is fully part of the deleted range.
                }
            } else if (startBlockNode) { // Non-text block, but from is inside it? Not handled by this PoC.
                 finalDocContent.push(startBlockNode); // Keep it if not sure how to cut
            }
        }
        // If startBlockCutoffOffset is 0, the startBlockNode is entirely within the deleted/replaced range.

        // 3. Add content from the slice
        // If slice contains inline nodes and we are in a block context, wrap them.
        let currentBlockContent: InlineNode[] = [];
        for (const sliceNode of this.slice.content) {
            if (sliceNode.type.spec.inline || sliceNode.isText) {
                currentBlockContent.push(sliceNode as InlineNode);
            } else { // It's a block node
                if (currentBlockContent.length > 0) { // Wrap previous inline nodes
                    const defaultBlock = schema.defaultBlockType() || schema.nodes.paragraph;
                    if (!defaultBlock) return {failed: "No default block type to wrap inline slice content."};
                    finalDocContent.push(defaultBlock.create(null, normalizeInlineArray(currentBlockContent, schema)));
                    currentBlockContent = [];
                }
                finalDocContent.push(sliceNode); // Add the block node from slice
            }
        }
        if (currentBlockContent.length > 0) { // Wrap any remaining inline nodes
            const defaultBlock = schema.defaultBlockType() || schema.nodes.paragraph;
            if (!defaultBlock) return {failed: "No default block type to wrap final inline slice content."};
            finalDocContent.push(defaultBlock.create(null, normalizeInlineArray(currentBlockContent, schema)));
        }


        // 4. Handle the last affected block (if partially kept)
        if (endBlockCutoffOffset !== -1 && lastAffectedBlockIndex >= firstAffectedBlockIndex) {
            const endBlockNode = doc.content[lastAffectedBlockIndex];
            // If start and end block are the same, and start was partially kept, this is complex.
            // This PoC assumes if startBlockCutoffOffset > 0, start block handling is done.
            // If endBlock is different from startBlock OR if startBlock was fully taken by 'from'.
            if (endBlockNode && startBlockNode !== endBlockNode && endBlockNode.type.spec.content?.includes("inline")) {
                const textNodeToSplit = endBlockNode.content?.[0] as TextNode; // Highly simplified
                if (textNodeToSplit && textNodeToSplit.isText && endBlockCutoffOffset < getText(textNodeToSplit).length) {
                    const trailingText = schema.text(getText(textNodeToSplit).slice(endBlockCutoffOffset), textNodeToSplit.marks);
                    finalDocContent.push(schema.node(endBlockNode.type, endBlockNode.attrs, [trailingText]));
                }
                // If endBlockCutoffOffset is at end of text or not simple text split, block is fully replaced.
            } else if (endBlockNode && startBlockNode !== endBlockNode) { // Non-text block, but 'to' is inside it?
                // Keep it if not sure how to cut. But if endBlockCutoffOffset != -1, it means 'to' was inside.
                // This PoC will likely drop it if it can't do a partial text cut.
            }
        }
        // If endBlockCutoffOffset is -1, the endBlockNode is entirely within the deleted/replaced range.

        // 5. Add blocks after the last affected block
        for (let i = lastAffectedBlockIndex + 1; i < doc.content.length; i++) {
            finalDocContent.push(doc.content[i]);
        }

        const newDoc = schema.node(doc.type, doc.attrs, finalDocContent) as DocNode;
        const map = new StepMap([this.from, this.to, this.from, this.from + this.slice.size]);
        return { doc: newDoc, map };
    }

    getMap(): StepMap {
         return new StepMap([this.from, this.to, this.from, this.from + this.slice.size]);
    }

    invert(doc: DocNode): Step | null {
        // This remains highly simplified.
        const schema = doc.type.schema;
        let originalDeletedContent: BaseNode[] = [];

        // Attempt to slice the original document's content between flat from/to.
        // This is a very rough approximation of slicing content.
        const fromM = flatOffsetToModelPosition(doc, this.from, schema);
        const toM = flatOffsetToModelPosition(doc, this.to, schema);

        if(fromM.path.length === 0 && toM.path.length === 0) { // top level blocks
            originalDeletedContent = (doc.content || []).slice(fromM.offset, toM.offset);
        } else {
            // TODO: More robust slicing for inline or mixed content based on fromM and toM.
            // For now, this part is a placeholder.
            console.warn("ReplaceStep.invert PoC: Inversion of non-block ranges is not accurately implemented.");
            // Fallback: if slice was empty, invert means inserting original content.
            // If slice had content, invert means deleting that new content.
            // This requires knowing what content was at from/to.
            // For PoC, if slice was empty, we cannot reconstruct what was deleted easily.
            // If slice was NOT empty, invert is a deletion from 'this.from' to 'this.from + this.slice.size'.
            // The content to insert for *that* deletion would be this.slice.content. This is confusing.
            // A true invert needs the original document content that was replaced.
            // This PoC is insufficient.
            return null;
        }

        const originalSlice = new Slice(originalDeletedContent, 0, 0); // openStart/End also PoC
        return new ReplaceStep(this.from, this.from + this.slice.size, originalSlice);
    }
}

console.log("transform/replaceStep.ts updated to attempt multi-block replacements (highly PoC).");
