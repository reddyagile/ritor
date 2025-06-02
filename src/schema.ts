// src/schema.ts
import { NodeSpec, MarkSpec, Attrs, DOMOutputSpec } from './schemaSpec.js';
import { BaseNode as ModelNode, TextNode as ModelTextNode, AnyMark as ModelAnyMark, attrsEq } from './documentModel.js';

export interface ContentMatcherElement {
  type: 'name' | 'group';
  value: string;
  min: number;
  max: number;
  isChoice?: boolean;
  options?: string[];
}

function parseContentExpression(expression: string, schema: Schema): ContentMatcherElement[] {
    const elements: ContentMatcherElement[] = [];
    if (!expression.trim()) return elements;

    const parts = expression.match(/(\([^)]+\)[?*+]?|\S+[?*+]?)/g) || [];

    for (let part of parts) {
        let min = 1, max = 1;
        const lastChar = part.slice(-1);
        if (['*', '+', '?'].includes(lastChar)) {
            part = part.slice(0, -1);
            if (lastChar === '*') { min = 0; max = Infinity; } // Corrected
            else if (lastChar === '+') { min = 1; max = Infinity; } // Corrected
            else if (lastChar === '?') { min = 0; max = 1; }
        }

        if (part.startsWith('(') && part.endsWith(')')) { 
            const groupContent = part.slice(1, -1);
            const options = groupContent.split(/\s*\|\s*/).map(s => s.trim()).filter(s => s);
            if (options.length > 0) {
                elements.push({
                    type: 'group', 
                    value: `choice(${options.join('|')})`, 
                    min, max, isChoice: true, options: options 
                });
            }
        } else { 
            // Check against schema.groups *after* schema construction is complete.
            // During NodeType construction, schema.groups might not be fully populated yet.
            // This is why _finalizeContentMatcher is important.
            const type = schema.nodes[part] ? 'name' : (schema.groups.get(part) ? 'group' : 'name'); 
            elements.push({ type, value: part, min, max });
        }
    }
    return elements;
}


export class NodeType {
  public contentMatcher!: ContentMatcherElement[]; // Definite assignment via _finalizeContentMatcher
  public readonly allowedMarks: Set<string> | null; 
  public readonly contentExpressionString: string; // Made public for logging

  constructor(
    public readonly name: string,
    public readonly spec: NodeSpec,
    public readonly schema: Schema 
  ) {
    this.contentExpressionString = spec.content || "";
    // this.contentMatcher is initialized by _finalizeContentMatcher() by the Schema constructor
    
    if (spec.marks === "_") this.allowedMarks = null; 
    else if (spec.marks === "" || !spec.marks) this.allowedMarks = new Set(); 
    else this.allowedMarks = new Set(spec.marks.split(" "));
  }

  // Called by Schema constructor after all NodeTypes and groups are initialized
  _finalizeContentMatcher(): void {
    this.contentMatcher = parseContentExpression(this.contentExpressionString, this.schema);
  }

  get isInline(): boolean { return !!this.spec.inline; }
  get isBlock(): boolean { return !this.spec.inline && this.name !== 'text'; }
  get isTextType(): boolean { return this.name === 'text'; }
  get isLeafType(): boolean { return !!this.spec.atom; }    
  get isTextBlock(): boolean { return !!this.spec.content && (this.spec.content.includes("inline") || this.spec.content.includes("text")); }

