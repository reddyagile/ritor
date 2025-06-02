// src/domParser.ts

import { Schema, NodeType } from './schema.js';
import { ParseRule, DOMParserInstance } from './schemaSpec.js';
import { DocNode, BaseNode, TextNode, Mark } from './documentModel.js';

const DEBUG_MATCHES_RULE = (globalThis as any).DEBUG_MATCHES_RULE || false;
const DEBUG_PARSE_NODE = (globalThis as any).DEBUG_MATCHES_RULE || false; // Share flag for now

export class DOMParser {
    private schema: Schema;

    constructor(schema: Schema) {
        this.schema = schema;
    }

    public parse(dom: HTMLElement | DocumentFragment): DocNode {
        const content: BaseNode[] = [];
        const children = dom.childNodes;
        const docType = this.schema.topNodeType;
        for (let i = 0; i < children.length; i++) {
            const node = this.parseNode(children[i] as ChildNode, [], docType);
            if (node) {
                if (this.schema.nodes[node.type.name]?.spec.group === 'block' ||
                    (node.isText && !node.isLeaf && (node as TextNode).text.trim() !== '')) {
                    content.push(node);
                } else if (node.isText && !node.isLeaf && (node as TextNode).text.trim() === '') { /* Skip */ }
                else { console.warn(`DOMParser.parse: Node of type '${node.type.name}' (group: ${node.type.spec.group}) is not a block node and was ignored at document root.`); }
            }
        }
        // Check content of the doc node itself before finalizing
        if (!docType.checkContent(content)) {
            console.warn(
                `Schema validation failed for content of root DOC node.`,
                "\nExpected content expression:", docType.contentExpressionString, // Assumes contentExpressionString exists
                "\nParsed content (model nodes):", content.map(n => n.type.name)
            );
        }
        // The main `parse` method ensures the final result is a valid DocNode.
        if (!docType.checkContent(content)) {
             console.warn(
                `Schema validation failed for content of root DOC node.`,
                "\nExpected content expression:", docType.contentExpressionString,
                "\nParsed content (model nodes):", content.map(n => n.type.name)
            );
        }
        return this.schema.node(docType, null, content) as DocNode;
    }

    /**
     * Parses a DOM fragment (e.g., from paste) into an array of BaseNode.
     * This is similar to parse, but doesn't create a full DocNode wrapper,
     * and aims to return a list of nodes suitable for insertion.
     */
    public parseFragment(domFragmentRoot: HTMLElement | DocumentFragment): BaseNode[] {
        const content: BaseNode[] = [];
        const children = domFragmentRoot.childNodes;
        // When parsing a fragment, there isn't a specific model parent type yet.
        // Or, we could pass the type of the node at the insertion point if known.
        // For now, passing 'undefined' for parentModelType, rules with context might not apply optimally.
        // Or, pass docType, assuming fragment content should adhere to general doc rules initially.
        const docType = this.schema.topNodeType;

        for (let i = 0; i < children.length; i++) {
            const node = this.parseNode(children[i] as ChildNode, [], docType); // Use docType as context for fragment's children
            if (node) {
                // Unlike parse(), we don't strictly filter for blocks here,
                // as a fragment might contain valid inline content meant to be inserted.
                // The ReplaceStep will handle whether inline content needs wrapping.
                content.push(node);
            }
        }
        return content;
    }


