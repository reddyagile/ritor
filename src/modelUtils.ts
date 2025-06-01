// src/modelUtils.ts

import { DocNode, BaseNode, TextNode, InlineNode, Mark } from './documentModel.js'; // Added Mark
import { ModelPosition } from './selection.js';
import { Schema } from './schema.js';

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
            marksEq(lastNode.marks || [], node.marks || [])) { // Use marksEq for comparing mark arrays
            const mergedText = (lastNode as TextNode).text + (node as TextNode).text;
            if (mergedText) {
                const currentSchema = schema || node.type.schema;
                if (!currentSchema) throw new Error("Schema must be available to normalize inline array and create text nodes.");
                const newTextNode = currentSchema.text(mergedText, lastNode.marks) as TextNode;
                result[result.length - 1] = newTextNode;
                lastNode = newTextNode;
            } else {
                result.pop();
                lastNode = result.length > 0 ? result[result.length -1] : null;
            }
        } else if (node.isText && !node.isLeaf && !(node as TextNode).text && node.marks && node.marks.length === 0) {
            // Skip empty text node with no marks
        } else {
            result.push(node);
            lastNode = node;
        }
    }
    return result;
}

export function modelPositionToFlatOffset(doc: DocNode, position: ModelPosition, schema?: Schema): number {
    let flatOffset = 0;
    let currentParentNode: BaseNode = doc;
    let currentChildrenInNode: ReadonlyArray<BaseNode> = doc.content || [];

    for (let i = 0; i < position.path.length; i++) {
        const childIndexInList = position.path[i];
        if (childIndexInList < 0 || childIndexInList >= currentChildrenInNode.length) {
            throw new Error(`Invalid path in ModelPosition: index ${childIndexInList} out of bounds at depth ${i}. Path: ${position.path.join(',')}`);
        }
        for (let j = 0; j < childIndexInList; j++) flatOffset += currentChildrenInNode[j].nodeSize;
        const targetChildNode = currentChildrenInNode[childIndexInList];
        if (!targetChildNode.isText && !targetChildNode.isLeaf) flatOffset += 1;
        if (targetChildNode.isLeaf && i < position.path.length - 1) throw new Error(`Invalid path: cannot descend into leaf node ${targetChildNode.type.name} at path segment ${i}`);
        currentParentNode = targetChildNode;
        currentChildrenInNode = targetChildNode.content || [];
    }

    if (currentParentNode.isText && !currentParentNode.isLeaf) {
        const textNode = currentParentNode as TextNode;
        if (position.offset < 0 || position.offset > textNode.text.length) throw new Error(`Invalid offset ${position.offset} for TextNode with length ${textNode.text.length}`);
        flatOffset += position.offset;
    } else if (!currentParentNode.isLeaf) {
        const contentOfParent = currentParentNode.content || [];
        if (position.offset < 0 || position.offset > contentOfParent.length) throw new Error(`Invalid offset ${position.offset} for ElementNode with ${contentOfParent.length} children`);
        for (let k = 0; k < position.offset; k++) flatOffset += contentOfParent[k].nodeSize;
    } else {
        if (position.offset !== 0 && !(position.offset === 1 && currentParentNode.nodeSize === 1) ) {
            // console.warn(`Offset for a leaf node ${currentParentNode.type.name} is ${position.offset}.`);
        }
    }
    return flatOffset;
}

export function flatOffsetToModelPosition(doc: DocNode, targetFlatOffset: number, schema?: Schema): ModelPosition {
    if (targetFlatOffset < 0 || targetFlatOffset > doc.nodeSize) throw new Error(`flatOffset ${targetFlatOffset} is out of bounds for document of size ${doc.nodeSize}`);
    const path: number[] = [];
    let currentElement: BaseNode = doc;
    let currentRemainingOffset = targetFlatOffset;

    while (true) {
        if (currentElement.isText && !currentElement.isLeaf) {
            if (currentRemainingOffset < 0 || currentRemainingOffset > currentElement.nodeSize) throw new Error(`Calculated offset ${currentRemainingOffset} is out of bounds for text node of size ${currentElement.nodeSize}`);
            return { path, offset: currentRemainingOffset };
        }
        if (currentElement.isLeaf) {
             if (currentRemainingOffset < 0 || currentRemainingOffset > currentElement.nodeSize ) throw new Error(`Calculated offset ${currentRemainingOffset} is out of bounds for leaf node ${currentElement.type.name} of size ${currentElement.nodeSize}`);
            return { path, offset: currentRemainingOffset };
        }

        const children = currentElement.content || [];
        let childIndex = 0;
        let foundChildToDescend = false;
        for (childIndex = 0; childIndex < children.length; childIndex++) {
            const child = children[childIndex];
            const childNodeSize = child.nodeSize;
            if (child.isText || child.isLeaf) {
                if (currentRemainingOffset < childNodeSize) { path.push(childIndex); return { path, offset: currentRemainingOffset }; }
                else if (currentRemainingOffset === childNodeSize) { path.push(childIndex); return { path, offset: childNodeSize }; }
                else { currentRemainingOffset -= childNodeSize; }
            } else { // Container child
                if (currentRemainingOffset === 0) { return { path, offset: childIndex }; }
                if (currentRemainingOffset < 1) { throw new Error(`Invalid flat offset: points within the opening tag of container ${child.type.name}. Offset: ${currentRemainingOffset}, Child: ${child.type.name}`); }
                if (currentRemainingOffset < childNodeSize) { path.push(childIndex); currentElement = child; currentRemainingOffset -= 1; foundChildToDescend = true; break; }
                else { currentRemainingOffset -= childNodeSize; }
            }
        }
        if (!foundChildToDescend) return { path, offset: children.length };
    }
}

