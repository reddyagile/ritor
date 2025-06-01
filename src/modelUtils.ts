// src/modelUtils.ts

import { DocNode, BaseNode, TextNode, InlineNode } from './documentModel.js';
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
            lastNode.marks === node.marks) { // Simple mark comparison by reference for PoC
            const mergedText = (lastNode as TextNode).text + (node as TextNode).text;
            if (mergedText) {
                const currentSchema = schema || node.type.schema; // Prefer passed schema, fallback to node's
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
            // console.warn(`Offset for a leaf node ${currentParentNode.type.name} is ${position.offset}.`);
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

/**
 * Retrieves a node from the document model at a specific path.
 * @param doc The root document node.
 * @param path An array of numbers representing the path to the node. Each number is an index into the content array.
 * @returns The node at the given path, or null if the path is invalid.
 */
export function nodeAtPath(doc: BaseNode, path: number[]): BaseNode | null {
    let current: BaseNode | null = doc;
    for (let i = 0; i < path.length; i++) {
        const index = path[i];
        if (!current || !current.content || index < 0 || index >= current.content.length) {
            return null; // Path is invalid or node has no content at this level
        }
        current = current.content[index];
    }
    return current;
}

/**
 * Immutably replaces a node at a given path in the document tree.
 * @param currentDoc The current document node (or any parent node in the recursion).
 * @param path The path to the node to be replaced, relative to `currentDoc`.
 * @param newNode The new node to insert at the path.
 * @param schema The schema, used to create new parent nodes.
 * @returns The new document root (or new parent node in recursion), or null if path is invalid.
 */
export function replaceNodeAtPath(
    currentParentNode: BaseNode,
    path: number[],
    pathIndex: number,
    newNode: BaseNode,
    schema: Schema
): BaseNode | null {
    if (pathIndex >= path.length) { // Should not happen if path is to the node itself, not a child
        throw new Error("Path index out of bounds, path should lead to the node to replace, not its children.");
    }

    const childIndexToReplace = path[pathIndex];
    let newContent: BaseNode[];

    if (!currentParentNode.content || childIndexToReplace < 0 || childIndexToReplace >= currentParentNode.content.length) {
        console.error("Invalid path or content for replacement:", currentParentNode, path, childIndexToReplace);
        return null; // Invalid path
    }

    newContent = [...currentParentNode.content];

    if (pathIndex === path.length - 1) { // This is the direct parent of the node to replace
        newContent[childIndexToReplace] = newNode;
    } else { // We need to go deeper
        const childNode = currentParentNode.content[childIndexToReplace];
        if (childNode.isLeaf || !childNode.content) {
            console.error("Cannot replace node in path: child is a leaf or has no content, but path is longer.", childNode, path, pathIndex);
            return null; // Path tries to go into a leaf or childless node
        }
        const updatedChild = replaceNodeAtPath(childNode, path, pathIndex + 1, newNode, schema);
        if (!updatedChild) return null;
        newContent[childIndexToReplace] = updatedChild;
    }

    // Use the original node's type and attributes, but with the new content.
    // The schema's node method will recalculate nodeSize etc.
    return schema.node(currentParentNode.type, currentParentNode.attrs, newContent, currentParentNode.marks);
}


console.log("modelUtils.ts updated with nodeAtPath and replaceNodeAtPath helpers.");
