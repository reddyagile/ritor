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

        if (this.from === 0 && this.to === doc.nodeSize) {
            let newContent = this.slice.content;
            if (doc.type.contentMatcher.length > 0 && doc.type.contentMatcher[0].name === "block" &&
                this.slice.content.some(n => n.type.spec.inline || n.isText)) {
                const defaultBlockType = schema.nodes.paragraph;
                if (!defaultBlockType) return {failed: "Cannot wrap inline slice content: paragraph node type not found in schema."};
                if (this.slice.content.every(n => n.type.spec.inline || n.isText)) {
                    newContent = [defaultBlockType.create(null, this.slice.content)];
                } else {
                    const processedSliceContent: BaseNode[] = [];
                    let currentInlineGroup: InlineNode[] = [];
                    for (const node of this.slice.content) {
                        if (node.type.spec.inline || node.isText) {
                            currentInlineGroup.push(node as InlineNode);
                        } else {
                            if (currentInlineGroup.length > 0) {
                                processedSliceContent.push(defaultBlockType.create(null, normalizeInlineArray(currentInlineGroup, schema)));
                                currentInlineGroup = [];
                            }
                            processedSliceContent.push(node);
                        }
                    }
                    if (currentInlineGroup.length > 0) {
                         processedSliceContent.push(defaultBlockType.create(null, normalizeInlineArray(currentInlineGroup, schema)));
                    }
                    newContent = processedSliceContent;
                }
            }
            const newWholeDoc = schema.node(doc.type, doc.attrs, newContent) as DocNode;
            const map = new StepMap([this.from, this.to, this.from, this.from + newWholeDoc.nodeSize]);
            return { doc: newWholeDoc, map };
        }

        const fromPos = flatOffsetToModelPosition(doc, this.from, schema);
        const toPos = flatOffsetToModelPosition(doc, this.to, schema);

        if (!fromPos || !toPos) {
            return { failed: "Invalid from/to position for ReplaceStep." };
        }

        const fromParentPath = fromPos.path.slice(0, -1);
        const toParentPath = toPos.path.slice(0, -1);

        if (fromPos.path.length > 0 && toPos.path.length > 0 && fromParentPath.join(',') === toParentPath.join(',')) {
            const parentBlockPath = fromParentPath;
            const parentBlockNode = nodeAtPath(doc, parentBlockPath) as BaseNode;

            if (parentBlockNode && parentBlockNode.content && !parentBlockNode.isLeaf && parentBlockNode.type.spec.content?.includes("inline")) {
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
                    } else if (endNode.isLeaf && toInlineCharOffset === 0 && fromInlineNodeIndex === toInlineNodeIndex && fromInlineCharOffset === 0 && this.slice.content.length === 0) {
                         // Deleting a zero-width range at start of a leaf that's also the end node: keep the leaf
                         newInlineContent.push(endNode);
                    } else if (toInlineCharOffset !== (endNode.isLeaf ? 1 : (endNode.content?.length || 0))) {
                        // console.warn("Offset in non-text end node may not be fully handled.");
                    }
                }

                for (let i = toInlineNodeIndex + 1; i < inlineContent.length; i++) newInlineContent.push(inlineContent[i]);

                const normalizedNewInlineContent = normalizeInlineArray(newInlineContent as InlineNode[], schema);
                const newParentBlock = schema.node(parentBlockNode.type, parentBlockNode.attrs, normalizedNewInlineContent, parentBlockNode.marks);

                let finalDoc: DocNode | null = null;
                if (parentBlockPath.length === 0) {
                    return {failed: "Logic error: inline replacement parent path is empty, implying inline content directly under doc."};
                } else {
                    const newRootBaseNode = replaceNodeAtPath(doc, parentBlockPath, 0, newParentBlock, schema);
                    if (newRootBaseNode && newRootBaseNode.type.name === doc.type.name) {
                        finalDoc = newRootBaseNode as DocNode;
                    } else if (newRootBaseNode === null) {
                        finalDoc = null;
                    } else {
                        return { failed: "Node replacement resulted in an unexpected root node type." };
                    }
                }
                if (!finalDoc) {
                    return { failed: "Failed to replace node in path for inline modification (replaceNodeAtPath returned null or wrong type)." };
                }
                const map = new StepMap([this.from, this.to, this.from, this.from + this.slice.size]);
                return { doc: finalDoc, map };
            }
        }

        let firstAffectedBlockIndex: number;
        let fromNodeIsBlockBoundary = false;

        if (fromPos.path.length === 0) {
            firstAffectedBlockIndex = fromPos.offset;
            fromNodeIsBlockBoundary = true;
        } else {
            firstAffectedBlockIndex = fromPos.path[0];
            if (fromPos.path.length === 1 && fromPos.offset === 0) fromNodeIsBlockBoundary = true;
            const fromBlock = doc.content?.[firstAffectedBlockIndex];
            if (fromBlock?.isText && fromPos.offset === 0) fromNodeIsBlockBoundary = true;
        }

        let lastAffectedBlockIndex: number;
        let toNodeIsBlockBoundary = false;

        if (toPos.path.length === 0) {
            lastAffectedBlockIndex = toPos.offset - 1;
            toNodeIsBlockBoundary = true;
        } else {
            lastAffectedBlockIndex = toPos.path[0];
            const toBlock = doc.content?.[lastAffectedBlockIndex];
            if (toPos.path.length === 1) { // Path points to block itself
                if (toBlock && (toPos.offset === (toBlock.content?.length || 0) && !toBlock.isText && !toBlock.isLeaf)) toNodeIsBlockBoundary = true;
                else if (toBlock && toBlock.isText && !toBlock.isLeaf && toPos.offset === getText(toBlock).length) toNodeIsBlockBoundary = true;
                else if (toBlock && toBlock.isLeaf && toPos.offset === 1) toNodeIsBlockBoundary = true; // After leaf
            }
        }

        const finalDocContent: BaseNode[] = [];
        const currentDocContent = doc.content || [];

        for (let i = 0; i < firstAffectedBlockIndex; i++) {
            finalDocContent.push(currentDocContent[i]);
        }

        const firstBlockActualNode = currentDocContent[firstAffectedBlockIndex];
        if (firstBlockActualNode && !fromNodeIsBlockBoundary && firstAffectedBlockIndex <= lastAffectedBlockIndex) {
            if (fromPos.path.length > 1 && firstBlockActualNode.type.spec.content?.includes("inline")) {
                const inlineContent = firstBlockActualNode.content || [];
                const targetInlineNodeIndex = fromPos.path[fromPos.path.length - 1];
                const charOffsetInInlineNode = fromPos.offset;
                const retainedInlineContent: BaseNode[] = [];
                for (let i = 0; i < targetInlineNodeIndex; i++) retainedInlineContent.push(inlineContent[i]);

                const targetInlineNode = inlineContent[targetInlineNodeIndex] as TextNode;
                if (targetInlineNode && targetInlineNode.isText && !targetInlineNode.isLeaf && charOffsetInInlineNode > 0) {
                    retainedInlineContent.push(schema.text(getText(targetInlineNode).slice(0, charOffsetInInlineNode), targetInlineNode.marks));
                }
                if (retainedInlineContent.length > 0) {
                    const normalized = normalizeInlineArray(retainedInlineContent as InlineNode[], schema);
                    if (normalized.length > 0) {
                         finalDocContent.push(schema.node(firstBlockActualNode.type, firstBlockActualNode.attrs, normalized));
                    }
                }
            } else if (fromPos.path.length === 1 && firstBlockActualNode.isText && !firstBlockActualNode.isLeaf && fromPos.offset > 0) {
                 const textToSlice = getText(firstBlockActualNode);
                 if (fromPos.offset < textToSlice.length) { // Should always be true if !fromNodeIsBlockBoundary
                    finalDocContent.push(schema.text(textToSlice.slice(0, fromPos.offset), firstBlockActualNode.marks));
                 } else { // fromPos.offset === textToSlice.length, meaning from is at end of this text block
                    finalDocContent.push(firstBlockActualNode); // keep whole block
                 }
            }
        }

        let currentBlockContentForSlice: InlineNode[] = [];
        for (const sliceNode of this.slice.content) {
            if (sliceNode.type.spec.inline || sliceNode.isText) {
                currentBlockContentForSlice.push(sliceNode as InlineNode);
            } else {
                if (currentBlockContentForSlice.length > 0) {
                    const defaultBlock = schema.nodes.paragraph;
                    if (!defaultBlock) return {failed: "Paragraph node type not found in schema to wrap inline slice content."};
                    finalDocContent.push(defaultBlock.create(null, normalizeInlineArray(currentBlockContentForSlice, schema)));
                    currentBlockContentForSlice = [];
                }
                finalDocContent.push(sliceNode);
            }
        }
        if (currentBlockContentForSlice.length > 0) {
            const defaultBlock = schema.nodes.paragraph;
            if (!defaultBlock) return {failed: "Paragraph node type not found in schema to wrap final inline slice content."};
            finalDocContent.push(defaultBlock.create(null, normalizeInlineArray(currentBlockContentForSlice, schema)));
        }

        const lastBlockActualNode = currentDocContent[lastAffectedBlockIndex];
        if (lastBlockActualNode && !toNodeIsBlockBoundary && firstAffectedBlockIndex <= lastAffectedBlockIndex) {
            if (firstAffectedBlockIndex < lastAffectedBlockIndex || fromNodeIsBlockBoundary) { // Only add trailing if different block or start was fully taken
                if (toPos.path.length > 1 && lastBlockActualNode.type.spec.content?.includes("inline")) {
                    const inlineContent = lastBlockActualNode.content || [];
                    const targetInlineNodeIndex = toPos.path[toPos.path.length - 1];
                    const charOffsetInInlineNode = toPos.offset;
                    const retainedTrailingInlineContent: BaseNode[] = [];

                    const targetInlineNode = inlineContent[targetInlineNodeIndex] as TextNode;
                    if (targetInlineNode && targetInlineNode.isText && !targetInlineNode.isLeaf && charOffsetInInlineNode < getText(targetInlineNode).length) {
                        retainedTrailingInlineContent.push(schema.text(getText(targetInlineNode).slice(charOffsetInInlineNode), targetInlineNode.marks));
                    }
                    for (let i = targetInlineNodeIndex + 1; i < inlineContent.length; i++) {
                        retainedTrailingInlineContent.push(inlineContent[i]);
                    }
                    if (retainedTrailingInlineContent.length > 0) {
                         const normalized = normalizeInlineArray(retainedTrailingInlineContent as InlineNode[], schema);
                         if (normalized.length > 0) {
                            finalDocContent.push(schema.node(lastBlockActualNode.type, lastBlockActualNode.attrs, normalized));
                         }
                    }
                } else if (toPos.path.length === 1 && lastBlockActualNode.isText && !lastBlockActualNode.isLeaf) {
                    const textToSlice = getText(lastBlockActualNode);
                    if (toPos.offset < textToSlice.length) {
                         finalDocContent.push(schema.text(textToSlice.slice(toPos.offset), lastBlockActualNode.marks));
                    }
                }
            }
        }

        for (let i = lastAffectedBlockIndex + 1; i < currentDocContent.length; i++) {
            finalDocContent.push(currentDocContent[i]);
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
        // ... (invert logic remains unchanged from previous version for this subtask) ...
        const schema = doc.type.schema;
        let originalDeletedContent: BaseNode[] = [];
        const fromM = flatOffsetToModelPosition(doc, this.from, schema);
        const toM = flatOffsetToModelPosition(doc, this.to, schema);

        if(fromM.path.length === 0 && toM.path.length === 0) {
            originalDeletedContent = (doc.content || []).slice(fromM.offset, toM.offset);
        } else {
            console.warn("ReplaceStep.invert PoC: Inversion of non-block ranges or partial blocks is not accurately implemented.");
            if (fromM.path.length > 0 && fromM.path[0] < (doc.content?.length || 0)) {
                const firstBlock = doc.content?.[fromM.path[0]];
                if (firstBlock) originalDeletedContent.push(firstBlock);
            }
        }

        const originalSlice = new Slice(originalDeletedContent, 0, 0);
        return new ReplaceStep(this.from, this.from + this.slice.size, originalSlice);
    }
}

console.log("transform/replaceStep.ts updated with more detailed partial end block handling.");
