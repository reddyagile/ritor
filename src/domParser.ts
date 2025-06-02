// src/domParser.ts

import { Schema, NodeType } from './schema.js'; 
import { ParseRule, DOMParserInstance } from './schemaSpec.js'; 
import { DocNode, BaseNode, TextNode, Mark, marksEq, normalizeMarks } from './documentModel.js';
import { Slice } from './transform/slice.js'; // For Slice.empty, though not used here directly

const DEBUG_PARSE_NODE = (globalThis as any).DEBUG_MATCHES_RULE || false;

export class DOMParser {
    private schema: Schema;

    constructor(schema: Schema) {
        this.schema = schema;
    }

    public parse(dom: HTMLElement | DocumentFragment): DocNode {
        const parsedResult = this.parseFragment(dom, this.schema.topNodeType);
        const content = parsedResult.nodes; // openStart/End are ignored for full doc parse

        if (!this.schema.topNodeType.checkContent(content)) {
            console.warn(
                `Schema validation failed for content of root DOC node.`,
                "\nExpected content expression:", this.schema.topNodeType.contentExpressionString,
                "\nParsed content (model nodes):", content.map(n => n.type.name)
            );
        }
        return this.schema.node(this.schema.topNodeType, null, content) as DocNode;
    }
    
    public parseFragment(
        domFragmentRoot: HTMLElement | DocumentFragment, 
        parentModelType?: NodeType // Context for parsing fragment children
    ): { nodes: BaseNode[], openStart: number, openEnd: number } {
        const nodes: BaseNode[] = [];
        const children = domFragmentRoot.childNodes;
        const contextType = parentModelType || this.schema.topNodeType; 

        for (let i = 0; i < children.length; i++) {
            const parsedResult = this.parseNode(children[i] as ChildNode, [], contextType);
            if (parsedResult) {
                if (Array.isArray(parsedResult)) nodes.push(...parsedResult);
                else nodes.push(parsedResult);
            }
        }

        let openStart = 0;
        let openEnd = 0;

        // Heuristic for openStart
        if (children.length > 0) {
            let firstSignificantChild: ChildNode | null = null;
            for(let i=0; i < children.length; i++) {
                if(children[i].nodeType === Node.TEXT_NODE && (children[i].nodeValue || "").trim() !== "") { firstSignificantChild = children[i]; break; }
                if(children[i].nodeType === Node.ELEMENT_NODE) { firstSignificantChild = children[i]; break; }
            }

            if (firstSignificantChild) {
                if (firstSignificantChild.nodeType === Node.TEXT_NODE) { // Raw text implies open start
                    openStart = 1;
                } else if (firstSignificantChild.nodeType === Node.ELEMENT_NODE) {
                    const firstElName = (firstSignificantChild as HTMLElement).nodeName.toLowerCase();
                    // If first element is a known mark tag or a generic inline wrapper, or a schema-defined inline node (that isn't also block)
                    if (this.schema.marks[firstElName] ||
                        ['span', 'strong', 'em', 'b', 'i', 's', 'u', 'a', 'code', 'sub', 'sup', 'font', 'strike', 'del'].includes(firstElName) ||
                        (this.schema.nodes[firstElName] && this.schema.nodes[firstElName].isInline && !this.schema.nodes[firstElName].isBlock)
                    ) {
                        openStart = 1;
                    }
                }
            }
        }

        // Heuristic for openEnd
        if (children.length > 0) {
            let lastSignificantChild: ChildNode | null = null;
            for(let i=children.length-1; i >= 0; i--) {
                if(children[i].nodeType === Node.TEXT_NODE && (children[i].nodeValue || "").trim() !== "") { lastSignificantChild = children[i]; break; }
                if(children[i].nodeType === Node.ELEMENT_NODE) { lastSignificantChild = children[i]; break; }
            }
            if (lastSignificantChild) {
                if (lastSignificantChild.nodeType === Node.TEXT_NODE) { // Raw text implies open end
                    openEnd = 1;
                } else if (lastSignificantChild.nodeType === Node.ELEMENT_NODE) {
                    const lastElName = (lastSignificantChild as HTMLElement).nodeName.toLowerCase();
                    if (this.schema.marks[lastElName] ||
                        ['span', 'strong', 'em', 'b', 'i', 's', 'u', 'a', 'code', 'sub', 'sup', 'font', 'strike', 'del'].includes(lastElName) ||
                        (this.schema.nodes[lastElName] && this.schema.nodes[lastElName].isInline && !this.schema.nodes[lastElName].isBlock)
                    ) {
                        openEnd = 1;
                    }
                }
            }
        }
        
        // If the fragment consists of only inline nodes (or text nodes), it's likely open on both sides.
        // However, if it's a single block node (e.g. pasting just a paragraph), it's closed.
        if (nodes.length > 0 && nodes.every(n => n.isText || (n.type.isInline && !n.type.isBlock))) {
            // This is already covered by individual first/last child checks.
            // If it's all inline, openStart and openEnd would likely both be 1.
        } else if (nodes.length === 1 && nodes[0].type.isBlock) {
            // If the entire fragment is a single block node, it's considered "closed" at its own boundaries.
            // The internal content of this block might be open, but that's not what slice.openStart/End means here.
            openStart = 0;
            openEnd = 0;
        }
        // If nodes is empty, openStart/End remain 0.

        return { nodes, openStart, openEnd };
    }