    private parseNode(domNode: ChildNode, activeMarks: Mark[] = [], parentModelType?: NodeType): BaseNode | null {
        if (domNode.nodeType === Node.TEXT_NODE) {
            const text = domNode.nodeValue || "";
            if (text.trim() === '') return null;
            return this.schema.text(text, activeMarks);
        }
        if (domNode.nodeType !== Node.ELEMENT_NODE) return null;

        const element = domNode as HTMLElement;
        const elementName = element.nodeName.toLowerCase();
        const newActiveMarks = [...activeMarks, ...this.parseMarks(element, parentModelType)];

        for (const nodeTypeName in this.schema.nodes) {
            const nodeType = this.schema.nodes[nodeTypeName];
            if (nodeType.spec.parseDOM) {
                for (const rule of nodeType.spec.parseDOM) {
                    if (DEBUG_PARSE_NODE && (rule.tag?.includes("p.special") || rule.tag === "p")) {
                        console.log(`[PARSE_NODE_TRACE] Checking rule for ${nodeTypeName}: tag="${rule.tag}", context="${rule.context}" against element <${elementName} class="${element.className}"> with parentModelType: ${parentModelType?.name}`);
                    }
                    if (this.matchesRule(element, rule, elementName, parentModelType)) {
                        if (DEBUG_PARSE_NODE && (rule.tag?.includes("p.special") || rule.tag === "p")) console.log(`[PARSE_NODE_TRACE]   Rule MATCHED for ${nodeTypeName}!`);
                        const attrs = rule.getAttrs ? rule.getAttrs(element) : {};
                        if (attrs === false) { if (DEBUG_PARSE_NODE && (rule.tag?.includes("p.special")||rule.tag==="p")) console.log(`[PARSE_NODE_TRACE]     getAttrs returned false, skipping.`); continue; }

                        let content: BaseNode[] = [];
                        if (typeof rule.getContent === 'function') {
                            content = rule.getContent(element, this as DOMParserInstance);
                        } else if (!nodeType.isLeafType && !(nodeType.spec.atom)) { // Use isLeafType
                            for (let i = 0; i < element.childNodes.length; i++) {
                                const childNode = this.parseNode(element.childNodes[i] as ChildNode, newActiveMarks, nodeType); // Pass nodeType as parent for children
                                if (childNode) content.push(childNode);
                            }
                        }

                        // Schema validation for content before creating the node
                        if (!nodeType.isLeafType && !(nodeType.spec.atom)) {
                            const isValidContent = nodeType.checkContent(content);
                            if (!isValidContent) {
                                console.warn(
                                    `Schema validation failed during DOMParser.parseNode for content of node type: ${nodeType.name}.`,
                                    "\nDOM element:", element.outerHTML,
                                    "\nExpected content expression:", nodeType.contentExpressionString, // Assumes contentExpressionString exists
                                    "\nParsed child content (model nodes):", content.map(n => n.type.name)
                                );
                                // PoC: Still attempt to create the node. NodeType.create will also warn.
                            }
                        }

                        const nodeMarks = (nodeType.isTextType || nodeType.isInline) ? newActiveMarks : [];
                        if (nodeType.isTextType) { // Should be NodeType's property
                            // This path should ideally not be hit if text nodes are handled first.
                            // If a rule makes an element parse as a TextNode (e.g. a <pre> tag becoming a single TextNode)
                            return this.schema.text(element.textContent || "", nodeMarks);
                        }
                        try {
                            return this.schema.node(nodeType, attrs, content, nodeMarks.length > 0 ? nodeMarks : undefined);
                        } catch (e) {
                            console.error(`Error creating node ${nodeType.name} from DOM element:`, element, e);
                            return null;
                        }
                    } else {
                         if (DEBUG_PARSE_NODE && (rule.tag?.includes("p.special") || rule.tag === "p")) console.log(`[PARSE_NODE_TRACE]   Rule DID NOT MATCH for ${nodeTypeName}.`);
                    }
                }
            }
        }
        // Fallback for unknown elements: parse children with current marks
        const childrenContent: BaseNode[] = [];
        for (let i = 0; i < element.childNodes.length; i++) {
            const childNode = this.parseNode(element.childNodes[i] as ChildNode, newActiveMarks, parentModelType);
            if (childNode) childrenContent.push(childNode);
        }
        // If this unknown element wrapper resulted in a single block child, promote it.
        if (childrenContent.length === 1 && childrenContent[0].type.isBlock) {
            // console.warn(`DOMParser: Flattened unknown wrapper ${elementName} around block ${childrenContent[0].type.name}`);
            return childrenContent[0];
        }
        // If multiple children or inline children, they can't be returned as a single BaseNode to replace this unknown element.
        // So, this element effectively becomes transparent, its children will be considered by the parent's content model.
        // To achieve this, parseNode should ideally return BaseNode[] | BaseNode | null.
        // For now, returning null means this unknown element itself is skipped, and its children are not re-parented here.
        // The caller (parent parseNode) would have iterated to the next sibling of this 'element'.
        // This means children of unknown/skipped tags are currently dropped unless the schema has a very broad rule.
        return null;
    }

    private parseMarks(element: HTMLElement, parentModelType?: NodeType): Mark[] {
        let marks: Mark[] = [];
        for (const markTypeName in this.schema.marks) {
            const markType = this.schema.marks[markTypeName];
            if (markType.spec.parseDOM) {
                for (const rule of markType.spec.parseDOM) {
                    if (this.matchesRule(element, rule, element.nodeName.toLowerCase(), parentModelType)) {
                        const attrs = rule.getAttrs ? rule.getAttrs(element) : {};
                        if (attrs !== false) marks.push(markType.create(attrs || undefined));
                    }
                }
            }
        }
        return marks;
    }

