// src/modelUtils.ts

import { DocNode, BaseNode, TextNode, InlineNode, Mark } from './documentModel.js';
import { ModelPosition } from './selection.js';
import { Schema } from './schema.js';
import { Slice } from './transform/slice.js';

// Helper to get text of a text node, defaulting to empty string
export function getText(node: BaseNode | null | undefined): string {
    if (node && node.isText && !node.isLeaf) {
        return (node as TextNode).text;
    }
    return "";
}

/**
 * Normalizes an array of inline nodes, merging adjacent TextNodes with the same marks
 * and removing empty TextNodes.
 * @param inlineNodes Array of inline nodes.
 * @param schema The schema, used to create new text nodes if merging.
 * @returns A new array with normalized inline nodes.
 */
export function normalizeInlineArray(inlineNodes: ReadonlyArray<InlineNode>, schema?: Schema): InlineNode[] {
    if (!inlineNodes || inlineNodes.length === 0) {
        return [];
    }
    const result: InlineNode[] = [];
    let lastNode: InlineNode | null = null;
    for (const node of inlineNodes) {
        if (lastNode && lastNode.isText && !lastNode.isLeaf && node.isText && !node.isLeaf &&
            marksEq(lastNode.marks || [], node.marks || [])) {
            let text1 = getText(lastNode);
            let text2 = getText(node);
            let mergedText = text1 + text2; // Reverted: simple concatenation
            if (mergedText) {
                const currentSchema = schema || node.type.schema; 
                if (!currentSchema) throw new Error("Schema must be available to normalize inline array and create text nodes.");
                const newTextNode = currentSchema.text(mergedText, lastNode.marks) as TextNode;
                result[result.length - 1] = newTextNode;
                lastNode = newTextNode;
            } else { result.pop(); lastNode = result.length > 0 ? result[result.length -1] : null; }
        } else if (node.isText && !node.isLeaf && !getText(node) && node.marks && node.marks.length === 0) { // Use getText
            // Skip
        } else { result.push(node); lastNode = node; }
    }
    return result;
}

export function modelPositionToFlatOffset(doc: DocNode, position: ModelPosition, schema?: Schema): number {
    let flatOffset = 0; let currentParentNode: BaseNode = doc; let currentChildrenInNode: ReadonlyArray<BaseNode> = doc.content || [];
    for (let i = 0; i < position.path.length; i++) {
        const idx = position.path[i]; if (idx < 0 || idx >= currentChildrenInNode.length) throw new Error(`Invalid path: index ${idx} out of bounds at depth ${i}. Path: ${position.path.join(',')}`);
        for (let j = 0; j < idx; j++) flatOffset += currentChildrenInNode[j].nodeSize;
        const target = currentChildrenInNode[idx]; if (!target.isText && !target.isLeaf) flatOffset += 1;
        if (target.isLeaf && i < position.path.length - 1) throw new Error(`Invalid path: cannot descend into leaf ${target.type.name}`);
        currentParentNode = target; currentChildrenInNode = target.content || [];
    }
    if (currentParentNode.isText && !currentParentNode.isLeaf) {
        const tN = currentParentNode as TextNode;
        if (position.offset < 0 || position.offset > getText(tN).length) throw new Error(`Invalid offset ${position.offset} for TextNode len ${getText(tN).length}`);
        flatOffset += position.offset;
    } else if (!currentParentNode.isLeaf) { // Element node with content
        const content = currentParentNode.content || [];
        if (position.offset < 0 || position.offset > content.length) throw new Error(`Invalid offset ${position.offset} for Element with ${content.length} children`);
        for (let k = 0; k < position.offset; k++) { // Add sizes of children up to the offset (which is a child index)
            flatOffset += content[k].nodeSize;
        }
    } else { // Leaf node (e.g. hard_break)
        if (position.offset > 0) { // If offset indicates "after" the leaf node (typically offset=1 for leaf)
            flatOffset += currentParentNode.nodeSize;
        }
        // If offset is 0, flatOffset already points to the start of the leaf.
    }
    return flatOffset;
}

