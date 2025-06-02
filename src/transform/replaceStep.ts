// src/transform/replaceStep.ts

import { DocNode, BaseNode, TextNode, InlineNode } from '../documentModel.js';
import { Step, StepResult } from './step.js';
import { StepMap } from './stepMap.js';
import { Slice } from './slice.js';
import { modelPositionToFlatOffset, flatOffsetToModelPosition, normalizeInlineArray, nodeAtPath, replaceNodeAtPath, sliceDocByFlatOffsets, getText } from '../modelUtils.js';
import { Schema } from '../schema.js';

function getContent(node: BaseNode | null | undefined): ReadonlyArray<BaseNode> { return node?.content || []; }

export class ReplaceStep implements Step {
    constructor(
        public readonly from: number,
        public readonly to: number,
        public readonly slice: Slice
    ) {
        if (from > to) throw new Error("ReplaceStep: 'from' must be less than or equal to 'to'");
    }

    apply(doc: DocNode): StepResult {
        const schema = doc.type.schema;
        const DEBUG_REPLACESTEP = (globalThis as any).DEBUG_REPLACESTEP || false; // Set this to true in tests for logging

        if (DEBUG_REPLACESTEP) {
            console.log(`[ReplaceStep] APPLY START: from=${this.from}, to=${this.to}, sliceSize=${this.slice.size}`);
            // console.log("[ReplaceStep] Initial Doc:", JSON.stringify(doc, null, 2));
            // console.log("[ReplaceStep] Slice Content:", JSON.stringify(this.slice.content, null, 2));
        }

        if (this.from === 0 && this.to === doc.nodeSize) {
            // ... (full doc replacement logic - unchanged, assume ok for now) ...
            let newContent = this.slice.content;
            if (doc.type.contentMatcher.length > 0 && doc.type.contentMatcher[0].name === "block" &&
                this.slice.content.some(n => n.type.spec.inline || n.isText)) {
                const defaultBlockType = schema.nodes.paragraph;
                if (!defaultBlockType) return {failed: "Cannot wrap inline slice content: paragraph node type not found in schema."};
                if (this.slice.content.every(n => n.type.spec.inline || n.isText)) {
                    const normalizedInline = normalizeInlineArray(this.slice.content as InlineNode[], schema);
                    newContent = [defaultBlockType.create(null, normalizedInline)];
                } else {
                    const processedSliceContent: BaseNode[] = []; let currentInlineGroup: InlineNode[] = [];
                    for (const node of this.slice.content) {
                        if (node.type.spec.inline || node.isText) { currentInlineGroup.push(node as InlineNode); }
                        else { if (currentInlineGroup.length > 0) { processedSliceContent.push(defaultBlockType.create(null, normalizeInlineArray(currentInlineGroup, schema))); currentInlineGroup = []; } processedSliceContent.push(node); }
                    }
                    if (currentInlineGroup.length > 0) { processedSliceContent.push(defaultBlockType.create(null, normalizeInlineArray(currentInlineGroup, schema)));}
                    newContent = processedSliceContent;
                }
            }
            const newWholeDoc = schema.node(doc.type, doc.attrs, newContent) as DocNode;
            const map = new StepMap([this.from, this.to, this.from, this.from + newWholeDoc.nodeSize]);
            if (DEBUG_REPLACESTEP) console.log("[ReplaceStep] Full doc replacement. New doc nodeSize:", newWholeDoc.nodeSize);
            return { doc: newWholeDoc, map };
        }

        const fromPos = flatOffsetToModelPosition(doc, this.from, schema);
        const toPos = flatOffsetToModelPosition(doc, this.to, schema);

        if (DEBUG_REPLACESTEP) {
            console.log(`[ReplaceStep] Resolved fromPos: ${JSON.stringify(fromPos)}, toPos: ${JSON.stringify(toPos)}`);
        }

        if (!fromPos || !toPos) return { failed: "Invalid from/to position for ReplaceStep." };

        const fromParentPath = fromPos.path.slice(0, -1);
        const toParentPath = toPos.path.slice(0, -1);

        if (fromPos.path.length > 0 && toPos.path.length > 0 && fromParentPath.join(',') === toParentPath.join(',')) {
            // ... (single-block inline replacement logic - assume ok for now, unchanged) ...
            const parentBlockPath = fromParentPath; const parentBlockNode = nodeAtPath(doc, parentBlockPath) as BaseNode;
            if (parentBlockNode?.content && !parentBlockNode.isLeaf && parentBlockNode.type.spec.content?.includes("inline")) {
                const inlineContent = parentBlockNode.content as ReadonlyArray<BaseNode>; const fromIdx = fromPos.path[fromPos.path.length - 1]; const fromOff = fromPos.offset; const toIdx = toPos.path[toPos.path.length - 1]; const toOff = toPos.offset; const newInline: BaseNode[] = [];
                for (let i = 0; i < fromIdx; i++) newInline.push(inlineContent[i]);
                const startN = inlineContent[fromIdx]; if (startN) { if (startN.isText && !startN.isLeaf) { if (fromOff > 0) newInline.push(schema.text(getText(startN).slice(0, fromOff), startN.marks)); } else if (fromOff !== 0) return {failed: "PoC: Offset in non-text start."}; }
                newInline.push(...this.slice.content);
                const endN = inlineContent[toIdx]; if (endN) { if (endN.isText && !endN.isLeaf) { if (toOff < getText(endN).length) newInline.push(schema.text(getText(endN).slice(toOff), endN.marks)); } else if (endN.isLeaf && toOff === 0 && fromIdx === toIdx && fromOff === 0 && this.slice.content.length === 0) { newInline.push(endN); } else if (toOff !== (endN.isLeaf ? 1 : (endN.content?.length || 0))) { /* console.warn("Offset in non-text end may not be handled."); */ }}
                for (let i = toIdx + 1; i < inlineContent.length; i++) newInline.push(inlineContent[i]);
                const normNewInline = normalizeInlineArray(newInline as InlineNode[], schema); const newParentB = schema.node(parentBlockNode.type, parentBlockNode.attrs, normNewInline, parentBlockNode.marks);
                let finalDoc: DocNode | null = null; if (parentBlockPath.length === 0) { return {failed: "Logic error: inline replacement parent path empty."}; } else { const newRoot = replaceNodeAtPath(doc, parentBlockPath, newParentB, schema); if (newRoot?.type.name === doc.type.name) finalDoc = newRoot as DocNode; else if (newRoot === null) finalDoc = null; else return { failed: "Node replacement resulted in unexpected root." }; }
                if (!finalDoc) return { failed: "Failed inline modification." };
                if (DEBUG_REPLACESTEP) console.log("[ReplaceStep] Applied as single-block inline replacement.");
                return { doc: finalDoc, map: new StepMap([this.from, this.to, this.from, this.from + this.slice.size]) };
            }
        }

        if (DEBUG_REPLACESTEP) console.log("[ReplaceStep] Applying as multi-block replacement.");

        let firstAffectedBlockIndex: number; let fromNodeIsBlockBoundary = false;
        if (fromPos.path.length === 0) { firstAffectedBlockIndex = fromPos.offset; fromNodeIsBlockBoundary = true; }
        else { firstAffectedBlockIndex = fromPos.path[0]; const fB = doc.content?.[firstAffectedBlockIndex]; if (fromPos.path.length === 1 && fromPos.offset === 0) fromNodeIsBlockBoundary = true; if (fB?.isText && fromPos.offset === 0) fromNodeIsBlockBoundary = true; }

        let lastAffectedBlockIndex: number; let toNodeIsBlockBoundary = false;
        if (toPos.path.length === 0) { lastAffectedBlockIndex = toPos.offset - 1; toNodeIsBlockBoundary = true; }
        else { lastAffectedBlockIndex = toPos.path[0]; const tB = doc.content?.[lastAffectedBlockIndex]; if (toPos.path.length === 1) { if (tB && (toPos.offset === (tB.content?.length || 0) && !tB.isText && !tB.isLeaf)) toNodeIsBlockBoundary = true; else if (tB?.isText && !tB.isLeaf && toPos.offset === getText(tB).length) toNodeIsBlockBoundary = true; else if (tB?.isLeaf && toPos.offset === 1) toNodeIsBlockBoundary = true; }}

        if (DEBUG_REPLACESTEP) {
            console.log(`[ReplaceStep] Calculated Block Indices: firstAffected=${firstAffectedBlockIndex} (boundary=${fromNodeIsBlockBoundary}), lastAffected=${lastAffectedBlockIndex} (boundary=${toNodeIsBlockBoundary})`);
        }

        const finalDocContent: BaseNode[] = [];
        const currentDocContent = doc.content || [];

        // 1. Add blocks before the first affected block
        for (let i = 0; i < firstAffectedBlockIndex; i++) {
            finalDocContent.push(currentDocContent[i]);
            if (DEBUG_REPLACESTEP) console.log(`[ReplaceStep] Part 1: Kept block ${i} as is: ${currentDocContent[i].type.name}`);
        }

        // 2. Handle the first affected block (if partially kept from its start)
        const firstBlockActualNode = currentDocContent[firstAffectedBlockIndex];
        if (DEBUG_REPLACESTEP && firstBlockActualNode) console.log(`[ReplaceStep] Part 2: firstAffectedBlockNode is ${firstBlockActualNode.type.name}, fromNodeIsBlockBoundary=${fromNodeIsBlockBoundary}`);

        if (firstBlockActualNode && !fromNodeIsBlockBoundary && firstAffectedBlockIndex <= lastAffectedBlockIndex) {
            if (DEBUG_REPLACESTEP) console.log(`[ReplaceStep] Part 2: Handling partial start block. fromPos.path.length=${fromPos.path.length}, nodeType=${firstBlockActualNode.type.name}`);
            if (fromPos.path.length > 1 && firstBlockActualNode.type.spec.content?.includes("inline")) {
                const inlineContent = firstBlockActualNode.content || []; const targetIdx = fromPos.path[fromPos.path.length - 1]; const charOff = fromPos.offset; const retained: BaseNode[] = [];
                for (let i = 0; i < targetIdx; i++) retained.push(inlineContent[i]);
                const targetInline = inlineContent[targetIdx] as TextNode;
                if (targetInline?.isText && !targetInline.isLeaf && charOff > 0) { retained.push(schema.text(getText(targetInline).slice(0, charOff), targetInline.marks)); }
                if (retained.length > 0) { const norm = normalizeInlineArray(retained as InlineNode[], schema); if (norm.length > 0) { finalDocContent.push(schema.node(firstBlockActualNode.type, firstBlockActualNode.attrs, norm)); if (DEBUG_REPLACESTEP) console.log(`[ReplaceStep] Part 2: Kept partial start block (inline content cut). New node: ${finalDocContent[finalDocContent.length-1].type.name} with ${norm.length} children.`); }}
            } else if (fromPos.path.length === 1 && firstBlockActualNode.isText && !firstBlockActualNode.isLeaf && fromPos.offset > 0) {
                 const textToSlice = getText(firstBlockActualNode); if (fromPos.offset < textToSlice.length) { finalDocContent.push(schema.text(textToSlice.slice(0, fromPos.offset), firstBlockActualNode.marks)); if (DEBUG_REPLACESTEP) console.log(`[ReplaceStep] Part 2: Kept partial start block (text block cut).`); }
                 else { finalDocContent.push(firstBlockActualNode); if (DEBUG_REPLACESTEP) console.log(`[ReplaceStep] Part 2: fromPos.offset at end of text block, kept whole block.`);}
            } else { if (DEBUG_REPLACESTEP) console.log(`[ReplaceStep] Part 2: Not a recognized partial start case, or fromNodeIsBlockBoundary was false but condition not met.`);}
        } else if (DEBUG_REPLACESTEP && fromNodeIsBlockBoundary) { console.log(`[ReplaceStep] Part 2: Start block is fully replaced or deleted (fromNodeIsBlockBoundary=true).`); }


        // 3. Add content from the slice
        if (DEBUG_REPLACESTEP && this.slice.content.length > 0) console.log(`[ReplaceStep] Part 3: Adding ${this.slice.content.length} nodes from slice.`);
        let currentBlockContentForSlice: InlineNode[] = [];
        for (const sliceNode of this.slice.content) {
            if (sliceNode.type.spec.inline || sliceNode.isText) { currentBlockContentForSlice.push(sliceNode as InlineNode); }
            else { if (currentBlockContentForSlice.length > 0) { const defBlock = schema.nodes.paragraph; if (!defBlock) return {failed:"Para not in schema"}; finalDocContent.push(defBlock.create(null, normalizeInlineArray(currentBlockContentForSlice, schema))); currentBlockContentForSlice = []; } finalDocContent.push(sliceNode); }
        }
        if (currentBlockContentForSlice.length > 0) { const defBlock = schema.nodes.paragraph; if (!defBlock) return {failed:"Para not in schema"}; finalDocContent.push(defBlock.create(null, normalizeInlineArray(currentBlockContentForSlice, schema))); }

        // 4. Handle the last affected block (if partially kept from its end)
        const lastBlockActualNode = currentDocContent[lastAffectedBlockIndex];
        if (DEBUG_REPLACESTEP && lastBlockActualNode) console.log(`[ReplaceStep] Part 4: lastAffectedBlockNode is ${lastBlockActualNode.type.name}, toNodeIsBlockBoundary=${toNodeIsBlockBoundary}`);

        if (lastBlockActualNode && !toNodeIsBlockBoundary && firstAffectedBlockIndex <= lastAffectedBlockIndex) {
            if (DEBUG_REPLACESTEP) console.log(`[ReplaceStep] Part 4: Handling partial end block. toPos.path.length=${toPos.path.length}, nodeType=${lastBlockActualNode.type.name}`);
            if (firstAffectedBlockIndex < lastAffectedBlockIndex || fromNodeIsBlockBoundary) {
                if (toPos.path.length > 1 && lastBlockActualNode.type.spec.content?.includes("inline")) {
                    const inlineContent = lastBlockActualNode.content || []; const targetIdx = toPos.path[toPos.path.length-1]; const charOff = toPos.offset; const retainedTrail: BaseNode[] = [];
                    const targetInline = inlineContent[targetIdx] as TextNode;
                    if (targetInline?.isText && !targetInline.isLeaf && charOff < getText(targetInline).length) { retainedTrail.push(schema.text(getText(targetInline).slice(charOff), targetInline.marks)); }
                    for (let i = targetIdx + 1; i < inlineContent.length; i++) retainedTrail.push(inlineContent[i]);
                    if (retainedTrail.length > 0) { const norm = normalizeInlineArray(retainedTrail as InlineNode[], schema); if (norm.length > 0) { finalDocContent.push(schema.node(lastBlockActualNode.type, lastBlockActualNode.attrs, norm)); if (DEBUG_REPLACESTEP) console.log(`[ReplaceStep] Part 4: Kept partial end block (inline content cut). New node: ${finalDocContent[finalDocContent.length-1].type.name} with ${norm.length} children.`); }}
                } else if (toPos.path.length === 1 && lastBlockActualNode.isText && !lastBlockActualNode.isLeaf) {
                    const textToSlice = getText(lastBlockActualNode); if (toPos.offset < textToSlice.length) { finalDocContent.push(schema.text(textToSlice.slice(toPos.offset), lastBlockActualNode.marks)); if (DEBUG_REPLACESTEP) console.log(`[ReplaceStep] Part 4: Kept partial end block (text block cut).`); }
                } else { if (DEBUG_REPLACESTEP) console.log(`[ReplaceStep] Part 4: Not a recognized partial end case.`);}
            } else if (DEBUG_REPLACESTEP) { console.log(`[ReplaceStep] Part 4: Skipped partial end block because it's same as partial start block (fromIndex=${firstAffectedBlockIndex}, toIndex=${lastAffectedBlockIndex}, fromBoundary=${fromNodeIsBlockBoundary}).`); }
        } else if (DEBUG_REPLACESTEP && toNodeIsBlockBoundary) { console.log(`[ReplaceStep] Part 4: End block is fully replaced or deleted (toNodeIsBlockBoundary=true).`); }

        // 5. Add blocks after the last affected block
        if (DEBUG_REPLACESTEP) console.log(`[ReplaceStep] Part 5: Adding blocks from index ${lastAffectedBlockIndex + 1}. Original content length: ${currentDocContent.length}`);
        for (let i = lastAffectedBlockIndex + 1; i < currentDocContent.length; i++) {
            const blockToAdd = currentDocContent[i];
            finalDocContent.push(blockToAdd);
            if (DEBUG_REPLACESTEP) console.log(`[ReplaceStep] Part 5: Kept block ${i} as is: ${blockToAdd.type.name} (text: ${getText(blockToAdd.content?.[0])})`);
        }

        if (DEBUG_REPLACESTEP) {
            console.log("[ReplaceStep] Final assembled docContent before creating new DocNode:");
            finalDocContent.forEach((n, idx) => console.log(`  [${idx}] ${n.type.name}: ${n.isText ? `"${getText(n)}"` : (n.content?.map(c=>(c as TextNode).text).join("|") || "no_inline_text")}`));
        }

        const newDoc = schema.node(doc.type, doc.attrs, finalDocContent) as DocNode;
        const map = new StepMap([this.from, this.to, this.from, this.from + this.slice.size]);
        if (DEBUG_REPLACESTEP) console.log(`[ReplaceStep] APPLY END: New doc nodeSize=${newDoc.nodeSize}. StepMap created.`); // Simplified log
        return { doc: newDoc, map };
    }

    getMap(): StepMap { return new StepMap([this.from, this.to, this.from, this.from + this.slice.size]); }
    invert(doc: DocNode): Step | null {
        const schema = doc.type.schema; const originalSlice = sliceDocByFlatOffsets(doc, this.from, this.to, schema);
        if (originalSlice === Slice.empty && (this.from !== this.to)) { console.warn(`ReplaceStep.invert: sliceDocByFlatOffsets returned empty for range [${this.from},${this.to}].`); }
        return new ReplaceStep(this.from, this.from + this.slice.size, originalSlice);
    }
}

console.log("transform/replaceStep.ts updated with extensive logging for multi-block debug.");