  checkContent(content: ReadonlyArray<ModelNode>): boolean {
    const DEBUG_CHECK_CONTENT = (globalThis as any).DEBUG_CHECK_CONTENT || false;
    if (DEBUG_CHECK_CONTENT) console.log(`[checkContent] Node: ${this.name}, Content to check: [${content.map(n=>n.type.name).join(', ')}], Matcher: ${JSON.stringify(this.contentMatcher)}`);

    if (this.isLeafType) {
        const result = content.length === 0;
        if (DEBUG_CHECK_CONTENT) console.log(`[checkContent]   Node type ${this.name} is atom (leaf). Content length ${content.length}. Result: ${result}`);
        return result;
    }
    if (!this.contentMatcher || this.contentMatcher.length === 0) { // Check if contentMatcher is defined
        const result = content.length === 0;
        if (DEBUG_CHECK_CONTENT) console.log(`[checkContent]   Node type ${this.name} has empty/undefined matcher. Content length ${content.length}. Result: ${result}`);
        return result;
    }

    let contentIndex = 0;
    for (const matcher of this.contentMatcher) {
        let matchCount = 0;
        if (DEBUG_CHECK_CONTENT) console.log(`[checkContent]   Matcher: ${JSON.stringify(matcher)}, min: ${matcher.min}, max: ${matcher.max}`);
        
        while (contentIndex < content.length) {
            const currentNode = content[contentIndex];
            let nodeMatchesCurrentMatcher = false;
            if (DEBUG_CHECK_CONTENT) console.log(`[checkContent]     contentIndex: ${contentIndex}, currentNode: ${currentNode.type.name} (isText: ${currentNode.isText}, isBlock: ${currentNode.type.isBlock}, group: ${currentNode.type.spec.group}), matchCount: ${matchCount}`);

            if (matcher.isChoice && matcher.options) {
                if (DEBUG_CHECK_CONTENT) console.log(`[checkContent]       Checking choice: ${matcher.options.join('|')}`);
                for (const option of matcher.options) {
                    const optionIsNodeName = !!this.schema.nodes[option];
                    
                    if (option === 'text' && currentNode.isText) { nodeMatchesCurrentMatcher = true; if (DEBUG_CHECK_CONTENT) console.log(`[checkContent]         Option ${option} (conceptual group text) MATCHED`); break; }
                    else if (option === 'inline' && (currentNode.type.isInline || currentNode.isText)) { nodeMatchesCurrentMatcher = true; if (DEBUG_CHECK_CONTENT) console.log(`[checkContent]         Option ${option} (conceptual group inline) MATCHED`); break; }
                    else if (option === 'block' && currentNode.type.isBlock) { nodeMatchesCurrentMatcher = true; if (DEBUG_CHECK_CONTENT) console.log(`[checkContent]         Option ${option} (conceptual group block) MATCHED`); break; }
                    else if (optionIsNodeName && currentNode.type.name === option) { nodeMatchesCurrentMatcher = true; if (DEBUG_CHECK_CONTENT) console.log(`[checkContent]         Option ${option} (name) MATCHED`); break;
                    } else if (this.schema.groups.has(option) && currentNode.type.spec.group?.includes(option)) { 
                        nodeMatchesCurrentMatcher = true; if (DEBUG_CHECK_CONTENT) console.log(`[checkContent]         Option ${option} (schema group ${currentNode.type.spec.group}) MATCHED`); break;
                    }
                }
                if (!nodeMatchesCurrentMatcher && DEBUG_CHECK_CONTENT) console.log(`[checkContent]       Choice did NOT MATCH any option for ${currentNode.type.name}`);
            } else if (matcher.type === 'name') {
                if (currentNode.type.name === matcher.value) nodeMatchesCurrentMatcher = true;
            } else if (matcher.type === 'group') {
                if (matcher.value === 'text' && currentNode.isText) nodeMatchesCurrentMatcher = true;
                else if (matcher.value === 'inline' && (currentNode.type.isInline || currentNode.isText)) nodeMatchesCurrentMatcher = true; // text implies inline
                else if (matcher.value === 'block' && currentNode.type.isBlock) nodeMatchesCurrentMatcher = true;
                else if (currentNode.type.spec.group?.includes(matcher.value)) nodeMatchesCurrentMatcher = true;
            }

            if (nodeMatchesCurrentMatcher) {
                if (DEBUG_CHECK_CONTENT) console.log(`[checkContent]       Node ${currentNode.type.name} MATCHED matcher ${matcher.value || JSON.stringify(matcher.options)}`);
                matchCount++;
                contentIndex++;
                if (matchCount >= matcher.max) { if (DEBUG_CHECK_CONTENT) console.log(`[checkContent]         Match count ${matchCount} reached max ${matcher.max}. Breaking from content loop.`); break; }
            } else {
                if (DEBUG_CHECK_CONTENT) console.log(`[checkContent]       Node ${currentNode.type.name} did NOT MATCH matcher ${matcher.value || JSON.stringify(matcher.options)}. Breaking from content loop.`);
                break; 
            }
        }

        if (matchCount < matcher.min) {
            if (DEBUG_CHECK_CONTENT) console.log(`[checkContent]   Matcher ${matcher.value || JSON.stringify(matcher.options)} FAILED: matchCount ${matchCount} < min ${matcher.min}. Final Result: false`);
            return false; 
        }
        if (DEBUG_CHECK_CONTENT) console.log(`[checkContent]   Matcher ${matcher.value || JSON.stringify(matcher.options)} PASSED: matchCount ${matchCount} >= min ${matcher.min}`);
    }

    if (DEBUG_CHECK_CONTENT) console.log(`[checkContent] Node: ${this.name}. All matchers processed. contentIndex: ${contentIndex}, content.length: ${content.length}. Final Result: ${contentIndex === content.length}`);
    return contentIndex === content.length;
  }