export function flatOffsetToModelPosition(doc: DocNode, targetFlatOffset: number, schema?: Schema): ModelPosition {
    if (targetFlatOffset < 0 || targetFlatOffset > doc.nodeSize) throw new Error(`flatOffset ${targetFlatOffset} out of bounds for doc size ${doc.nodeSize}`);
    const path: number[] = []; let currentElement: BaseNode = doc; let currentRemainingOffset = targetFlatOffset;
    while (true) {
        if (currentElement.isText && !currentElement.isLeaf) { if (currentRemainingOffset < 0 || currentRemainingOffset > currentElement.nodeSize) throw new Error(`Offset ${currentRemainingOffset} out of bounds for text node size ${currentElement.nodeSize}`); return { path, offset: currentRemainingOffset }; }
        if (currentElement.isLeaf) { if (currentRemainingOffset < 0 || currentRemainingOffset > currentElement.nodeSize ) throw new Error(`Offset ${currentRemainingOffset} out of bounds for leaf ${currentElement.type.name} size ${currentElement.nodeSize}`); return { path, offset: currentRemainingOffset }; }
        const children = currentElement.content || []; let childIndex = 0; let foundChildToDescend = false;
        for (childIndex = 0; childIndex < children.length; childIndex++) {
            const child = children[childIndex]; const childNodeSize = child.nodeSize;
            if (child.isText || child.isLeaf) {
                if (currentRemainingOffset < childNodeSize) { path.push(childIndex); return { path, offset: currentRemainingOffset }; }
                else if (currentRemainingOffset === childNodeSize) { path.push(childIndex); return { path, offset: childNodeSize }; }
                else { currentRemainingOffset -= childNodeSize; }
            } else { // Container
                if (currentRemainingOffset === 0) { return { path, offset: childIndex }; }
                if (currentRemainingOffset < 1) { throw new Error(`Invalid flat offset: points in opening tag of container ${child.type.name}. Offset: ${currentRemainingOffset}`); }
                if (currentRemainingOffset < childNodeSize) { path.push(childIndex); currentElement = child; currentRemainingOffset -= 1; foundChildToDescend = true; break; }
                else { currentRemainingOffset -= childNodeSize; }
            }
        } 
        if (!foundChildToDescend) return { path, offset: children.length };
    }
}

export function nodeAtPath(doc: BaseNode, path: number[]): BaseNode | null {
    let current: BaseNode | null = doc;
    for (let i = 0; i < path.length; i++) { const index = path[i]; if (!current?.content || index < 0 || index >= current.content.length) return null; current = current.content[index]; }
    return current;
}

export function replaceNodeAtPath( originalRoot: BaseNode, fullPathToNodeToReplace: number[], newNode: BaseNode, schema: Schema ): BaseNode | null {
    if (fullPathToNodeToReplace.length === 0) {
        if (originalRoot.type !== newNode.type) { console.error("Cannot replace root node with a node of a different type."); return null; }
        return schema.node(newNode.type, newNode.attrs, newNode.content, newNode.marks);
    }
    function recurse( currentParentNode: BaseNode, pathSegmentIndex: number ): BaseNode | null {
        const childIndexToModify = fullPathToNodeToReplace[pathSegmentIndex];
        const currentContent = currentParentNode.content || [];
        if (childIndexToModify < 0 || childIndexToModify >= currentContent.length) { console.error(`Invalid path: index ${childIndexToModify} out of bounds at depth ${pathSegmentIndex}`); return null; }
        const newContent = [...currentContent];
        if (pathSegmentIndex === fullPathToNodeToReplace.length - 1) { newContent[childIndexToModify] = newNode; }
        else { const childNodeToRecurseOn = currentContent[childIndexToModify]; if (childNodeToRecurseOn.isLeaf || !childNodeToRecurseOn.content) { console.error("Cannot recurse: child is leaf or has no content, but path is longer."); return null; } const updatedChild = recurse(childNodeToRecurseOn, pathSegmentIndex + 1); if (!updatedChild) return null; newContent[childIndexToModify] = updatedChild; }
        return schema.node(currentParentNode.type, currentParentNode.attrs, newContent, currentParentNode.marks);
    }
    return recurse(originalRoot, 0);
}

