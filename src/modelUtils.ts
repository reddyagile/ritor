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
            const mergedText = getText(lastNode) + getText(node); // Use getText helper
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
    if (currentParentNode.isText && !currentParentNode.isLeaf) { const tN = currentParentNode as TextNode; if (position.offset < 0 || position.offset > getText(tN).length) throw new Error(`Invalid offset ${position.offset} for TextNode len ${getText(tN).length}`); flatOffset += position.offset; } //Use getText
    else if (!currentParentNode.isLeaf) { const content = currentParentNode.content || []; if (position.offset < 0 || position.offset > content.length) throw new Error(`Invalid offset ${position.offset} for Element with ${content.length} children`); for (let k = 0; k < position.offset; k++) flatOffset += content[k].nodeSize; }
    else { if (position.offset !== 0 && !(position.offset === 1 && currentParentNode.nodeSize === 1)) { /* console.warn(`Offset for leaf ${currentParentNode.type.name} is ${position.offset}.`); */ } }
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
    const fromPos = flatOffsetToModelPosition(doc, fromFlat, schema); const toPos = flatOffsetToModelPosition(doc, toFlat, schema);
    if (!fromPos || !toPos) { console.warn("sliceDocByFlatOffsets: Invalid fromPos or toPos from flat offsets."); return Slice.empty; }
    const fromParentPath = fromPos.path.slice(0, -1); const toParentPath = toPos.path.slice(0, -1);

    if (fromPos.path.length > 0 && toPos.path.length > 0 && fromParentPath.join(',') === toParentPath.join(',')) {
        const parentBlockPath = fromParentPath; const parentBlock = nodeAtPath(doc, parentBlockPath);
        if (!parentBlock?.content || parentBlock.isLeaf || !parentBlock.type.spec.content?.includes("inline")) return Slice.empty;
        const inlineContent = parentBlock.content as ReadonlyArray<BaseNode>;
        const fromIdx = fromPos.path[fromPos.path.length - 1]; const fromOff = fromPos.offset;
        const toIdx = toPos.path[toPos.path.length - 1]; const toOff = toPos.offset;
        const sliced: BaseNode[] = [];
        if (fromIdx === toIdx) { const node = inlineContent[fromIdx]; if (node?.isText && !node.isLeaf) { const textVal = getText(node).slice(fromOff, toOff); if (textVal) sliced.push(schema.text(textVal, node.marks)); } else if (node && fromOff === 0 && (toOff === 1 && node.isLeaf || toOff === (node.content?.length||0))) { sliced.push(node); }}
        else { const node1 = inlineContent[fromIdx]; if (node1?.isText && !node1.isLeaf) { if (fromOff < getText(node1).length) sliced.push(schema.text(getText(node1).slice(fromOff), node1.marks)); } else if (node1 && fromOff === 0) { sliced.push(node1); }
               for (let i = fromIdx + 1; i < toIdx; i++) sliced.push(inlineContent[i]);
               const nodeN = inlineContent[toIdx]; if (nodeN?.isText && !nodeN.isLeaf) { if (toOff > 0) sliced.push(schema.text(getText(nodeN).slice(0, toOff), nodeN.marks)); } else if (nodeN && toOff > 0) { sliced.push(nodeN); }}
        return Slice.fromFragment(normalizeInlineArray(sliced as InlineNode[], schema));
    }
    let startBlockIdx = -1, endBlockIdx = -1;
    if (fromPos.path.length === 0) startBlockIdx = fromPos.offset; else if (fromPos.path.length === 1 && fromPos.offset === 0) startBlockIdx = fromPos.path[0]; else startBlockIdx = fromPos.path[0];
    if (toPos.path.length === 0) endBlockIdx = toPos.offset -1;
    else if (toPos.path.length === 1) { const block = nodeAtPath(doc, [toPos.path[0]]); if (block && ( (block.isText && toPos.offset === getText(block).length) || (!block.isText && !block.isLeaf && toPos.offset === (block.content?.length || 0)) || (block.isLeaf && toPos.offset === 1) ) ) endBlockIdx = toPos.path[0]; else endBlockIdx = toPos.path[0] -1; }
    else { endBlockIdx = toPos.path[0]; }
    const slicedBlocks: BaseNode[] = [];
    if (startBlockIdx !== -1 && endBlockIdx !== -1 && startBlockIdx <= endBlockIdx && doc.content) { for (let i = startBlockIdx; i <= endBlockIdx; i++) { if (doc.content[i]) slicedBlocks.push(doc.content[i]); } return new Slice(slicedBlocks, 0, 0); }
    console.warn(`sliceDocByFlatOffsets: Unhandled complex case or invalid range. From: ${fromFlat}, To: ${toFlat}`); return Slice.empty;
}

console.log("modelUtils.ts updated: getText moved here, replaceNodeAtPath signature changed, sliceDocByFlatOffsets refined.");