    private parseNode(domNode: ChildNode, activeMarks: Mark[] = [], parentModelType?: NodeType): BaseNode | BaseNode[] | null {
        // ... (rest of parseNode method from previous correct version)
        if (domNode.nodeType === Node.TEXT_NODE) {
            const text = domNode.nodeValue || "";
            if (text.trim() === '' && activeMarks.length === 0) return null; 
            return this.schema.text(text, normalizeMarks(activeMarks)); 
        }
        if (domNode.nodeType !== Node.ELEMENT_NODE) return null; 

        const element = domNode as HTMLElement;
        const elementName = element.nodeName.toLowerCase();
        
        const marksFromThisElement = this.parseMarks(element, parentModelType);
        const currentEffectiveMarks = normalizeMarks([...activeMarks, ...marksFromThisElement]);

        for (const nodeTypeName in this.schema.nodes) {
            const nodeType = this.schema.nodes[nodeTypeName];
            if (nodeType.spec.parseDOM) {
                for (const rule of nodeType.spec.parseDOM) {
                    if (DEBUG_PARSE_NODE && (rule.tag?.includes("p.special") || rule.tag === "p" || rule.tag?.includes("h"))) { 
                        console.log(`[PARSE_NODE_TRACE] Checking NodeType ${nodeTypeName} rule: tag="${rule.tag}", context="${rule.context}" against <${elementName} class="${element.className}"> with parentModelType: ${parentModelType?.name}`);
                    }
                    if (this.matchesRule(element, rule, elementName, parentModelType)) {
                        if (DEBUG_PARSE_NODE && (rule.tag?.includes("p.special") || rule.tag === "p"|| rule.tag?.includes("h"))) console.log(`[PARSE_NODE_TRACE]   Rule MATCHED for ${nodeTypeName}!`);
                        const attrs = rule.getAttrs ? rule.getAttrs(element) : {};
                        if (attrs === false) { if (DEBUG_PARSE_NODE && (rule.tag?.includes("p.special")||rule.tag==="p"|| rule.tag?.includes("h"))) console.log(`[PARSE_NODE_TRACE]     getAttrs returned false, skipping.`); continue; }

                        let parsedChildren: BaseNode[] = [];
                        if (typeof rule.getContent === 'function') {
                            parsedChildren = rule.getContent(element, this as DOMParserInstance); 
                        } else if (!nodeType.isLeafType) {
                            for (let i = 0; i < element.childNodes.length; i++) {
                                const childResult = this.parseNode(element.childNodes[i] as ChildNode, currentEffectiveMarks, nodeType);
                                if (childResult) {
                                    if (Array.isArray(childResult)) parsedChildren.push(...childResult);
                                    else parsedChildren.push(childResult);
                                }
                            }
                        }
                        
                        if (!nodeType.isLeafType) { 
                            if (!nodeType.checkContent(parsedChildren)) {
                                console.warn( `Schema validation failed during DOMParser.parseNode for content of node type: ${nodeType.name}.`, "\nDOM element:", element.outerHTML, "\nExpected content expression:", nodeType.contentExpressionString, "\nParsed child content (model nodes):", parsedChildren.map(n => n.type.name));
                            }
                        }
                        
                        if (nodeType.isTextType) { 
                            return this.schema.text(element.textContent || "", currentEffectiveMarks);
                        }
                        return this.schema.node(nodeType, attrs, parsedChildren);
                    } else {
                         if (DEBUG_PARSE_NODE && (rule.tag?.includes("p.special") || rule.tag === "p" || rule.tag?.includes("h"))) console.log(`[PARSE_NODE_TRACE]   Rule DID NOT MATCH for ${nodeTypeName}.`);
                    }
                }
            }
        }
        
        const childrenContent: BaseNode[] = [];
        for (let i = 0; i < element.childNodes.length; i++) {
            const childResult = this.parseNode(element.childNodes[i] as ChildNode, currentEffectiveMarks, parentModelType);
            if (childResult) {
                if (Array.isArray(childResult)) childrenContent.push(...childResult);
                else childrenContent.push(childResult);
            }
        }
        
        if (marksFromThisElement.length > 0 && activeMarks.length === marksFromThisElement.reduce((l,m)=> l + (activeMarks.find(am => am.eq(m))?1:0) ,0) ) {
             if (DEBUG_PARSE_NODE) console.log(`[PARSE_NODE_TRACE] Fallback: Element ${elementName} was unknown as a node, but contributed marks. Returning its parsed children [${childrenContent.map(c=>c.type.name).join(', ')}].`);
            return childrenContent.length > 0 ? childrenContent : null;
        }
        if (childrenContent.length === 1 && childrenContent[0].type.isBlock) {
            if (DEBUG_PARSE_NODE) console.log(`[PARSE_NODE_TRACE] Fallback: Flattened unknown wrapper ${elementName} around single block child ${childrenContent[0].type.name}.`);
            return childrenContent[0];
        }
        if (childrenContent.length > 0 && DEBUG_PARSE_NODE) {
             console.warn(`[PARSE_NODE_TRACE] Fallback: Element ${elementName} was unknown and had multiple/inline children [${childrenContent.map(c=>c.type.name).join(', ')}]. These children might be dropped if parent doesn't accept array.`);
        }
        return childrenContent.length > 0 ? childrenContent : null;
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
        return normalizeMarks(marks); 
    }

