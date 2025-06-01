// src/modelUtils.ts

import { DocNode, BaseNode, TextNode, InlineNode } from './documentModel.js';
import { ModelPosition } from './selection.js';
import { Schema } from './schema.js'; // Added Schema import

/**
 * Normalizes an array of inline nodes, merging adjacent TextNodes with the same marks
 * and removing empty TextNodes.
 * @param inlineNodes Array of inline nodes.
 * @returns A new array with normalized inline nodes.
 */
export function normalizeInlineArray(inlineNodes: ReadonlyArray<InlineNode>): InlineNode[] {
    if (!inlineNodes || inlineNodes.length === 0) {
        return [];
    }
    const result: InlineNode[] = [];
    let lastNode: InlineNode | null = null;
    for (const node of inlineNodes) {
        if (lastNode && lastNode.isText && !lastNode.isLeaf && node.isText && !node.isLeaf &&
            lastNode.marks === node.marks) {
            const mergedText = (lastNode as TextNode).text + (node as TextNode).text;
            if (mergedText) {
                // Assuming node.type has a reference to the schema to create new nodes
                const newTextNode = node.type.schema.text(mergedText, lastNode.marks) as TextNode;
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
    // schema parameter is available for future use if needed for more complex type checking or node creation
    let flatOffset = 0;
    let currentParentNode: BaseNode = doc;
    let currentChildrenInNode: ReadonlyArray<BaseNode> = doc.content || [];

    for (let i = 0; i < position.path.length; i++) {
        const childIndexInList = position.path[i];
        if (childIndexInList < 0 || childIndexInList >= currentChildrenInNode.length) {
            throw new Error(`Invalid path in ModelPosition: index ${childIndexInList} out of bounds at depth ${i}. Path: ${position.path.join(',')}`);
        }

        for (let j = 0; j < childIndexInList; j++) {
            flatOffset += currentChildrenInNode[j].nodeSize;
        }

        const targetChildNode = currentChildrenInNode[childIndexInList];

        if (!targetChildNode.isText && !targetChildNode.isLeaf) { // Container node opening tag
            flatOffset += 1;
        }

        if (targetChildNode.isLeaf && i < position.path.length - 1) {
            throw new Error(`Invalid path: cannot descend into leaf node ${targetChildNode.type.name} at path segment ${i}`);
        }

        currentParentNode = targetChildNode;
        currentChildrenInNode = targetChildNode.content || [];
    }

    if (currentParentNode.isText && !currentParentNode.isLeaf) {
        const textNode = currentParentNode as TextNode;
        if (position.offset < 0 || position.offset > textNode.text.length) {
            throw new Error(`Invalid offset ${position.offset} for TextNode with length ${textNode.text.length}`);
        }
        flatOffset += position.offset;
    } else if (!currentParentNode.isLeaf) {
        const contentOfParent = currentParentNode.content || [];
        if (position.offset < 0 || position.offset > contentOfParent.length) {
            throw new Error(`Invalid offset ${position.offset} for ElementNode with ${contentOfParent.length} children`);
        }
        for (let k = 0; k < position.offset; k++) {
            flatOffset += contentOfParent[k].nodeSize;
        }
    } else {
        if (position.offset !== 0 && !(position.offset === 1 && currentParentNode.nodeSize === 1) ) {
            // For leaf node, offset 0 is "at start", offset 1 can mean "at end" or "after" if nodeSize is 1.
            // console.warn(`Offset for a leaf node ${currentParentNode.type.name} is ${position.offset}.`);
        }
        if (position.offset === 1 && currentParentNode.nodeSize === 1) {
            // This interpretation means "after the leaf node".
            // The flatOffset is currently *before* the leaf node's own span.
            // Adding nodeSize makes it after. But this is usually handled by path to parent, index after child.
            // For now, if path points to leaf, offset is within its span (0 for start, 1 for end of a size 1 leaf)
            // flatOffset += position.offset; // This would make offset 1 on a BR add 1 to flatOffset.
        } else if (position.offset !== 0) {
            // console.warn(`Offset for a leaf node ${currentParentNode.type.name} is ${position.offset}, usually expected to be 0.`);
        }
    }
    return flatOffset;
}

export function flatOffsetToModelPosition(doc: DocNode, targetFlatOffset: number, schema?: Schema): ModelPosition {
    // schema parameter is available for future use
    if (targetFlatOffset < 0 || targetFlatOffset > doc.nodeSize) {
        throw new Error(`flatOffset ${targetFlatOffset} is out of bounds for document of size ${doc.nodeSize}`);
    }

    const path: number[] = [];
    let currentElement: BaseNode = doc;
    let currentRemainingOffset = targetFlatOffset;

    // eslint-disable-next-line no-constant-condition
    while (true) {
        if (currentElement.isText && !currentElement.isLeaf) {
            if (currentRemainingOffset < 0 || currentRemainingOffset > currentElement.nodeSize) {
                 throw new Error(`Calculated offset ${currentRemainingOffset} is out of bounds for text node of size ${currentElement.nodeSize}`);
            }
            return { path, offset: currentRemainingOffset };
        }
        if (currentElement.isLeaf) {
             if (currentRemainingOffset < 0 || currentRemainingOffset > currentElement.nodeSize ) {
                throw new Error(`Calculated offset ${currentRemainingOffset} is out of bounds for leaf node ${currentElement.type.name} of size ${currentElement.nodeSize}`);
             }
            return { path, offset: currentRemainingOffset };
        }

        const children = currentElement.content || [];
        let childIndex = 0;
        let foundChildToDescend = false;

        for (childIndex = 0; childIndex < children.length; childIndex++) {
            const child = children[childIndex];
            const childNodeSize = child.nodeSize;

            if (child.isText || child.isLeaf) {
                if (currentRemainingOffset < childNodeSize) {
                    path.push(childIndex);
                    return { path, offset: currentRemainingOffset };
                } else if (currentRemainingOffset === childNodeSize) {
                    path.push(childIndex);
                    return { path, offset: childNodeSize };
                } else {
                    currentRemainingOffset -= childNodeSize;
                }
            } else { // Container child
                if (currentRemainingOffset === 0) {
                    return { path, offset: childIndex };
                }
                if (currentRemainingOffset < 1) {
                    throw new Error(`Invalid flat offset: points within the opening tag of container ${child.type.name}. Offset: ${currentRemainingOffset}, Child: ${child.type.name}`);
                }
                if (currentRemainingOffset < childNodeSize) {
                    path.push(childIndex);
                    currentElement = child;
                    currentRemainingOffset -= 1;
                    foundChildToDescend = true;
                    break;
                } else {
                    currentRemainingOffset -= childNodeSize;
                }
            }
        }

        if (!foundChildToDescend) {
            return { path, offset: children.length };
        }
    }
}

console.log("modelUtils.ts updated to accept schema param (though not deeply used yet) and previous test fixes.");