export interface TextNodeRangeSegment { node: TextNode; path: number[]; startOffsetInNode: number; endOffsetInNode: number; }

export function findTextNodesInRange( doc: DocNode, fromFlat: number, toFlat: number, schema: Schema ): TextNodeRangeSegment[] {
    const results: TextNodeRangeSegment[] = []; if (fromFlat >= toFlat) return results; let currentFlatOffset = 0;
    function traverse(currentNode: BaseNode, currentPath: number[]) {
        if (currentFlatOffset >= toFlat) return;
        if (currentNode.isText && !currentNode.isLeaf) {
            const textNode = currentNode as TextNode; const nodeStartFlat = currentFlatOffset; const nodeEndFlat = nodeStartFlat + textNode.nodeSize;
            if (nodeStartFlat < toFlat && nodeEndFlat > fromFlat) { const segStart = Math.max(0, fromFlat - nodeStartFlat); const segEnd = Math.min(textNode.nodeSize, toFlat - nodeStartFlat); if (segStart < segEnd) { results.push({ node: textNode, path: [...currentPath], startOffsetInNode: segStart, endOffsetInNode: segEnd });}}
            currentFlatOffset = nodeEndFlat;
        } else if (currentNode.isLeaf) { currentFlatOffset += currentNode.nodeSize; }
        else { if (currentNode !== doc) currentFlatOffset += 1; if (currentNode.content) { for (let i = 0; i < currentNode.content.length; i++) { if (currentFlatOffset >= toFlat) break; traverse(currentNode.content[i], [...currentPath, i]);}} if (currentNode !== doc) currentFlatOffset += 1; }
    }
    traverse(doc, []); return results;
}

export function replaceNodeInPathWithMany( doc: DocNode, pathToOriginalNode: number[], newNodes: BaseNode[], schema: Schema ): DocNode | null {
    if (pathToOriginalNode.length === 0) { if (newNodes.length === 1 && newNodes[0].type === doc.type) return newNodes[0] as DocNode; console.error("Cannot replace doc root with multiple/wrong nodes."); return null; }
    const parentPath = pathToOriginalNode.slice(0, -1); const childIdxToReplace = pathToOriginalNode[pathToOriginalNode.length - 1];
    let directParent: BaseNode | null = doc;
    if (parentPath.length > 0) directParent = nodeAtPath(doc, parentPath); 
    if (!directParent?.content || childIdxToReplace >= directParent.content.length) { console.error("Invalid parent path or child index for replaceNodeInPathWithMany"); return null; }
    const newParentContent = [...directParent.content]; newParentContent.splice(childIdxToReplace, 1, ...newNodes);
    
    function cloneWithModifiedContent(originalRoot: BaseNode, targetParentPath: number[], pathIdx: number, newContentForTargetParent: BaseNode[]): BaseNode {
        const nodeToProcess = (pathIdx === 0) ? originalRoot : nodeAtPath(originalRoot, targetParentPath.slice(0, pathIdx))!; // originalRoot is doc for initial call

        if (pathIdx === targetParentPath.length) { // We are at the direct parent whose content array needs to be newContentForTargetParent
            return schema.node(nodeToProcess.type, nodeToProcess.attrs, newContentForTargetParent, nodeToProcess.marks);
        }
        const currentChildIndexInPath = targetParentPath[pathIdx]; 
        const originalChildren = nodeToProcess.content || []; 
        const newChildren = [...originalChildren];
        newChildren[currentChildIndexInPath] = cloneWithModifiedContent(originalRoot, targetParentPath, pathIdx + 1, newContentForTargetParent);
        return schema.node(nodeToProcess.type, nodeToProcess.attrs, newChildren, nodeToProcess.marks);
    }

    if (parentPath.length === 0) return schema.node(doc.type, doc.attrs, newParentContent) as DocNode;
    // The target for content modification is `directParent`. `parentPath` is path to `directParent`.
    return cloneWithModifiedContent(doc, parentPath, 0, newParentContent) as DocNode;
}