  public allowsMarkType(markType: MarkType | string): boolean { if (this.allowedMarks === null) return true; const markName = typeof markType === 'string' ? markType : markType.name; return this.allowedMarks.has(markName); }
  
  public create(attrs?: Attrs, contentParam?: ReadonlyArray<ModelNode> | ModelNode, _marks?: ReadonlyArray<ModelAnyMark>): ModelNode { 
    if (this.isTextType) throw new Error("Cannot use NodeType.create() for text nodes; use Schema.text() instead.");
    let finalAttrs = this.defaultAttrs(attrs);
    if (this.isBlock && (!finalAttrs || finalAttrs.id === undefined)) { finalAttrs = { ...finalAttrs, id: this.schema.generateNodeId() }; }
    const finalContentArray = Array.isArray(contentParam) ? contentParam : (contentParam ? [contentParam] : []);
    if (!this.checkContent(finalContentArray)) { console.warn(`Invalid content for node type ${this.name}: [${finalContentArray.map(n => n.type.name).join(', ')}] based on expression "${this.spec.content}".`);}
    let calculatedContentSize = 0; for (const child of finalContentArray) calculatedContentSize += child.nodeSize; 
    let calculatedNodeSize: number;
    if (this.name === this.schema.topNodeType.name) calculatedNodeSize = calculatedContentSize;
    else if (this.isLeafType) calculatedNodeSize = 1; 
    else if (this.isBlock) calculatedNodeSize = 2 + calculatedContentSize; 
    else if (this.isInline && !this.isTextType) calculatedNodeSize = (finalContentArray.length > 0 ? (this.spec.toDOM ? 2 : 0) : 0) + calculatedContentSize; 
    else { console.warn(`Node type ${this.name} fallback size calc.`); calculatedNodeSize = calculatedContentSize; }
    
    const nodeObject: ModelNode = { type: this, attrs: finalAttrs, content: finalContentArray.length > 0 ? finalContentArray : [], nodeSize: calculatedNodeSize, isLeaf: this.isLeafType, isText: this.isTextType } as ModelNode;
    if (this.name === this.schema.topNodeType.name) { (nodeObject as any).contentSize = calculatedContentSize; }
    return nodeObject;
  }
  public defaultAttrs(attrs?: Attrs): Attrs { const d: Attrs = {}; if(this.spec.attrs) for(const aN in this.spec.attrs){ const aS=this.spec.attrs[aN]; if(attrs?.[aN]!==undefined)d[aN]=attrs[aN]; else if(aS.default!==undefined)d[aN]=aS.default;} return d;}
  public toDOM(node: ModelNode): DOMOutputSpec { if(this.spec.toDOM) return this.spec.toDOM(node); return this.isBlock ? ["div",0] : (this.isInline ? ["span",0] : ""); }
}