export function nodeAtPath(doc: BaseNode, path: number[]): BaseNode | null {
    let current: BaseNode | null = doc;
    for (let i = 0; i < path.length; i++) {
        const index = path[i];
        if (!current || !current.content || index < 0 || index >= current.content.length) return null;
        current = current.content[index];
    }
    return current;
}

export function replaceNodeAtPath(
    currentParentNode: BaseNode,
    path: number[], // Path to the direct parent of the node to be replaced
    pathIndex: number, // Current index in `path` being processed
    childIndexToReplace: number, // Index of the child in currentParentNode.content to replace
    newNode: BaseNode, // The new node to insert
    schema: Schema
): BaseNode | null {
    if (pathIndex > path.length) { // pathIndex should go up to path.length for the final parent
        throw new Error("Path index out of bounds in replaceNodeAtPath.");
    }

    let newContent: BaseNode[];
    const currentContent = currentParentNode.content || [];

    if (pathIndex === path.length) { // We are at the direct parent of the node to replace
        if (childIndexToReplace < 0 || childIndexToReplace >= currentContent.length) {
            console.error("Child index out of bounds for replacement:", currentParentNode.type.name, childIndexToReplace, "Content length:", currentContent.length);
            return null; // Invalid child index
        }
        newContent = [...currentContent];
        newContent[childIndexToReplace] = newNode;
    } else { // We need to go deeper
        const currentChildIdxForRecursion = path[pathIndex];
        if (currentChildIdxForRecursion < 0 || currentChildIdxForRecursion >= currentContent.length) {
            console.error("Path index for recursion out of bounds:", currentParentNode.type.name, currentChildIdxForRecursion);
            return null;
        }
        const childNodeToRecurseOn = currentContent[currentChildIdxForRecursion];
        if (childNodeToRecurseOn.isLeaf || !childNodeToRecurseOn.content) {
            console.error("Cannot replace node in path: child is a leaf or has no content, but path is longer.", childNodeToRecurseOn, path, pathIndex);
            return null;
        }
        const updatedChild = replaceNodeAtPath(childNodeToRecurseOn, path, pathIndex + 1, childIndexToReplace, newNode, schema); // childIndexToReplace is passed down but only used at target depth
        if (!updatedChild) return null;
        newContent = [...currentContent];
        newContent[currentChildIdxForRecursion] = updatedChild;
    }
    return schema.node(currentParentNode.type, currentParentNode.attrs, newContent, currentParentNode.marks);
}

// New helper for AddMarkStep/RemoveMarkStep
export interface TextNodeRangeSegment {
    node: TextNode;
    path: number[];
    startOffsetInNode: number; // Char offset in this text node where range starts
    endOffsetInNode: number;   // Char offset in this text node where range ends
}

export function findTextNodesInRange(
    doc: DocNode,
    fromFlat: number,
    toFlat: number,
    schema: Schema
): TextNodeRangeSegment[] {
    const results: TextNodeRangeSegment[] = [];
    if (fromFlat >= toFlat) return results;

    let currentFlatOffset = 0;

    function traverse(currentNode: BaseNode, currentPath: number[]) {
        if (currentFlatOffset >= toFlat) return; // Already past the range

        if (currentNode.isText && !currentNode.isLeaf) {
            const textNode = currentNode as TextNode;
            const nodeStartFlat = currentFlatOffset;
            const nodeEndFlat = nodeStartFlat + textNode.nodeSize;

            // Check for overlap
            if (nodeStartFlat < toFlat && nodeEndFlat > fromFlat) {
                const segmentStart = Math.max(0, fromFlat - nodeStartFlat);
                const segmentEnd = Math.min(textNode.nodeSize, toFlat - nodeStartFlat);
                if (segmentStart < segmentEnd) { // Ensure there's an actual segment
                    results.push({
                        node: textNode,
                        path: [...currentPath],
                        startOffsetInNode: segmentStart,
                        endOffsetInNode: segmentEnd,
                    });
                }
            }
            currentFlatOffset = nodeEndFlat;
        } else if (currentNode.isLeaf) {
            currentFlatOffset += currentNode.nodeSize;
        } else { // Container node
            if (currentNode !== doc) currentFlatOffset += 1; // Opening tag, unless it's the doc root

            if (currentNode.content) {
                for (let i = 0; i < currentNode.content.length; i++) {
                    if (currentFlatOffset >= toFlat) break;
                    traverse(currentNode.content[i], [...currentPath, i]);
                }
            }
            if (currentNode !== doc) currentFlatOffset += 1; // Closing tag
        }
    }

    traverse(doc, []);
    return results;
}