export function marksEq(marksA: ReadonlyArray<Mark>, marksB: ReadonlyArray<Mark>): boolean {
    if (marksA === marksB) return true; if (marksA.length !== marksB.length) return false;
    return marksA.every(mA => marksB.some(mB => mA.eq(mB))) && marksB.every(mB => marksA.some(mA => mB.eq(mA)));
}

export function normalizeMarks(marks: Mark[]): Mark[] {
    marks.sort((a, b) => a.type.name.localeCompare(b.type.name));
    return marks.filter((mark, index, self) => index === self.findIndex((m) => m.eq(mark)));
}

export function sliceDocByFlatOffsets(doc: DocNode, fromFlat: number, toFlat: number, schema: Schema): Slice {
    if (fromFlat >= toFlat) return Slice.empty;

    const fromPos = flatOffsetToModelPosition(doc, fromFlat, schema);
    const toPos = flatOffsetToModelPosition(doc, toFlat, schema);

    // Helper function for deep cloning
    function deepCloneNode(nodeToClone: BaseNode, schemaInstance: Schema): BaseNode {
        if (nodeToClone.isText) {
            return schemaInstance.text((nodeToClone as TextNode).text, nodeToClone.marks);
        }

        let clonedChildren: BaseNode[] = [];
        if (nodeToClone.content && nodeToClone.content.length > 0) {
            clonedChildren = nodeToClone.content.map(child => deepCloneNode(child, schemaInstance));
        }
        return schemaInstance.node(nodeToClone.type, nodeToClone.attrs, clonedChildren, nodeToClone.marks);
    }

    if (!fromPos || !toPos) {
        console.warn("sliceDocByFlatOffsets: Invalid fromPos or toPos from flat offsets.");
        return Slice.empty;
    }

    // Calculate openStart
    let openStart = 0;
    let currentParent: BaseNode = doc;
    let currentPathFlatOffset = 0; // Tracks the flat offset at the beginning of currentParent's content
    for (let d = 0; d < fromPos.path.length; d++) {
        const childIndex = fromPos.path[d];
        if (!currentParent.content || childIndex >= currentParent.content.length) break; // Should not happen for valid fromPos

        let offsetBeforeChild = currentPathFlatOffset;
        if (currentParent !== doc) offsetBeforeChild +=1; // Account for currentParent's opening tag

        for (let i = 0; i < childIndex; i++) {
            offsetBeforeChild += currentParent.content[i].nodeSize;
        }

        const childNode = currentParent.content[childIndex];
        let childContentStartFlat = offsetBeforeChild;
        if (!childNode.isText && !childNode.isLeaf) childContentStartFlat++; // Account for child's opening tag

        if (fromFlat > childContentStartFlat) {
            openStart = d + 1;
            break;
        }
        currentParent = childNode;
        currentPathFlatOffset = offsetBeforeChild + ( (!childNode.isText && !childNode.isLeaf) ? 1 : 0);
        if (d === fromPos.path.length - 1) { // At the deepest parent of the fromPos target
             const targetNode = childNode; // Node where fromPos.path terminates
             if (targetNode.isText && fromPos.offset > 0) {
                 openStart = d + 1 +1; // Text node itself is open +1 for its own depth
             } else if (!targetNode.isText && !targetNode.isLeaf && fromPos.offset > 0) {
                 // fromPos.offset is child index within this container. If > 0, this container is open.
                 openStart = d + 1 +1; // Container node is open +1 for its own depth
             }
        }
    }
    if (fromPos.path.length === 0 && fromPos.offset > 0) { // selection starts after some children of doc
        openStart = 1;
    }


    // Calculate openEnd (similar logic to openStart, but with toFlat and toPos)
    let openEnd = 0;
    let currentParentForOpenEnd: BaseNode = doc; // Use a distinct variable for openEnd calculation
    currentPathFlatOffset = 0; // Reset for openEnd
    for (let d = 0; d < toPos.path.length; d++) {
        const childIndex = toPos.path[d];
        if (!currentParentForOpenEnd.content || childIndex >= currentParentForOpenEnd.content.length) break;

        let offsetBeforeChild = currentPathFlatOffset;
        if (currentParentForOpenEnd !== doc) offsetBeforeChild +=1;

        for (let i = 0; i < childIndex; i++) {
            offsetBeforeChild += currentParentForOpenEnd.content[i].nodeSize;
        }

        const childNode = currentParentForOpenEnd.content[childIndex];
        let childContentEndFlat = offsetBeforeChild + childNode.nodeSize;
        if (!childNode.isText && !childNode.isLeaf) childContentEndFlat -=1; // Point before child's closing tag for content end

        if (toFlat < childContentEndFlat) {
            openEnd = d + 1;
            break;
        }
        currentParentForOpenEnd = childNode;
        currentPathFlatOffset = offsetBeforeChild + ( (!childNode.isText && !childNode.isLeaf) ? 1 : 0);

        if (d === toPos.path.length - 1) {
            const targetNode = childNode;
            if (targetNode.isText && toPos.offset < targetNode.nodeSize) {
                openEnd = d + 1 + 1;
            } else if (!targetNode.isText && !targetNode.isLeaf && toPos.offset < (targetNode.content?.length || 0) ) {
                openEnd = d + 1 + 1;
            }
        }
    }

    if (toPos.path.length === 0) {
        let boundaryCheckOffset = 0;
        if (toPos.offset > 0 && toPos.offset <= (doc.content?.length || 0)) {
            for (let i = 0; i < toPos.offset; i++) {
                boundaryCheckOffset += doc.content[i].nodeSize;
            }
        }
        // If toPos.offset is 0, boundaryCheckOffset remains 0.
        // This means slice ends at the beginning of the document.
        if (toFlat === boundaryCheckOffset) {
            openEnd = 0;
        } else {
            // If toFlat doesn't align with the boundary (e.g. ends mid-doc, or partway through what toPos indicates)
            // then the doc node (depth 0) is considered open at the end.
            openEnd = 1;
        }
    }
    // Note: if toPos.path.length > 0, openEnd is determined by the loop and the subsequent check for targetNode.
    // The value of openEnd might be > 1 in those cases. If the loop sets openEnd to 0, it means it aligns perfectly up to the parent.

    // Content extraction (simplified, needs to be made robust like ProseMirror's cut)
    // This part is highly complex and the current implementation is a placeholder.
    // It likely doesn't handle all edge cases or nested structures correctly.
    // A full implementation would involve recursively building the fragment,
    // potentially cutting text nodes or nodes at the edges of the slice.

    const content: BaseNode[] = [];

    // Simplified case: if slice is within a single text node or simple inline sequence
    if (fromPos.path.join(',') === toPos.path.join(',')) {
        const commonPath = fromPos.path;
        const parentNode = nodeAtPath(doc, commonPath.slice(0,-1));
        const childNode = nodeAtPath(doc, commonPath);

        if (childNode?.isText && !childNode.isLeaf) {
            const text = getText(childNode).slice(fromPos.offset, toPos.offset);
            if (text) content.push(schema.text(text, childNode.marks));
            // If content is just this text, openStart/End might be depth of parent + 1
            // This was partially handled by openStart/End calcs above.
        } else if (childNode && !childNode.isText && !childNode.isLeaf) { // Container node, slice of its children
            const startChildIdx = fromPos.offset;
            const endChildIdx = toPos.offset;
            for(let i = startChildIdx; i < endChildIdx; i++) {
                if(childNode.content && childNode.content[i]) content.push(childNode.content[i]);
            }
        } else if (childNode?.isLeaf && fromPos.offset === 0 && toPos.offset === childNode.nodeSize) {
            content.push(childNode); // copy whole leaf
        }
        // If content is not empty, it's typically inline content here.
        // Slice.fromFragment would default openStart/End to 1,1 if not a single block.
        // The openStart/End calculated above should be more accurate.
        return new Slice(normalizeInlineArray(content as InlineNode[], schema), openStart, openEnd);

    } else { // More complex slice, potentially spanning blocks
        // This is a very basic block-level slicing attempt if paths differ significantly.
        // It likely doesn't correctly handle partial first/last blocks or nesting if paths are deep.

        // Refined logic for firstBlockIdx and lastBlockIdx for simple cases (direct children of doc)
        // and cloning.
        if (fromPos.path.length === 0 && toPos.path.length === 0 ) {
            const firstBlockIdx = fromPos.offset;
            const lastBlockIdx = toPos.offset - 1; // toPos.offset is exclusive end index for children array

            if (firstBlockIdx <= lastBlockIdx) {
                for (let i = firstBlockIdx; i <= lastBlockIdx; i++) {
                    const originalNode = doc.content?.[i];
                    if (originalNode) {
                        // Perform a deep clone of the node
                        content.push(deepCloneNode(originalNode, schema));
                    }
                }
            }
        } else {
            // TODO: Implement more robust multi-block slicing for deeper paths or partial cuts.
            // This part is complex and would involve finding the common ancestor of fromPos and toPos,
            // then partially cutting the first node if needed, copying intermediate full nodes,
            // and partially cutting the last node if needed.
            console.warn(`sliceDocByFlatOffsets: Unhandled complex multi-block/deep-path case. From: ${fromFlat}, To: ${toFlat}. Falling back to simplified logic.`);
            // Fallback to old simplified logic for other cases (might be incorrect or shallow copy)

            // Attempt to handle partial first/last block for "slice across two paragraphs"
            const fromBlockPath = fromPos.path.slice(0, 1); // Path to the block node
            const fromBlockNode = nodeAtPath(doc, fromBlockPath) as BaseNode | null;

            const toBlockPath = toPos.path.slice(0, 1);
            const toBlockNode = nodeAtPath(doc, toBlockPath) as BaseNode | null;

            if (fromBlockNode && toBlockNode) {
                if (fromBlockPath.join(',') === toBlockPath.join(',')) {
                    // Slice within the same block, but not handled by the top-level inline check (e.g. deeper nesting)
                    // This needs more advanced logic, for now, push the (potentially incorrect) block.
                    console.warn("sliceDocByFlatOffsets: TODO - Slice within same deep block.");
                    if (doc.content?.[fromBlockPath[0]]) content.push(deepCloneNode(doc.content[fromBlockPath[0]], schema));

                } else {
                    // Different blocks: fromBlockNode is the first, toBlockNode is the last.
                    // 1. Handle the first block (partial from fromPos)
                    if (fromBlockNode.content && fromBlockNode.content.length > 0) {
                        const textChildOfFrom = fromBlockNode.content[fromPos.path[1]] as TextNode; // Assuming structure [blockIdx, textChildIdx]
                        if (textChildOfFrom && textChildOfFrom.isText) {
                            const slicedText = getText(textChildOfFrom).slice(fromPos.offset);
                            if (slicedText) {
                                const newTextNode = schema.text(slicedText, textChildOfFrom.marks);
                                content.push(schema.node(fromBlockNode.type, fromBlockNode.attrs, [newTextNode]));
                            } else if (fromPos.offset === textChildOfFrom.nodeSize && fromBlockNode.content.length > fromPos.path[1] +1 ) {
                                // If slicing from end of a textnode, but there are other children in the block
                                // This case is tricky - means taking remaining content of fromBlockNode
                                // For now, if slicedText is empty, we might add an empty paragraph or skip.
                                // The example "two", "three" means "two" is not empty.
                            }
                        } else { // Non-text child or complex content in fromBlockNode - needs recursive cut
                             console.warn("sliceDocByFlatOffsets: TODO - Complex content in first partial block.");
                             content.push(deepCloneNode(fromBlockNode, schema)); // Fallback: clone whole block
                        }
                    } else if (fromBlockNode.isLeaf) { // e.g. an image or hr
                        // if fromPos.offset is 0, include it. Otherwise, it's partially selected (not handled)
                         if (fromPos.offset === 0) content.push(deepCloneNode(fromBlockNode, schema));
                    }


                    // 2. Handle intermediate full blocks (if any)
                    // fromBlockPath[0] is the index of the first block in doc.content
                    // toBlockPath[0] is the index of the last block in doc.content
                    for (let i = fromBlockPath[0] + 1; i < toBlockPath[0]; i++) {
                        const intermediateBlock = doc.content?.[i];
                        if (intermediateBlock) content.push(deepCloneNode(intermediateBlock, schema));
                    }

                    // 3. Handle the last block (partial up to toPos)
                     if (toBlockNode.content && toBlockNode.content.length > 0) {
                        const textChildOfTo = toBlockNode.content[toPos.path[1]] as TextNode; // Assuming structure [blockIdx, textChildIdx]
                        if (textChildOfTo && textChildOfTo.isText) {
                            const slicedText = getText(textChildOfTo).slice(0, toPos.offset);
                            if (slicedText) {
                                const newTextNode = schema.text(slicedText, textChildOfTo.marks);
                                content.push(schema.node(toBlockNode.type, toBlockNode.attrs, [newTextNode]));
                            } // If slicedText is empty (e.g. toPos.offset is 0), this block contributes nothing.
                        } else { // Non-text child or complex content in toBlockNode
                            console.warn("sliceDocByFlatOffsets: TODO - Complex content in last partial block.");
                            content.push(deepCloneNode(toBlockNode, schema)); // Fallback: clone whole block
                        }
                    } else if (toBlockNode.isLeaf) { // e.g. an image or hr
                        // if toPos.offset is nodeSize, include it.
                         if (toPos.offset === toBlockNode.nodeSize) content.push(deepCloneNode(toBlockNode, schema));
                    }
                }
            } else {
                 // Fallback if block nodes aren't found (shouldn't happen with valid Pos)
                const fbIdx = fromPos.path.length > 0 ? fromPos.path[0] : fromPos.offset;
                const lbIdx = toPos.path.length > 0 ? toPos.path[0] : (toPos.offset > 0 ? toPos.offset - 1 : (fromPos.path.length === 0 ? fbIdx : 0) );
                 for (let i = fbIdx; i <= lbIdx; i++) {
                    if (doc.content?.[i]) { content.push(doc.content[i]); }
                }
            }
        }

        // The content array here might contain full blocks from the original document (if fallback used)
        // or cloned nodes (if new logic used).
        // Proper slicing would involve creating new, potentially partial, nodes.
        // E.g., if fromPos is mid-paragraph1, and toPos is mid-paragraph3,
        // content should be [partial_para1, full_para2, partial_para3].
    }

    if (content.length === 0 && fromFlat < toFlat) {
         // If content is empty but it shouldn't be, this indicates a failure in content extraction logic.
         // Fallback or more robust content extraction is needed.
         // For now, return Slice.empty or log a more specific warning.
         console.warn(`sliceDocByFlatOffsets: Content extraction failed or resulted in empty slice for ${fromFlat}-${toFlat}. Review logic.`);
         return Slice.empty; // Or new Slice([], openStart, openEnd) if open values are trusted.
    }

    // The `new Slice(content, openStart, openEnd)` call assumes `content` is a valid Fragment.
    // `normalizeInlineArray` might be needed if content can be mixed.
    // If content has block nodes, it should be `BaseNode[]`.
    return new Slice(content, openStart, openEnd);
}

