// src/transform/replaceStep.ts

import { DocNode, BaseNode, TextNode, InlineNode } from '../documentModel.js';
import { Step, StepResult } from './step.js';
import { StepMap } from './stepMap.js';
import { Slice } from './slice.js';
import { modelPositionToFlatOffset, flatOffsetToModelPosition, normalizeInlineArray, nodeAtPath, replaceNodeAtPath, sliceDocByFlatOffsets, getText, marksEq } from '../modelUtils.js'; 
import { Schema } from '../schema.js';

const DEBUG_REPLACESTEP = (globalThis as any).DEBUG_REPLACESTEP || false;
// const DEBUG_REPLACESTEP = (globalThis as any).DEBUG_REPLACESTEP_FORCE_TRUE || false; // Use a distinct flag for forced debug
// Trivial comment to force re-evaluation
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
        if (currentDebugFlag) { console.log(`[ReplaceStep] Resolved fromPos: ${JSON.stringify(fromPos)}, toPos: ${JSON.stringify(toPos)}`); }
        if (!fromPos || !toPos) return { failed: "Invalid from/to position for ReplaceStep." };

        // SINGLE-BLOCK INLINE REPLACEMENT PATH
        const fromParentPath = fromPos.path.slice(0, -1);
        // const toParentPath = toPos.path.slice(0, -1); // Not strictly needed due to check below

        if (fromPos.path.length > 0 && toPos.path.length > 0 && fromParentPath.join(',') === toPos.path.slice(0, -1).join(',')) {
            const parentBlockPath = fromParentPath;
            const parentBlockNode = nodeAtPath(doc, parentBlockPath) as BaseNode;

            if (parentBlockNode?.content && !parentBlockNode.isLeaf && parentBlockNode.type.spec.content?.includes("inline")) {
                if (currentDebugFlag) console.log("[ReplaceStep] Applying as single-block inline replacement.");
                const originalInlineContent = parentBlockNode.content as ReadonlyArray<BaseNode>;
                const fromNodeIdxInParent = fromPos.path[fromPos.path.length - 1];
                const fromCharOff = fromPos.offset;
                const toNodeIdxInParent = toPos.path[toPos.path.length - 1];
                const toCharOff = toPos.offset;

                let newInlineContent: BaseNode[] = [];
                let sliceNodesToInsert = [...this.slice.content] as InlineNode[];

                // Add content before the replacement start point within the first affected inline node
                for (let i = 0; i < fromNodeIdxInParent; i++) {
                    newInlineContent.push(originalInlineContent[i]);
                }

                const firstAffectedOriginalInlineNode = originalInlineContent[fromNodeIdxInParent];
                let textBeforeSlice = "";
                let marksBeforeSlice: ReadonlyArray<any> = [];

                if (firstAffectedOriginalInlineNode) {
                    if (firstAffectedOriginalInlineNode.isText) {
                        marksBeforeSlice = firstAffectedOriginalInlineNode.marks || [];
                        if (fromCharOff > 0) {
                            textBeforeSlice = getText(firstAffectedOriginalInlineNode).slice(0, fromCharOff);
                        }
                    } else if (fromCharOff !== 0) { // Non-text node, but offset is not 0
                        return { failed: "ReplaceStep: Offset in non-text start node for inline replacement is not supported." };
                    }
                }

                // Attempt to merge textBeforeSlice with the start of the slice
                if (this.slice.openStart > 0 && sliceNodesToInsert.length > 0) {
                    const firstSliceNode = sliceNodesToInsert[0];
                    if (textBeforeSlice.length > 0 && firstSliceNode.isText && marksEq(marksBeforeSlice, firstSliceNode.marks || [])) {
                        textBeforeSlice += getText(firstSliceNode); // Merge
                        sliceNodesToInsert.shift(); // Consumed
                    }
                }
                if (textBeforeSlice.length > 0) {
                    newInlineContent.push(schema.text(textBeforeSlice, marksBeforeSlice));
                }

                // Add the (remaining) slice nodes
                newInlineContent.push(...sliceNodesToInsert);

                // Add content after the replacement end point from the last affected inline node
                const lastAffectedOriginalInlineNode = originalInlineContent[toNodeIdxInParent];
                let textAfterSlice = "";
                let marksAfterSlice: ReadonlyArray<any> = [];

                if (lastAffectedOriginalInlineNode) {
                    if (lastAffectedOriginalInlineNode.isText) {
                        marksAfterSlice = lastAffectedOriginalInlineNode.marks || [];
                        const originalNodeTextForAfterSlice = getText(originalInlineContent[toInlineNodeIndex]);
                        if (toCharOff < originalNodeTextForAfterSlice.length) {
                            textAfterSlice = originalNodeTextForAfterSlice.slice(toCharOff);
                            if (currentDebugFlag || (this.from === 7 && this.to === 18 && parentBlockNode?.type.name === 'paragraph') ) {
                                console.log(`[ReplaceStep SingleBlock MB5 DEBUG] textAfterSlice: '${textAfterSlice}', from originalNodeTextForAfterSlice: '${originalNodeTextForAfterSlice}' (length ${originalNodeTextForAfterSlice.length}), toCharOff: ${toCharOff}`);
                            }
                        }
                    } else if (lastAffectedOriginalInlineNode.isLeaf && toCharOff === 0 && fromNodeIdxInParent === toNodeIdxInParent && fromCharOff === 0 && this.slice.content.length === 0) {
                        newInlineContent.push(lastAffectedOriginalInlineNode);
                    } else if (toCharOff !== (lastAffectedOriginalInlineNode.isLeaf ? 1 : (lastAffectedOriginalInlineNode.content?.length || 0))) {
                        /* console.warn("Offset in non-text end node may not be fully handled."); */
                    }
                }
                if (this.slice.openEnd > 0 && newInlineContent.length > 0 && textAfterSlice.length > 0) { const lastPushedNodeIndex = newInlineContent.length -1; const lastPushedNode = newInlineContent[lastPushedNodeIndex]; if (lastPushedNode.isText && marksEq(lastPushedNode.marks || [], marksAfterSlice)) { const mergedEndText = getText(lastPushedNode) + textAfterSlice; newInlineContent[lastPushedNodeIndex] = schema.text(mergedEndText, lastPushedNode.marks || []); textAfterSlice = ""; /*Consumed*/ } else { if (textAfterSlice.length > 0) newInlineContent.push(schema.text(textAfterSlice, marksAfterSlice));}} else { if (textAfterSlice.length > 0) newInlineContent.push(schema.text(textAfterSlice, marksAfterSlice));} // Ensure textAfterSlice is added if not merged
                for (let i = toNodeIdxInParent + 1; i < originalInlineContent.length; i++) newInlineContent.push(originalInlineContent[i]); // Add nodes after the toNodeIdxInParent

                const normalizedNewInlineContent = normalizeInlineArray(newInlineContent as InlineNode[], schema);
                const newParentBlock = schema.node(parentBlockNode.type, parentBlockNode.attrs, normalizedNewInlineContent, parentBlockNode.marks);

                let finalDoc: DocNode | null = null;
                if (parentBlockPath.length === 0) {
                    return { failed: "ReplaceStep: Cannot replace content of a parentless node that is not the doc itself." };
                }
                const newRootBaseNode = replaceNodeAtPath(doc, parentBlockPath, newParentBlock, schema);

                if (newRootBaseNode?.type.name === doc.type.name) {
                    finalDoc = newRootBaseNode as DocNode;
                } else if (newRootBaseNode === null) {
                    return { failed: "ReplaceStep: Failed to replace node in path during inline modification." };
                } else {
                    return { failed: "ReplaceStep: Node replacement resulted in unexpected root node type." };
                }

                if (!finalDoc) return { failed: "ReplaceStep: Failed inline modification, finalDoc is null." };
                return { doc: finalDoc, map: new StepMap([this.from, this.to, this.from, this.from + this.slice.size]) };
            }
        }
        
        // MULTI-BLOCK REPLACEMENT PATH
        if (currentDebugFlag) console.log("[ReplaceStep] Applying as multi-block replacement.");
        let firstAffectedBlockIndex: number;
        let fromNodeIsBlockBoundary = false;
        if (fromPos.path.length === 0) {
            firstAffectedBlockIndex = fromPos.offset;
            fromNodeIsBlockBoundary = true;
        } else {
            firstAffectedBlockIndex = fromPos.path[0];
            const fB = doc.content?.[firstAffectedBlockIndex];
            if (fromPos.path.length === 1 && fromPos.offset === 0 && (!fB || (!fB.isText && !fB.isLeaf)) ) fromNodeIsBlockBoundary = true;
            if (fB?.isText && fromPos.offset === 0) fromNodeIsBlockBoundary = true;
        }

        let lastAffectedBlockIndex: number;
        let toNodeIsBlockBoundary = false;
        if (toPos.path.length === 0) {
            lastAffectedBlockIndex = toPos.offset - 1;
            toNodeIsBlockBoundary = true;
        } else {
            lastAffectedBlockIndex = toPos.path[0];
            const tB = doc.content?.[lastAffectedBlockIndex];
            if (toPos.path.length === 1) {
                if (tB && !tB.isText && !tB.isLeaf && toPos.offset === (tB.content?.length || 0) ) toNodeIsBlockBoundary = true;
                else if (tB?.isText && !tB.isLeaf && toPos.offset === getText(tB).length) toNodeIsBlockBoundary = true;
                else if (tB?.isLeaf && toPos.offset === 1) toNodeIsBlockBoundary = true;
            }
        }
        if (currentDebugFlag) { console.log(`[ReplaceStep] Block Indices: firstAffected=${firstAffectedBlockIndex} (boundary=${fromNodeIsBlockBoundary}), lastAffected=${lastAffectedBlockIndex} (boundary=${toNodeIsBlockBoundary})`); }

        const finalDocContent: BaseNode[] = [];
        const currentDocContent = doc.content || [];

        // 1. Content before the replacement range
        for (let i = 0; i < firstAffectedBlockIndex; i++) {
            finalDocContent.push(currentDocContent[i]);
        }

        let sliceNodesToInsert = [...this.slice.content];
        const firstBlockActualNode = currentDocContent[firstAffectedBlockIndex];
        const lastBlockActualNode = currentDocContent[lastAffectedBlockIndex];
        let leftHandProcessed = false; // True if firstAffectedBlockNode or block before it is processed/merged with slice start
        let rightHandProcessed = false; // True if lastAffectedBlockNode or block after it is processed/merged with slice end
        let consumedNextBlockByRightMerge = false;

        // 2. Handle the start of the replacement and merging with slice.openStart
        if (this.slice.openStart > 0 && sliceNodesToInsert.length > 0) {
            const firstSliceNode = sliceNodesToInsert[0];
            let mergeTargetLeft: BaseNode | null = null;
            let partialLeftInlineContent: InlineNode[] = [];
            let targetIsFinalDocContentLast = false;

            if (!fromNodeIsBlockBoundary && firstBlockActualNode) {
                if (firstBlockActualNode.type === firstSliceNode.type && firstBlockActualNode.type.isBlock && firstSliceNode.type.isBlock && firstBlockActualNode.type.spec.content?.includes("inline") && firstSliceNode.type.spec.content?.includes("inline")) {
                    if (fromPos.path.length > 1 && firstBlockActualNode.content) {
                        const inlineC = firstBlockActualNode.content as InlineNode[];
                        const cutIdx = fromPos.path[fromPos.path.length -1]; // Index of inline child
                        const charOff = fromPos.offset;
                        for(let i=0; i < cutIdx; i++) partialLeftInlineContent.push(inlineC[i]);
                        const targetInlineNode = inlineC[cutIdx] as TextNode;
                        if (targetInlineNode?.isText && charOff > 0) {
                            partialLeftInlineContent.push(schema.text(getText(targetInlineNode).slice(0, charOff), targetInlineNode.marks) as InlineNode);
                        }
                    }
                    mergeTargetLeft = schema.node(firstBlockActualNode.type, firstBlockActualNode.attrs, normalizeInlineArray(partialLeftInlineContent, schema));
                }
            } else if (fromNodeIsBlockBoundary && finalDocContent.length > 0) {
                 const blockBefore = finalDocContent[finalDocContent.length - 1];
                 if (blockBefore.type === firstSliceNode.type && blockBefore.type.isBlock && firstSliceNode.type.isBlock && blockBefore.type.spec.content?.includes("inline") && firstSliceNode.type.spec.content?.includes("inline")) {
                    mergeTargetLeft = blockBefore;
                    targetIsFinalDocContentLast = true;
                 }
            }

            if (mergeTargetLeft) {
                if (currentDebugFlag) console.log(`[ReplaceStep MB-MergeLeft] Merging ${mergeTargetLeft.type.name} with slice[0] (${firstSliceNode.type.name})`);
                const mergedNodeContent = normalizeInlineArray([...(mergeTargetLeft.content || []), ...(firstSliceNode.content || [])] as InlineNode[], schema);
                const mergedNode = schema.node(mergeTargetLeft.type, mergeTargetLeft.attrs, mergedNodeContent);
                if (targetIsFinalDocContentLast) finalDocContent[finalDocContent.length - 1] = mergedNode;
                else finalDocContent.push(mergedNode);
                sliceNodesToInsert.shift();
                leftHandProcessed = true;
            }
        }

        if (!leftHandProcessed && !fromNodeIsBlockBoundary && firstBlockActualNode) {
            let partialLeftInline: InlineNode[] = [];
            if (fromPos.path.length > 1 && firstBlockActualNode.content && firstBlockActualNode.type.spec.content?.includes("inline")) {
                const inlineC = firstBlockActualNode.content as InlineNode[];
                const cutIdx = fromPos.path[fromPos.path.length -1];
                const charOff = fromPos.offset;
                for(let i=0; i < cutIdx; i++) partialLeftInline.push(inlineC[i]);
                const targetInlineNode = inlineC[cutIdx] as TextNode;
                if (targetInlineNode?.isText && charOff > 0) {
                    partialLeftInline.push(schema.text(getText(targetInlineNode).slice(0, charOff), targetInlineNode.marks) as InlineNode);
                }
            }
            if (partialLeftInline.length > 0) {
                finalDocContent.push(schema.node(firstBlockActualNode.type, firstBlockActualNode.attrs, normalizeInlineArray(partialLeftInline, schema)));
            } else if (fromPos.offset === 0 && fromPos.path.length > 1 && firstBlockActualNode.type.spec.content?.includes("inline")) {
                 if (this.slice.openStart > 0) { // Slice is open but couldn't merge (e.g. type mismatch)
                    finalDocContent.push(schema.node(firstBlockActualNode.type, firstBlockActualNode.attrs, [])); // Add empty container
                 } // If slice.openStart is 0, it brings its own block, so we don't add an empty one here.
            }
        }

        // 3. Process and insert the main slice content (adjusted)
        let tempNodesFromSlice: BaseNode[] = [];
        if (sliceNodesToInsert.length > 0) {
            let currentBlockContentForSlice: InlineNode[] = [];
            for (const sliceNode of sliceNodesToInsert) {
                if (sliceNode.type.spec.inline || sliceNode.isText) {
                    currentBlockContentForSlice.push(sliceNode as InlineNode);
                } else {
                    if (currentBlockContentForSlice.length > 0) {
                        tempNodesFromSlice.push(schema.node(schema.nodes.paragraph, {}, normalizeInlineArray(currentBlockContentForSlice, schema)));
                        currentBlockContentForSlice = [];
                    }
                    tempNodesFromSlice.push(sliceNode);
                }
            }
            if (currentBlockContentForSlice.length > 0) {
                 tempNodesFromSlice.push(schema.node(schema.nodes.paragraph, {}, normalizeInlineArray(currentBlockContentForSlice, schema)));
            }
        }

        // 4. Handle the end of the replacement and merging with slice.openEnd
        const nodeAfterRange = currentDocContent[lastAffectedBlockIndex + 1];
        if (this.slice.openEnd > 0 && tempNodesFromSlice.length > 0) {
            const lastSliceNode = tempNodesFromSlice[tempNodesFromSlice.length - 1];
            let mergeTargetRight: BaseNode | null = null;
            let partialRightInlineContent: InlineNode[] = [];
            let targetIsBlockAfter = false;

            if (!toNodeIsBlockBoundary && lastBlockActualNode && (firstAffectedBlockIndex < lastAffectedBlockIndex || (firstAffectedBlockIndex === lastAffectedBlockIndex && !leftHandProcessed ))) {
                if (lastBlockActualNode.type === lastSliceNode.type && lastBlockActualNode.type.isBlock && lastSliceNode.type.isBlock && lastBlockActualNode.type.spec.content?.includes("inline") && lastSliceNode.type.spec.content?.includes("inline")) {
                    if (toPos.path.length > 1 && lastBlockActualNode.content) {
                        const inlineC = lastBlockActualNode.content as InlineNode[];
                        const cutIdx = toPos.path[toPos.path.length -1];
                        const charOff = toPos.offset;
                        const targetInlineNode = inlineC[cutIdx] as TextNode;
                        if (targetInlineNode?.isText && charOff < getText(targetInlineNode).length) {
                            partialRightInlineContent.push(schema.text(getText(targetInlineNode).slice(charOff), targetInlineNode.marks) as InlineNode);
                        }
                        for(let k = cutIdx + 1; k < inlineC.length; k++) partialRightInlineContent.push(inlineC[k]);
                    }
                    mergeTargetRight = schema.node(lastBlockActualNode.type, lastBlockActualNode.attrs, normalizeInlineArray(partialRightInlineContent, schema)); // This is the content to append from right side
                }
            } else if (toNodeIsBlockBoundary && nodeAfterRange) {
                 if (nodeAfterRange.type === lastSliceNode.type && nodeAfterRange.type.isBlock && lastSliceNode.type.isBlock && nodeAfterRange.type.spec.content?.includes("inline") && lastSliceNode.type.spec.content?.includes("inline")) {
                    mergeTargetRight = nodeAfterRange;
                    targetIsBlockAfter = true;
                 }
            }

            if (mergeTargetRight && lastSliceNode.type.isBlock && lastSliceNode.type.spec.content?.includes("inline")) {
                 if (currentDebugFlag) console.log(`[ReplaceStep MB-MergeRight] Merging lastSliceNode (${lastSliceNode.type.name}) with ${mergeTargetRight.type.name}`);
                const mergedNodeContent = normalizeInlineArray([...(lastSliceNode.content || []), ...(mergeTargetRight.content || [])] as InlineNode[], schema);
                const mergedNode = schema.node(lastSliceNode.type, lastSliceNode.attrs, mergedNodeContent);
                tempNodesFromSlice[tempNodesFromSlice.length - 1] = mergedNode;
                rightHandProcessed = true;
                if (targetIsBlockAfter) consumedNextBlockByRightMerge = true;
            }
        }

        finalDocContent.push(...tempNodesFromSlice);

        if (!rightHandProcessed && !toNodeIsBlockBoundary && lastBlockActualNode && (firstAffectedBlockIndex < lastAffectedBlockIndex || (firstAffectedBlockIndex === lastAffectedBlockIndex && !leftHandProcessed))) {
            let partialRightInline: InlineNode[] = [];
             if (toPos.path.length > 1 && lastBlockActualNode.content && lastBlockActualNode.type.spec.content?.includes("inline")) {
                const inlineC = lastBlockActualNode.content as InlineNode[];
                const cutIdx = toPos.path[toPos.path.length -1];
                const charOff = toPos.offset;
                const targetInlineNode = inlineC[cutIdx] as TextNode;
                if (targetInlineNode?.isText && charOff < getText(targetInlineNode).length) {
                    partialRightInline.push(schema.text(getText(targetInlineNode).slice(charOff), targetInlineNode.marks)as InlineNode);
                }
                for(let k = cutIdx + 1; k < inlineC.length; k++) partialRightInline.push(inlineC[k]);
            }
            if (partialRightInline.length > 0) {
                finalDocContent.push(schema.node(lastBlockActualNode.type, lastBlockActualNode.attrs, normalizeInlineArray(partialRightInline, schema)));
            } else if (toPos.offset === (lastBlockActualNode.content?.length || 0) && toPos.path.length > 1 && this.slice.openEnd > 0) {
                 finalDocContent.push(schema.node(lastBlockActualNode.type, lastBlockActualNode.attrs, []));
            }
        }

        // 5. Content after the replacement range
        for (let i = lastAffectedBlockIndex + 1; i < currentDocContent.length; i++) {
            if (consumedNextBlockByRightMerge && i === lastAffectedBlockIndex + 1) continue;
            finalDocContent.push(currentDocContent[i]);
        }

        if (currentDebugFlag) { console.log("[ReplaceStep] Final assembled docContent before creating new DocNode:"); finalDocContent.forEach((n, idx) => console.log(`  [${idx}] ${n.type.name}: ${n.isText ? `"${getText(n)}"` : (n.content?.map(c=>(c as TextNode).text).join("|") || "no_inline_text")}`)); }
        
        const newDoc = schema.node(doc.type, doc.attrs, finalDocContent) as DocNode;
        const map = new StepMap([this.from, this.to, this.from, this.from + this.slice.size]);
        if (currentDebugFlag) console.log(`[ReplaceStep] APPLY END: New doc nodeSize=${newDoc.nodeSize}. StepMap created.`);
        return { doc: newDoc, map };
    }

    getMap(): StepMap { return new StepMap([this.from, this.to, this.from, this.from + this.slice.size]); }
    invert(doc: DocNode): Step | null { // Reverted to invert
        const schema = doc.type.schema;

        // Get the content that was replaced by the original step.
        // 'doc' here is the document state *before* the original step was applied.
        const replacedContentSlice = sliceDocByFlatOffsets(doc, this.from, this.to, schema);

        if (replacedContentSlice === Slice.empty && (this.from !== this.to)) {
            // This might happen if the range was already empty or if sliceDocByFlatOffsets has issues.
            // If from === to, an empty slice is fine (insertion).
            console.warn(`ReplaceStep.invert: sliceDocByFlatOffsets returned empty for range [${this.from},${this.to}]. This might be valid if the range was already empty.`);
        }

        // Use currentDebugFlag consistent with apply()
        const currentDebugFlag = (globalThis as any).DEBUG_REPLACESTEP || false;
        if (currentDebugFlag) {
            console.log(`[ReplaceStep.invert] Original step's slice: openStart=${this.slice.openStart}, openEnd=${this.slice.openEnd}, size=${this.slice.size}`);
            console.log(`[ReplaceStep.invert] Replaced content slice: openStart=${replacedContentSlice.openStart}, openEnd=${replacedContentSlice.openEnd}, contentSize=${replacedContentSlice.content.length}`);
        }

        const invertedSlice = new Slice(replacedContentSlice.content, this.slice.openStart, this.slice.openEnd);
         if (currentDebugFlag) {
            console.log(`[ReplaceStep.invert] Created invertedSlice with openStart=${invertedSlice.openStart}, openEnd=${invertedSlice.openEnd}`);
        }
        return new ReplaceStep(this.from, this.from + this.slice.size, invertedSlice);
    }
}

console.log("transform/replaceStep.ts: Updated full doc replacement logic, added more logs.");