// New helper for AddMarkStep/RemoveMarkStep
export function replaceNodeInPathWithMany(
    doc: DocNode, // Operate on the whole doc for simplicity of returning new doc
    pathToOriginalNode: number[],
    newNodes: BaseNode[],
    schema: Schema
): DocNode | null {
    if (pathToOriginalNode.length === 0) {
        // Cannot replace the document root itself with multiple nodes directly this way.
        // If newNodes.length === 1, it's a root replacement, otherwise it's invalid.
        if (newNodes.length === 1 && newNodes[0].type === doc.type) {
            return newNodes[0] as DocNode;
        }
        console.error("Cannot replace document root with multiple nodes or a non-doc node.");
        return null;
    }

    const parentPath = pathToOriginalNode.slice(0, -1);
    const childIndexToReplace = pathToOriginalNode[pathToOriginalNode.length - 1];

    let currentParent: BaseNode = doc;
    for(let i=0; i < parentPath.length; i++) {
        const idx = parentPath[i];
        if (!currentParent.content || idx >= currentParent.content.length) return null; // Invalid path
        currentParent = currentParent.content[idx];
    }

    if (!currentParent.content || childIndexToReplace >= currentParent.content.length) return null;

    const newParentContent = [...currentParent.content];
    newParentContent.splice(childIndexToReplace, 1, ...newNodes); // Replace 1 old node with potentially many newNodes

    const newParent = schema.node(currentParent.type, currentParent.attrs, normalizeInlineArray(newParentContent as InlineNode[], schema), currentParent.marks); // Assume normalize if inline

    // Now, we need to reconstruct the document from the root down to this newParent
    if (parentPath.length === 0) { // Parent was doc
        return newParent as DocNode; // This assumes newParent is a DocNode, which is wrong if parentPath was empty.
                                     // If parentPath is empty, newParentContent is list of blocks.
                                     // The node being replaced was a direct child of doc.
    }
    // This needs to use the recursive replaceNodeAtPath logic.
    // replaceNodeAtPath(doc, parentPath_to_parent, index_of_parent_in_grandparent, newParent, schema)
    // This is getting complicated. replaceNodeAtPath needs to be able to replace a node with a *set* of nodes,
    // or we build the new doc from scratch using the modified parent.

    // Simplified: Assume replaceNodeAtPath can take the newParent, and parentPath is path to the node whose content changed.
    // The current replaceNodeAtPath replaces *one node* with *one node*.
    // We need to replace the *parent* of the original node with a new parent that has modified content.
    // So, replaceNodeAtPath(doc, parentPath, 0 (pathIndex for parentPath), newParent, schema)
    // The pathIndex for replaceNodeAtPath needs to be 0 if parentPath is relative to doc.

    // Let's use a simpler recursive cloner for replaceNodeInPathWithMany's effect
    function cloneWithModifiedContent(
        originalNode: BaseNode,
        targetPath: number[], // full path from doc to node whose content is being replaced
        pathIdx: number,
        newContentForTarget: BaseNode[]
    ): BaseNode {
        if (pathIdx === targetPath.length) { // We are at the node whose content gets replaced
            return schema.node(originalNode.type, originalNode.attrs, newContentForTarget, originalNode.marks);
        }
        const currentChildIndex = targetPath[pathIdx];
        const originalChildren = originalNode.content || [];
        const newChildren = [...originalChildren];
        newChildren[currentChildIndex] = cloneWithModifiedContent(originalChildren[currentChildIndex], targetPath, pathIdx + 1, newContentForTarget);
        return schema.node(originalNode.type, originalNode.attrs, newChildren, originalNode.marks);
    }
    if (parentPath.length === 0) { // Replacing content of the doc node itself
         return schema.node(doc.type, doc.attrs, newParentContent) as DocNode;
    }
    return cloneWithModifiedContent(doc, parentPath, 0, newParentContent) as DocNode;
}

// Helper to compare arrays of marks (order independent, attribute sensitive)
export function marksEq(marksA: ReadonlyArray<Mark>, marksB: ReadonlyArray<Mark>): boolean {
    if (marksA === marksB) return true;
    if (marksA.length !== marksB.length) return false;
    return marksA.every(mA => marksB.some(mB => mA.eq(mB))) &&
           marksB.every(mB => marksA.some(mA => mB.eq(mA)));
}

// Helper for AddMarkStep/RemoveMarkStep
export function normalizeMarks(marks: Mark[]): Mark[] {
    // Sort by mark type name to ensure canonical order
    marks.sort((a, b) => a.type.name.localeCompare(b.type.name));
    // Remove duplicate marks (same type and attrs) - Mark.eq handles this
    return marks.filter((mark, index, self) =>
        index === self.findIndex((m) => m.eq(mark))
    );
}


console.log("modelUtils.ts updated with findTextNodesInRange, replaceNodeInPathWithMany, normalizeMarks, marksEq.");
