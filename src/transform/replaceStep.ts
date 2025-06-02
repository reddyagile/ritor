// src/transform/replaceStep.ts

import { DocNode, BaseNode, TextNode, InlineNode } from '../documentModel.js';
import { Step, StepResult } from './step.js';
import { StepMap } from './stepMap.js';
import { Slice } from './slice.js';
import { modelPositionToFlatOffset, flatOffsetToModelPosition, normalizeInlineArray, nodeAtPath, replaceNodeAtPath, sliceDocByFlatOffsets, getText, marksEq } from '../modelUtils.js'; 
import { Schema } from '../schema.js';

const DEBUG_REPLACESTEP = (globalThis as any).DEBUG_REPLACESTEP || false;
// const DEBUG_REPLACESTEP = (globalThis as any).DEBUG_REPLACESTEP_FORCE_TRUE || false; // Use a distinct flag for forced debug

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
        
        // const currentDebugFlag = DEBUG_REPLACESTEP || (globalThis as any).DEBUG_REPLACESTEP;
        // Forcing off for this cleanup, test file will control it.
        const currentDebugFlag = (globalThis as any).DEBUG_REPLACESTEP || false;


        if (currentDebugFlag) {
            console.log(`[ReplaceStep] APPLY START: from=${this.from}, to=${this.to}, sliceSize=${this.slice.size}`);
        }

        if (this.from === 0 && this.to === doc.nodeSize) { 
            if (currentDebugFlag) console.log("[ReplaceStep-FULLDOC] Applying full document replacement.");
            if (currentDebugFlag) console.log("[ReplaceStep-FULLDOC] Initial slice.content:", JSON.stringify(this.slice.content.map(n => ({type: n.type.name, text: (n as any).text}))));
            
            let newContent = this.slice.content;
            const docContentMatcher = doc.type.contentMatcher; 
            
            let calculatedDocExpectsBlocks = false;
            if (docContentMatcher && docContentMatcher.length > 0) {
                const firstMatcher = docContentMatcher[0];
                if (firstMatcher.type === "group" && firstMatcher.value === "block") {
                    calculatedDocExpectsBlocks = true;
                } else if (firstMatcher.isChoice && firstMatcher.options) {
                    calculatedDocExpectsBlocks = firstMatcher.options.every(opt => 
                        opt === 'block' || 
                        (schema.nodes[opt]?.isBlock) ||
                        (schema.groups.get(opt)?.every(nodeType => nodeType.isBlock))
                    );
                }
            }

            const sliceHasInline = this.slice.content.some(n => n.type.spec.inline || n.isText);
            if (currentDebugFlag) console.log(`[ReplaceStep-FULLDOC] Doc expects blocks: ${calculatedDocExpectsBlocks}, Slice has inline: ${sliceHasInline}`);

            if (calculatedDocExpectsBlocks && sliceHasInline) {
                const defaultBlockType = schema.nodes.paragraph;
                if (!defaultBlockType) { if (currentDebugFlag) console.log("[ReplaceStep-FULLDOC] No paragraph type for wrapping."); return {failed: "Cannot wrap inline slice content: paragraph node type not found in schema."}; }
                
                const sliceIsAllInline = this.slice.content.every(n => n.type.spec.inline || n.isText);
                if (currentDebugFlag) console.log(`[ReplaceStep-FULLDOC] Slice is all inline: ${sliceIsAllInline}`);

                if (sliceIsAllInline) {
                    const normalizedInline = normalizeInlineArray(this.slice.content as InlineNode[], schema);
                    if (currentDebugFlag) console.log("[ReplaceStep-FULLDOC] Normalized inline for wrapping:", JSON.stringify(normalizedInline.map(n => ({type: n.type.name, text: (n as any).text}))));
                    newContent = [defaultBlockType.create(null, normalizedInline)];
                    if (currentDebugFlag) console.log("[ReplaceStep-FULLDOC] newContent after wrapping all-inline slice:", JSON.stringify(newContent.map(n => ({type: n.type.name, content: (n.content ||[]).map(c=>(c as any).text) }))));
                } else { 
                    if (currentDebugFlag) console.log("[ReplaceStep-FULLDOC] Slice has mixed block/inline content, processing for wrapping.");
                    const processedSliceContent: BaseNode[] = []; let currentInlineGroup: InlineNode[] = [];
                    for (const node of this.slice.content) {
                        if (node.type.spec.inline || node.isText) { currentInlineGroup.push(node as InlineNode); }
                        else { if (currentInlineGroup.length > 0) { processedSliceContent.push(defaultBlockType.create(null, normalizeInlineArray(currentInlineGroup, schema))); currentInlineGroup = []; } processedSliceContent.push(node); }
                    }
                    if (currentInlineGroup.length > 0) { processedSliceContent.push(defaultBlockType.create(null, normalizeInlineArray(currentInlineGroup, schema)));}
                    newContent = processedSliceContent;
                    if (currentDebugFlag) console.log("[ReplaceStep-FULLDOC] newContent after wrapping mixed slice:", JSON.stringify(newContent.map(n => ({type: n.type.name }))));
                }
            }
            const newWholeDoc = schema.node(doc.type, doc.attrs, newContent) as DocNode;
            const map = new StepMap([this.from, this.to, this.from, this.from + newWholeDoc.nodeSize]); 
            if (currentDebugFlag) console.log(`[ReplaceStep] Full doc replacement. New doc nodeSize: ${newWholeDoc.nodeSize}. StepMap created.`);
            return { doc: newWholeDoc, map };
        }

        const fromPos = flatOffsetToModelPosition(doc, this.from, schema);
        const toPos = flatOffsetToModelPosition(doc, this.to, schema);

        if (currentDebugFlag) { console.log(`[ReplaceStep] Resolved fromPos: ${JSON.stringify(fromPos)}, toPos: ${JSON.stringify(toPos)}`); }
        if (!fromPos || !toPos) return { failed: "Invalid from/to position for ReplaceStep." };

        const fromParentPath = fromPos.path.slice(0, -1);
        const toParentPath = toPos.path.slice(0, -1);

        if (fromPos.path.length > 0 && toPos.path.length > 0 && fromParentPath.join(',') === toParentPath.join(',')) {
            // ... (single-block inline replacement logic as before) ...
            const parentBlockPath = fromParentPath; const parentBlockNode = nodeAtPath(doc, parentBlockPath) as BaseNode;
            if (parentBlockNode?.content && !parentBlockNode.isLeaf && parentBlockNode.type.spec.content?.includes("inline")) {
                const originalInlineContent = parentBlockNode.content as ReadonlyArray<BaseNode>; const fromInlineNodeIndex = fromPos.path[fromPos.path.length - 1]; const fromInlineCharOffset = fromPos.offset; const toInlineNodeIndex = toPos.path[toPos.path.length - 1]; const toInlineCharOffset = toPos.offset; const newInlineContent: BaseNode[] = []; let sliceNodes = this.slice.content as ReadonlyArray<BaseNode>;
                for (let i = 0; i < fromInlineNodeIndex; i++) newInlineContent.push(originalInlineContent[i]);
                const firstOriginalNode = originalInlineContent[fromInlineNodeIndex]; let textBeforeSlice = ""; let marksBeforeSlice = firstOriginalNode?.marks || [];
                if (firstOriginalNode) { if (firstOriginalNode.isText && !firstOriginalNode.isLeaf) { marksBeforeSlice = firstOriginalNode.marks || []; if (fromInlineCharOffset > 0) textBeforeSlice = getText(firstOriginalNode).slice(0, fromInlineCharOffset); } else if (fromInlineCharOffset !== 0) return { failed: "PoC: Offset in non-text start node for inline replacement." }; }
                if (this.slice.openStart > 0 && sliceNodes.length > 0) { const firstSliceNode = sliceNodes[0]; if (textBeforeSlice.length > 0 && firstSliceNode.isText && !firstSliceNode.isLeaf && marksEq(marksBeforeSlice, firstSliceNode.marks || [])) { const mergedStartText = textBeforeSlice + getText(firstSliceNode); newInlineContent.push(schema.text(mergedStartText, firstSliceNode.marks || [])); sliceNodes = sliceNodes.slice(1); } else { if (textBeforeSlice.length > 0) newInlineContent.push(schema.text(textBeforeSlice, marksBeforeSlice));}} else { if (textBeforeSlice.length > 0) newInlineContent.push(schema.text(textBeforeSlice, marksBeforeSlice));}
                newInlineContent.push(...sliceNodes);
                const lastOriginalNode = originalInlineContent[toInlineNodeIndex]; let textAfterSlice = ""; let marksAfterSlice = lastOriginalNode?.marks || [];
                if (lastOriginalNode) { if (lastOriginalNode.isText && !lastOriginalNode.isLeaf) { marksAfterSlice = lastOriginalNode.marks || []; if (toInlineCharOffset < getText(lastOriginalNode).length) textAfterSlice = getText(lastOriginalNode).slice(toInlineCharOffset); } else if (lastOriginalNode.isLeaf && toInlineCharOffset === 0 && fromInlineNodeIndex === toInlineNodeIndex && fromInlineCharOffset === 0 && this.slice.content.length === 0) { newInlineContent.push(lastOriginalNode); } else if (toInlineCharOffset !== (lastOriginalNode.isLeaf ? 1 : (lastOriginalNode.content?.length || 0))) { /* console.warn("Offset in non-text end node may not be fully handled."); */ }}
                if (this.slice.openEnd > 0 && newInlineContent.length > 0 && textAfterSlice.length > 0) { const lastPushedNodeIndex = newInlineContent.length -1; const lastPushedNode = newInlineContent[lastPushedNodeIndex]; if (lastPushedNode.isText && !lastPushedNode.isLeaf && marksEq(lastPushedNode.marks || [], marksAfterSlice)) { const mergedEndText = getText(lastPushedNode) + textAfterSlice; newInlineContent[lastPushedNodeIndex] = schema.text(mergedEndText, lastPushedNode.marks || []); } else { if (textAfterSlice.length > 0) newInlineContent.push(schema.text(textAfterSlice, marksAfterSlice));}} else { if (textAfterSlice.length > 0) newInlineContent.push(schema.text(textAfterSlice, marksAfterSlice));}
                for (let i = toInlineNodeIndex + 1; i < originalInlineContent.length; i++) newInlineContent.push(originalInlineContent[i]);
                const normalizedNewInlineContent = normalizeInlineArray(newInlineContent as InlineNode[], schema); const newParentBlock = schema.node(parentBlockNode.type, parentBlockNode.attrs, normalizedNewInlineContent, parentBlockNode.marks);
                let finalDoc: DocNode | null = null; if (parentBlockPath.length === 0) return {failed: "Logic error: inline replacement parent path empty."}; const newRootBaseNode = replaceNodeAtPath(doc, parentBlockPath, newParentBlock, schema); if (newRootBaseNode?.type.name === doc.type.name) finalDoc = newRootBaseNode as DocNode; else if (newRootBaseNode === null) finalDoc = null; else return { failed: "Node replacement resulted in unexpected root." }; 
                if (!finalDoc) return { failed: "Failed inline modification." };
                if (currentDebugFlag) console.log("[ReplaceStep] Applied as single-block inline replacement.");
                return { doc: finalDoc, map: new StepMap([this.from, this.to, this.from, this.from + this.slice.size]) };
            }
        }
        
        if (currentDebugFlag) console.log("[ReplaceStep] Applying as multi-block replacement.");
        // ... (rest of multi-block logic as before) ...
        let firstAffectedBlockIndex: number; let fromNodeIsBlockBoundary = false; 
        if (fromPos.path.length === 0) { firstAffectedBlockIndex = fromPos.offset; fromNodeIsBlockBoundary = true; }
        else { firstAffectedBlockIndex = fromPos.path[0]; const fB = doc.content?.[firstAffectedBlockIndex]; if (fromPos.path.length === 1 && fromPos.offset === 0) fromNodeIsBlockBoundary = true; if (fB?.isText && fromPos.offset === 0) fromNodeIsBlockBoundary = true; }
        let lastAffectedBlockIndex: number; let toNodeIsBlockBoundary = false; 
        if (toPos.path.length === 0) { lastAffectedBlockIndex = toPos.offset - 1; toNodeIsBlockBoundary = true; }
        else { lastAffectedBlockIndex = toPos.path[0]; const tB = doc.content?.[lastAffectedBlockIndex]; if (toPos.path.length === 1) { if (tB && (toPos.offset === (tB.content?.length || 0) && !tB.isText && !tB.isLeaf)) toNodeIsBlockBoundary = true; else if (tB?.isText && !tB.isLeaf && toPos.offset === getText(tB).length) toNodeIsBlockBoundary = true; else if (tB?.isLeaf && toPos.offset === 1) toNodeIsBlockBoundary = true; }}
        if (currentDebugFlag) { console.log(`[ReplaceStep] Calculated Block Indices: firstAffected=${firstAffectedBlockIndex} (boundary=${fromNodeIsBlockBoundary}), lastAffected=${lastAffectedBlockIndex} (boundary=${toNodeIsBlockBoundary})`); }
        const finalDocContent: BaseNode[] = []; const currentDocContent = doc.content || [];
        for (let i = 0; i < firstAffectedBlockIndex; i++) { finalDocContent.push(currentDocContent[i]); if (currentDebugFlag) console.log(`[ReplaceStep] Part 1: Kept block ${i} as is: ${currentDocContent[i].type.name}`); }
        const firstBlockActualNode = currentDocContent[firstAffectedBlockIndex]; if (currentDebugFlag && firstBlockActualNode) console.log(`[ReplaceStep] Part 2: firstAffectedBlockNode is ${firstBlockActualNode.type.name}, fromNodeIsBlockBoundary=${fromNodeIsBlockBoundary}`);
        if (firstBlockActualNode && !fromNodeIsBlockBoundary && firstAffectedBlockIndex <= lastAffectedBlockIndex) { if (currentDebugFlag) console.log(`[ReplaceStep] Part 2: Handling partial start block. fromPos.path.length=${fromPos.path.length}, nodeType=${firstBlockActualNode.type.name}`); if (fromPos.path.length > 1 && firstBlockActualNode.type.spec.content?.includes("inline")) { const inlineContent = firstBlockActualNode.content || []; const targetIdx = fromPos.path[fromPos.path.length - 1]; const charOff = fromPos.offset; const retained: BaseNode[] = []; for (let i = 0; i < targetIdx; i++) retained.push(inlineContent[i]); const targetInline = inlineContent[targetIdx] as TextNode;  if (targetInline?.isText && !targetInline.isLeaf && charOff > 0) { retained.push(schema.text(getText(targetInline).slice(0, charOff), targetInline.marks)); } if (retained.length > 0) { const norm = normalizeInlineArray(retained as InlineNode[], schema); if (norm.length > 0) { finalDocContent.push(schema.node(firstBlockActualNode.type, firstBlockActualNode.attrs, norm)); if (currentDebugFlag) console.log(`[ReplaceStep] Part 2: Kept partial start block (inline content cut). New node: ${finalDocContent[finalDocContent.length-1].type.name} with ${norm.length} children.`); }}} else if (fromPos.path.length === 1 && firstBlockActualNode.isText && !firstBlockActualNode.isLeaf && fromPos.offset > 0) { const textToSlice = getText(firstBlockActualNode); if (fromPos.offset < textToSlice.length) { finalDocContent.push(schema.text(textToSlice.slice(0, fromPos.offset), firstBlockActualNode.marks)); if (currentDebugFlag) console.log(`[ReplaceStep] Part 2: Kept partial start block (text block cut).`); } else { finalDocContent.push(firstBlockActualNode); if (currentDebugFlag) console.log(`[ReplaceStep] Part 2: fromPos.offset at end of text block, kept whole block.`);}} else { if (currentDebugFlag) console.log(`[ReplaceStep] Part 2: Not a recognized partial start case, or fromNodeIsBlockBoundary was false but condition not met.`);}} else if (currentDebugFlag && fromNodeIsBlockBoundary) { console.log(`[ReplaceStep] Part 2: Start block is fully replaced or deleted (fromNodeIsBlockBoundary=true).`); }
        if (currentDebugFlag && this.slice.content.length > 0) console.log(`[ReplaceStep] Part 3: Adding ${this.slice.content.length} nodes from slice.`); let currentBlockContentForSlice: InlineNode[] = []; for (const sliceNode of this.slice.content) { if (sliceNode.type.spec.inline || sliceNode.isText) { currentBlockContentForSlice.push(sliceNode as InlineNode); } else { if (currentBlockContentForSlice.length > 0) { const defBlock = schema.nodes.paragraph; if (!defBlock) return {failed:"Para not in schema"}; finalDocContent.push(defBlock.create(null, normalizeInlineArray(currentBlockContentForSlice, schema))); currentBlockContentForSlice = []; } finalDocContent.push(sliceNode); }} if (currentBlockContentForSlice.length > 0) { const defBlock = schema.nodes.paragraph; if (!defBlock) return {failed:"Para not in schema"}; finalDocContent.push(defBlock.create(null, normalizeInlineArray(currentBlockContentForSlice, schema))); }
        const lastBlockActualNode = currentDocContent[lastAffectedBlockIndex]; if (currentDebugFlag && lastBlockActualNode) console.log(`[ReplaceStep] Part 4: lastAffectedBlockNode is ${lastBlockActualNode.type.name}, toNodeIsBlockBoundary=${toNodeIsBlockBoundary}`);
        if (lastBlockActualNode && !toNodeIsBlockBoundary && firstAffectedBlockIndex <= lastAffectedBlockIndex) { if (currentDebugFlag) console.log(`[ReplaceStep] Part 4: Handling partial end block. toPos.path.length=${toPos.path.length}, nodeType=${lastBlockActualNode.type.name}`); if (firstAffectedBlockIndex < lastAffectedBlockIndex || fromNodeIsBlockBoundary) {  if (toPos.path.length > 1 && lastBlockActualNode.type.spec.content?.includes("inline")) { const inlineContent = lastBlockActualNode.content || []; const targetIdx = toPos.path[toPos.path.length-1]; const charOff = toPos.offset; const retainedTrail: BaseNode[] = []; const targetInline = inlineContent[targetIdx] as TextNode;  if (targetInline?.isText && !targetInline.isLeaf && charOff < getText(targetInline).length) { retainedTrail.push(schema.text(getText(targetInline).slice(charOff), targetInline.marks)); } for (let i = targetIdx + 1; i < inlineContent.length; i++) retainedTrail.push(inlineContent[i]); if (retainedTrail.length > 0) { const norm = normalizeInlineArray(retainedTrail as InlineNode[], schema); if (norm.length > 0) { finalDocContent.push(schema.node(lastBlockActualNode.type, lastBlockActualNode.attrs, norm)); if (currentDebugFlag) console.log(`[ReplaceStep] Part 4: Kept partial end block (inline content cut). New node: ${finalDocContent[finalDocContent.length-1].type.name} with ${norm.length} children.`); }}} else if (toPos.path.length === 1 && lastBlockActualNode.isText && !lastBlockActualNode.isLeaf) { const textToSlice = getText(lastBlockActualNode); if (toPos.offset < textToSlice.length) { finalDocContent.push(schema.text(textToSlice.slice(toPos.offset), lastBlockActualNode.marks)); if (currentDebugFlag) console.log(`[ReplaceStep] Part 4: Kept partial end block (text block cut).`); }} else { if (currentDebugFlag) console.log(`[ReplaceStep] Part 4: Not a recognized partial end case.`);}} else if (currentDebugFlag) { console.log(`[ReplaceStep] Part 4: Skipped partial end block because it's same as partial start block (fromIndex=${firstAffectedBlockIndex}, toIndex=${lastAffectedBlockIndex}, fromBoundary=${fromNodeIsBlockBoundary}).`); }} else if (currentDebugFlag && toNodeIsBlockBoundary) { console.log(`[ReplaceStep] Part 4: End block is fully replaced or deleted (toNodeIsBlockBoundary=true).`); }
        if (currentDebugFlag) console.log(`[ReplaceStep] Part 5: Adding blocks from index ${lastAffectedBlockIndex + 1}. Original content length: ${currentDocContent.length}`); for (let i = lastAffectedBlockIndex + 1; i < currentDocContent.length; i++) { const blockToAdd = currentDocContent[i]; finalDocContent.push(blockToAdd); if (currentDebugFlag) console.log(`[ReplaceStep] Part 5: Kept block ${i} as is: ${blockToAdd.type.name} (text: ${getText(blockToAdd.content?.[0])})`); }
        if (currentDebugFlag) { console.log("[ReplaceStep] Final assembled docContent before creating new DocNode:"); finalDocContent.forEach((n, idx) => console.log(`  [${idx}] ${n.type.name}: ${n.isText ? `"${getText(n)}"` : (n.content?.map(c=>(c as TextNode).text).join("|") || "no_inline_text")}`)); }
        
        const newDoc = schema.node(doc.type, doc.attrs, finalDocContent) as DocNode;
        const map = new StepMap([this.from, this.to, this.from, this.from + this.slice.size]);
        if (currentDebugFlag) console.log(`[ReplaceStep] APPLY END: New doc nodeSize=${newDoc.nodeSize}. StepMap created.`);
        return { doc: newDoc, map };
    }

    getMap(): StepMap { return new StepMap([this.from, this.to, this.from, this.from + this.slice.size]); }
    invert(doc: DocNode): Step | null {
        const schema = doc.type.schema; const originalSlice = sliceDocByFlatOffsets(doc, this.from, this.to, schema);
        if (originalSlice === Slice.empty && (this.from !== this.to)) { console.warn(`ReplaceStep.invert: sliceDocByFlatOffsets returned empty for range [${this.from},${this.to}].`); }
        return new ReplaceStep(this.from, this.from + this.slice.size, originalSlice);
    }
}

console.log("transform/replaceStep.ts: Updated full doc replacement logic, added more logs.");