export class MarkType { 
  constructor( public readonly name: string, public readonly spec: MarkSpec, public readonly schema: Schema ) {}
  public create(attrs?: Attrs): ModelAnyMark {
    const defaultedAttrs = this.defaultAttrs(attrs);
    const markInstance: ModelAnyMark = { type: this, attrs: defaultedAttrs, eq(other: ModelAnyMark): boolean { if (this === other) return true; if (!other) return false; return this.type === other.type && attrsEq(this.attrs, other.attrs); }};
    return markInstance;
  }
  public defaultAttrs(attrs?: Attrs): Attrs { const d: Attrs = {}; if(this.spec.attrs) for(const aN in this.spec.attrs){ const aS=this.spec.attrs[aN]; if(attrs?.[aN]!==undefined)d[aN]=attrs[aN]; else if(aS.default!==undefined)d[aN]=aS.default;} return d;}
  public toDOM(mark: ModelAnyMark, inlineContent: boolean): DOMOutputSpec { if(this.spec.toDOM) return this.spec.toDOM(mark, inlineContent); return [this.name,0]; }
}

export class Schema { 
  public readonly nodes: { [name: string]: NodeType };
  public readonly marks: { [name: string]: MarkType };
  public readonly topNodeType: NodeType; 
  private nodeIdCounter: number = 1;
  public readonly groups: Map<string, NodeType[]>; 

  constructor(config: { nodes: { [name: string]: NodeSpec }; marks: { [name: string]: MarkSpec }; }) {
    this.nodes = {}; this.marks = {}; this.groups = new Map();
    for (const name in config.nodes) this.nodes[name] = new NodeType(name, config.nodes[name], this);
    for (const name in config.marks) this.marks[name] = new MarkType(name, config.marks[name], this);
    
    for (const name in this.nodes) {
        const nodeType = this.nodes[name];
        if (nodeType.spec.group) { nodeType.spec.group.split(" ").forEach(groupName => { if (!this.groups.has(groupName)) this.groups.set(groupName, []); this.groups.get(groupName)!.push(nodeType); }); }
        if (nodeType.isTextType || nodeType.isInline) { if (!this.groups.has("inline")) this.groups.set("inline", []); this.groups.get("inline")!.push(nodeType); }
        if (nodeType.isBlock) { if (!this.groups.has("block")) this.groups.set("block", []); this.groups.get("block")!.push(nodeType); }
        if (nodeType.isTextType) { if(!this.groups.has("text")) this.groups.set("text",[]); this.groups.get("text")!.push(nodeType);}
    }
    if (!this.nodes.doc) throw new Error("Schema must define a 'doc' node type.");
    if (!this.nodes.text) throw new Error("Schema must define a 'text' node type.");
    this.topNodeType = this.nodes.doc;

    // Finalize content matchers now that all groups are populated
    for (const name in this.nodes) {
        this.nodes[name]._finalizeContentMatcher();
    }
  }
  public getGroup(groupName: string): NodeType[] | undefined { return this.groups.get(groupName); }
  public node( type: string | NodeType, attrs?: Attrs, content?: ReadonlyArray<ModelNode> | ModelNode, marks?: ReadonlyArray<ModelAnyMark> ): ModelNode {
    const nodeType = typeof type === 'string' ? this.nodes[type] : type;
    if (!nodeType) throw new Error(`Unknown node type: ${type}`);
    if (nodeType.isTextType) throw new Error("Cannot use schema.node() for text nodes; use schema.text() instead.");
    return nodeType.create(attrs, content, marks);
  }
  public text(text: string, marks?: ReadonlyArray<ModelAnyMark>): ModelTextNode {
    const textNodeType = this.nodes.text;
    if (!textNodeType) throw new Error("Text node type not defined in schema");
    const defaultedAttrs = textNodeType.defaultAttrs(null); 
    return {
      type: textNodeType, attrs: defaultedAttrs, text: text, marks: marks || [], 
      nodeSize: text.length, isText: true, isLeaf: false, content: [], 
    } as unknown as ModelTextNode; 
  }
  public generateNodeId(): string { return `ritor-node-${this.nodeIdCounter++}`; }
  public createDoc(content: ReadonlyArray<ModelNode>): ModelNode { return this.topNodeType.create(null, content); }
}

console.log("schema.ts: NodeType.checkContent with logging, contentMatcher finalization deferred, node props from NodeType.");