export function isPositionAtStartOfBlockContent(
    doc: DocNode,
    cursorPos: ModelPosition,
    blockNodePath: number[], // Path to the block node in question
    schema: Schema
): boolean {
    if (!cursorPos || !blockNodePath) return false;

    const blockNode = nodeAtPath(doc, blockNodePath);
    if (!blockNode || blockNode.isLeaf) return false; // Not a block or not a content-holding block

    const cursorPosFlat = modelPositionToFlatOffset(doc, cursorPos, schema);

    let blockNodeStartFlat = 0;
    let currentParentNode: BaseNode = doc;
    for (let i = 0; i < blockNodePath.length; i++) {
        const idx = blockNodePath[i];
        if (!currentParentNode.content || idx >= currentParentNode.content.length) {
            return false; 
        }
        for (let j = 0; j < idx; j++) {
            blockNodeStartFlat += currentParentNode.content[j].nodeSize;
        }
        currentParentNode = currentParentNode.content[idx];
        if (i < blockNodePath.length -1) { 
             if(!currentParentNode.isText && !currentParentNode.isLeaf) blockNodeStartFlat += 1;
        }
    }
    // blockNodeStartFlat is now the position *before* the target blockNode in its parent's content list (flat offset terms)
    // Add 1 for its opening tag to get to the start of its content, if it's not the doc itself.
    const startOfBlockContentFlat = blockNodePath.length === 0 ? 0 : blockNodeStartFlat + 1;
    
    return cursorPosFlat === startOfBlockContentFlat;
}