    public matchesRule(element: HTMLElement, rule: ParseRule, elementName?: string, parentModelType?: NodeType): boolean {
        const elName = elementName || element.nodeName.toLowerCase();
        let tagConditionsMet = false;
        let styleConditionsMet = false;
        let contextCondMet = true;
        let baseTagNameForRule = "";

        const ruleIsRelevantForDebug = DEBUG_PARSE_NODE && (rule.tag === "p.special" || (rule.tag === "p" && elName === "p"));

        if (ruleIsRelevantForDebug) {
            console.log(`[MATCHES_RULE_TRACE] Checking rule: tag="${rule.tag}", context="${rule.context}". Element: <${elName} class="${element.className}">. ParentType: ${parentModelType?.name}.`);
        }

        if (rule.tag) {
            let processedTag = rule.tag; const classListToMatch: string[] = []; const attributesToMatch: { name: string, value?: string }[] = [];
            baseTagNameForRule = "";
            const attrSelectorMatch = processedTag.match(/^(.*?)\[([^=\]]+)(?:=(["']?)([^\]"']+)\3)?\]$/);
            if (attrSelectorMatch) { processedTag = attrSelectorMatch[1]; attributesToMatch.push({ name: attrSelectorMatch[2], value: attrSelectorMatch[4] });}
            if (processedTag.includes('.')) { const parts = processedTag.split('.'); baseTagNameForRule = parts[0]; classListToMatch.push(...parts.slice(1)); }
            else { baseTagNameForRule = processedTag; }
            if (!baseTagNameForRule && (attributesToMatch.length > 0 || classListToMatch.length > 0)) { baseTagNameForRule = "*"; }

            let currentChecksPass = true;
            if (baseTagNameForRule && baseTagNameForRule !== "*" && baseTagNameForRule !== elName) currentChecksPass = false;
            if (currentChecksPass && baseTagNameForRule === "" && rule.tag !== "*" && attributesToMatch.length === 0 && classListToMatch.length === 0) currentChecksPass = false;
            if (currentChecksPass) for (const className of classListToMatch) { if (!element.classList.contains(className)) { currentChecksPass = false; break; }}
            if (currentChecksPass) for (const attr of attributesToMatch) { if (attr.value !== undefined) { if (element.getAttribute(attr.name) !== attr.value) { currentChecksPass = false; break; }} else { if (!element.hasAttribute(attr.name)) { currentChecksPass = false; break; }}}
            if (currentChecksPass) tagConditionsMet = true;
        }

        if (rule.style) {
            const [stylePropFull, styleValExpected] = rule.style.split('=').map(s => s.trim()); let currentStyleCheckPass = false;
            if (styleValExpected) { const stylePropJs = stylePropFull.replace(/-([a-z])/g, (g) => g[1].toUpperCase()); const currentStyleVal = (element.style as any)[stylePropJs]; if (typeof currentStyleVal === "string" && currentStyleVal.trim() === styleValExpected) currentStyleCheckPass = true;
                if (!currentStyleCheckPass) { try { const computedStyle = window.getComputedStyle(element); const currentComputedVal = computedStyle.getPropertyValue(stylePropFull); if (currentComputedVal?.trim() === styleValExpected) currentStyleCheckPass = true; if (!currentStyleCheckPass && (stylePropFull === "font-weight" || stylePropJs === "fontWeight") && styleValExpected === "bold") { if (currentComputedVal === "700" || currentComputedVal === "800" || currentComputedVal === "900") currentStyleCheckPass = true; } if (!currentStyleCheckPass && (stylePropFull === "font-style" || stylePropJs === "fontStyle") && styleValExpected === "italic") { if (currentComputedVal === "oblique") currentStyleCheckPass = true; }} catch (e) { /* console.warn("Could not get computed style:", e); */ }}
            }
            if (currentStyleCheckPass) styleConditionsMet = true;
        }

        if (rule.context) {
            contextCondMet = false;
            if (!parentModelType) { if (ruleIsRelevantForDebug) console.log(`[MATCHES_RULE_TRACE] Rule ${rule.tag} Context check FAIL: no parentModelType.`); }
            else { const contextParts = rule.context.replace(/\/$/, "").split('/'); const requiredDirectParentName = contextParts[contextParts.length - 1]; if (parentModelType.name === requiredDirectParentName) { contextCondMet = true; }
                   else { if (ruleIsRelevantForDebug) console.log(`[MATCHES_RULE_TRACE] Rule ${rule.tag} Context check FAIL: parent "${parentModelType.name}" !== required "${requiredDirectParentName}"`); }
            }
        }

        let finalMatch = false;
        if (rule.tag && rule.style && rule.context) finalMatch = tagConditionsMet && styleConditionsMet && contextCondMet;
        else if (rule.tag && rule.style) finalMatch = tagConditionsMet && styleConditionsMet && contextCondMet;
        else if (rule.tag && rule.context) finalMatch = tagConditionsMet && contextCondMet;
        else if (rule.style && rule.context) finalMatch = styleConditionsMet && contextCondMet;
        else if (rule.tag) finalMatch = tagConditionsMet && contextCondMet;
        else if (rule.style) finalMatch = styleConditionsMet && contextCondMet;
        else if (rule.context) finalMatch = contextCondMet;
        else return false;

        if (ruleIsRelevantForDebug) {
            console.log(`[MATCHES_RULE_TRACE] Rule ${rule.tag}, context ${rule.context || '-'} Final Decision: ${finalMatch}. TagOK: ${tagConditionsMet}(${baseTagNameForRule} vs ${elName}), StyleOK: ${styleConditionsMet}, ContextOK: ${contextCondMet}, ParentType: ${parentModelType?.name}`);
        }
        return finalMatch;
    }
}

console.log("domParser.ts: Integrated NodeType.checkContent call into parseNode.");
