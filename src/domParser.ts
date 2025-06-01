import { Schema, NodeType, MarkType } from './schema.js';
import { ParseRule, Attrs } from './schemaSpec.js';
// BaseNode, TextNode, Mark are all in documentModel.ts.
// Assuming Mark might be needed later for inline parsing.
import { BaseNode, Mark } from './documentModel.js';

export class DOMParser {
    constructor(public schema: Schema) {}

    // Parses a DOM node (usually DocumentFragment or an Element)
    // and returns an array of top-level model nodes found.
    public parseSlice(dom: globalThis.Node): BaseNode[] {
        const modelNodes: BaseNode[] = [];
        // If dom is DocumentFragment, its children are the top level.
        // If dom is an Element, its children are typically the top level for a slice.
        const children = dom.childNodes;

        for (let i = 0; i < children.length; i++) {
            const childDomNode = children[i];
            const nodeOrNodes = this.parseNode(childDomNode); // parseNode might return single or array
            if (nodeOrNodes) {
                if (Array.isArray(nodeOrNodes)) {
                    modelNodes.push(...nodeOrNodes);
                } else {
                    modelNodes.push(nodeOrNodes);
                }
            }
        }
        return modelNodes;
    }

    // Tries to parse a single DOM node into one or more model nodes.
    // `activeMarks` is passed down for inline content.
    private parseNode(domNode: globalThis.Node, activeMarks: Mark[] = []): BaseNode | BaseNode[] | null {
        if (domNode.nodeType === Node.TEXT_NODE) {
            const textContent = domNode.textContent || "";
            return textContent ? this.schema.text(textContent, [...activeMarks]) : null;
        }

        if (domNode.nodeType !== Node.ELEMENT_NODE) {
            return null; // Skip comments, processing instructions, etc.
        }

        const element = domNode as HTMLElement;
        const elementName = element.nodeName.toLowerCase();

        // Try to find a matching NodeSpec rule for block or leaf inline nodes (like hard_break)
        for (const nodeTypeName in this.schema.nodes) {
            const nodeType = this.schema.nodes[nodeTypeName];
            if (nodeType.spec.parseDOM) {
                for (const rule of nodeType.spec.parseDOM) {
                    if (this.matchesRule(element, rule, elementName)) {
                        const attrs = rule.getAttrs ? rule.getAttrs(element) : {};
                        if (attrs === false) continue;

                        let content: BaseNode[] = [];
                        if (rule.getContent) {
                            content = rule.getContent(element, this);
                        } else if (!nodeType.isLeaf && !nodeType.spec.atom) {
                            // Determine if content should be parsed as inline or block
                            // Heuristic: if nodeType.spec.content includes "inline" or "text", parse as inline.
                            // This is a simplification; a full content expression parser would be more robust.
                            if (nodeType.spec.content?.match(/inline|text/i)) {
                                content = this.parseInlineContent(element, []); // Start with fresh marks for content of a new block
                            } else { // Assumed block content (e.g., list_item for list, block for blockquote)
                                content = this.parseSlice(element);
                            }
                        }

                        try {
                            const finalContent = (nodeType.isLeaf || nodeType.spec.atom) ? (nodeType.spec.content ? content : []) : content;
                            return nodeType.create(attrs || undefined, finalContent);
                        } catch (e) {
                            console.warn(`Error creating node ${nodeType.name} from DOM:`, e, element, attrs, content);
                            return null;
                        }
                    }
                }
            }
        }

        // If no NodeSpec rule matched, it might be an element that purely defines marks (handled in parseInlineContent)
        // or an unknown/unwanted element. If called from parseSlice (top level), these will be ignored.
        // If called from parseInlineContent, that function will handle it.
        // For now, if parseNode is called and no NodeSpec matches, we don't create a node.
        // console.warn("DOMParser.parseNode: No NodeSpec rule found for element:", element);
        return null;
    }

    private parseInlineContent(domParent: HTMLElement, initialActiveMarks: Mark[] = []): BaseNode[] {
        const inlineNodes: BaseNode[] = [];
        for (let i = 0; i < domParent.childNodes.length; i++) {
            const childDomNode = domParent.childNodes[i];
            let matchedMark = false;

            if (childDomNode.nodeType === Node.ELEMENT_NODE) {
                const element = childDomNode as HTMLElement;
                const elementName = element.nodeName.toLowerCase();

                // Check for MarkSpecs
                for (const markTypeName in this.schema.marks) {
                    const markType = this.schema.marks[markTypeName];
                    if (markType.spec.parseDOM) {
                        for (const rule of markType.spec.parseDOM) {
                            if (this.matchesRule(element, rule, elementName)) {
                                const markAttrs = rule.getAttrs ? rule.getAttrs(element) : {};
                                if (markAttrs === false) continue;

                                const newMark = markType.create(markAttrs || undefined);
                                // Recursively parse content with the new mark active
                                const nestedContent = this.parseInlineContent(element, [...initialActiveMarks, newMark]);
                                inlineNodes.push(...nestedContent);
                                matchedMark = true;
                                break;
                            }
                        }
                    }
                    if (matchedMark) break;
                }
            }

            if (!matchedMark) { // If not a mark-defining element, parse as a regular node (text, hard_break, or unknown)
                const modelNodeOrNodes = this.parseNode(childDomNode, [...initialActiveMarks]); // Pass activeMarks
                if (modelNodeOrNodes) {
                    if (Array.isArray(modelNodeOrNodes)) inlineNodes.push(...modelNodeOrNodes);
                    else inlineNodes.push(modelNodeOrNodes);
                }
            }
        }
        // TODO: Normalize: e.g. merge adjacent text nodes with same marks (use ModelUtils)
        return inlineNodes;
    }

    private matchesRule(element: HTMLElement, rule: ParseRule, elementNameIfKnown?: string): boolean {
        const elementName = elementNameIfKnown || element.nodeName.toLowerCase();
        if (rule.tag) {
            const tagName = rule.tag.split('[')[0].split('.')[0];
            if (tagName !== "*" && tagName !== elementName) return false;

            // TODO: Add attribute/class checks for more specific selectors in rule.tag
            // e.g., if rule.tag is "a[href]", check for href attribute.
            // if (rule.tag.includes('[')) { ... }
        } else if (rule.style) {
            const [styleProp, styleValue] = rule.style.split('=');
            if (!styleProp || !styleValue) return false; // Invalid style rule format
            // Important: getPropertyValue might return empty string if not set, ensure it matches expected styleVal
            // For example, bold might be "bold" or "700". Rule should be specific.
            if (element.style.getPropertyValue(styleProp.trim()) !== styleValue.trim()) return false;
        } else {
            return false; // Rule must have at least a tag or style to match
        }
        return true;
    }
}

console.log("DOMParser class defined.");
// Basic Test (conceptual, run in browser with RitorVDOM setup)
/*
const schema = new Schema({ nodes: basicNodeSpecs, marks: basicMarkSpecs }); // Assuming basicNodeSpecs imported
const parser = new DOMParser(schema);
const tempDiv = document.createElement('div');
tempDiv.innerHTML = "<p>Hello</p><h1>World</h1><ul><li>Test</li></ul>";
const modelNodes = parser.parseSlice(tempDiv);
console.log("Parsed Model Nodes (conceptual test):", modelNodes);
// Expected: [ParagraphNode, HeadingNode, BulletListNode containing ListItemNode]
*/