// Comparison utils - moved from DomPatcher and adapted
import { Attrs } from './schemaSpec.js'; // For areAttrsEqual

export function areAttrsEqual(attrsA: Attrs | undefined, attrsB: Attrs | undefined): boolean {
  if (attrsA === attrsB) return true;
  if (!attrsA || !attrsB) return false;

  const keysA = Object.keys(attrsA);
  const keysB = Object.keys(attrsB);

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    // Ensure id is handled if it can be of different types or needs specific comparison
    if (key === 'id' && attrsA.id !== attrsB.id) return false; 
    else if (attrsA[key] !== attrsB[key]) {
      return false;
    }
  }
  return true;
}

export function areNodesEffectivelyEqual(nodeA: BaseNode | null, nodeB: BaseNode | null): boolean {
    if (nodeA === nodeB) return true; 
    if (!nodeA || !nodeB) return false;
    if (nodeA.type !== nodeB.type) return false; 

    // For attributes, explicitly ignore 'id' for comparison if it's auto-generated and not semantic content
    const attrsA = { ...nodeA.attrs };
    const attrsB = { ...nodeB.attrs };
    // If IDs are not considered part of "effective equality" for content diffing, they can be deleted here.
    // delete attrsA.id; 
    // delete attrsB.id;
    // However, if ID is a semantic attribute (e.g. for linking, like a heading ID), it should be compared.
    // For now, areAttrsEqual will compare all, including ID. If this causes issues in diffing,
    // we might need a version of areAttrsEqual that can ignore certain keys.

    if (!areAttrsEqual(attrsA, attrsB)) return false;

    if (nodeA.isText && !nodeA.isLeaf) { 
      const textNodeA = nodeA as TextNode; 
      const textNodeB = nodeB as TextNode;
      if (textNodeA.text !== textNodeB.text) return false;
      if (!marksEq(textNodeA.marks || [], textNodeB.marks || [])) return false;
      return true;
    }

    if (nodeA.type.spec.atom) { 
        return true; 
    }

    if (nodeA.content && nodeB.content) {
        if (nodeA.content === nodeB.content) return true; 
        if (nodeA.content.length !== nodeB.content.length) return false;
        for (let i = 0; i < nodeA.content.length; i++) {
          if (!areNodesEffectivelyEqual(nodeA.content[i], nodeB.content[i])) return false;
        }
        return true; 
    } else if (nodeA.content || nodeB.content) { 
        return false;
    }
    
    return true;
}


console.log("modelUtils.ts updated: getText moved here, replaceNodeAtPath signature changed, sliceDocByFlatOffsets refined, added comparison utils.");