    public matchesRule(element: HTMLElement, rule: ParseRule, elementName?: string, parentModelType?: NodeType): boolean { 
        const elName = elementName || element.nodeName.toLowerCase(); 
        let tagConditionsMet = false; let styleConditionsMet = false; let contextCondMet = true; let baseTagNameForRule = ""; 
        const ruleIsRelevantForDebug = DEBUG_PARSE_NODE && (rule.tag === "p.special" || (rule.tag === "p" && elName === "p") || rule.tag?.includes("h"));
        if (ruleIsRelevantForDebug) { console.log(`[MATCHES_RULE_TRACE] Checking rule: tag="${rule.tag}", context="${rule.context}". Element: <${elName} class="${element.className}">. ParentType: ${parentModelType?.name}.`);}
        if (rule.tag) {
            let processedTag = rule.tag; const classListToMatch: string[] = []; const attributesToMatch: { name: string, value?: string }[] = []; baseTagNameForRule = ""; 
            const attrSelectorMatch = processedTag.match(/^(.*?)\[([^=\]]+)(?:=(["']?)([^\]"']+)\3)?\]$/);
            if (attrSelectorMatch) { processedTag = attrSelectorMatch[1]; attributesToMatch.push({ name: attrSelectorMatch[2], value: attrSelectorMatch[4] });}
            if (processedTag.includes('.')) { const parts = processedTag.split('.'); baseTagNameForRule = parts[0]; classListToMatch.push(...parts.slice(1)); } else { baseTagNameForRule = processedTag; }
            if (!baseTagNameForRule && (attributesToMatch.length > 0 || classListToMatch.length > 0)) { baseTagNameForRule = "*"; }
            let currentChecksPass = true; if (baseTagNameForRule && baseTagNameForRule !== "*" && baseTagNameForRule !== elName) currentChecksPass = false;
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
        if (ruleIsRelevantForDebug) { console.log(`[MATCHES_RULE_TRACE] Rule ${rule.tag}, context ${rule.context || '-'} Final Decision: ${finalMatch}. TagOK: ${tagConditionsMet}(${baseTagNameForRule} vs ${elName}), StyleOK: ${styleConditionsMet}, ContextOK: ${contextCondMet}, ParentType: ${parentModelType?.name}`); }
        return finalMatch;
    }
}

console.log("domParser.ts: parseFragment returns {nodes, openStart, openEnd}; parse uses it.");
