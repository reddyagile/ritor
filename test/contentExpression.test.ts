// test/contentExpression.test.ts

import { Schema, NodeType } from '../src/schema.js'; 
import { NodeSpec } from '../src/schemaSpec.js';
import { BaseNode, TextNode } from '../src/documentModel.js';

// Disable debug logging for checkContent for final run
(globalThis as any).DEBUG_CHECK_CONTENT = false; 

// Basic schema setup for testing
const testNodeSpecs: { [name: string]: NodeSpec } = {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    heading: { group: "block", content: "inline*" },
    image: { group: "block", atom: true }, 
    text: { group: "inline" }, 
    hard_break: { group: "inline", atom: true }, 
    list_item: { group: "block", content: "paragraph" }, 
    figure: { group: "block", content: "image figcaption?" },
    figcaption: { group: "block", content: "inline*" } // Changed from text* to inline* for consistency
};
const testSchema = new Schema({ nodes: testNodeSpecs, marks: {} });

// Helper to create mock nodes
const createMockNode = (typeName: string, content?: BaseNode[]): BaseNode => {
    const type = testSchema.nodes[typeName];
    if (!type) throw new Error(`Unknown node type: ${typeName} in test setup`);
    return {
        type, attrs: {}, marks: [], content: content || [], nodeSize: 0, 
        isLeaf: type.isLeafType, 
        isText: type.isTextType 
    } as BaseNode;
};

const p = (...content: BaseNode[]) => createMockNode("paragraph", content);
const h = (...content: BaseNode[]) => createMockNode("heading", content);
const img = () => createMockNode("image");
const txt = (textVal = "abc") => createMockNode("text") as TextNode;
const br = () => createMockNode("hard_break");
const fig = (...content: BaseNode[]) => createMockNode("figure", content);
const figcap = (...content: BaseNode[]) => createMockNode("figcaption", content);


describe('NodeType.checkContent', () => {
    describe('Simple Quantifiers and Names', () => {
        it('paragraph (inline*)', () => { 
            const paraType = testSchema.nodes.paragraph;
            expect(paraType.checkContent([])).toBe(true); 
            expect(paraType.checkContent([txt()])).toBe(true);
            expect(paraType.checkContent([txt(), br(), txt()])).toBe(true);
        });

        it('doc (block+)', () => {
            const docType = testSchema.nodes.doc;
            expect(docType.checkContent([p()])).toBe(true);
            expect(docType.checkContent([p(), h()])).toBe(true);
            expect(docType.checkContent([])).toBe(false); 
            expect(docType.checkContent([txt()])).toBe(false); 
        });

        it('image (atom, effectively empty content)', () => {
            const imgType = testSchema.nodes.image;
            expect(imgType.checkContent([])).toBe(true); 
            expect(imgType.checkContent([txt()])).toBe(false); 
        });

        it('heading (inline*)', () => {
            const headingType = testSchema.nodes.heading;
            expect(headingType.checkContent([])).toBe(true);
            expect(headingType.checkContent([txt()])).toBe(true);
        });
    });

    describe('Sequences', () => {
        it('figure (image figcaption?)', () => {
            const figureType = testSchema.nodes.figure;
            expect(figureType.checkContent([img(), figcap(txt())])).toBe(true); 
            expect(figureType.checkContent([img()])).toBe(true); 
            expect(figureType.checkContent([figcap(txt()), img()])).toBe(false); 
            expect(figureType.checkContent([img(), img()])).toBe(false); 
            expect(figureType.checkContent([figcap(txt())])).toBe(false); 
            expect(figureType.checkContent([img(), figcap(txt()), figcap(txt())])).toBe(false); 
            expect(figureType.checkContent([])).toBe(false); 
        });
         it('list_item (paragraph)', () => { 
            const liType = testSchema.nodes.list_item;
            expect(liType.checkContent([p(txt())])).toBe(true);
            expect(liType.checkContent([])).toBe(false);
            expect(liType.checkContent([p(),p()])).toBe(false); 
            expect(liType.checkContent([h()])).toBe(false); 
        });
    });
    
    describe('Choices and Groups (PoC Level)', () => {
        const choiceTestNodeSpec: NodeSpec = { content: "(paragraph | heading)+" };
        testSchema.nodes.choiceTestNode = new NodeType("choiceTestNode", choiceTestNodeSpec, testSchema);
        const choiceType = testSchema.nodes.choiceTestNode;
        choiceType._finalizeContentMatcher(); // Manually finalize

        it('choiceTestNode ((paragraph | heading)+)', () => {
            expect(choiceType.checkContent([p(), h()])).toBe(true);
            expect(choiceType.checkContent([h(), p(), h()])).toBe(true);
            expect(choiceType.checkContent([p()])).toBe(true);
            expect(choiceType.checkContent([h()])).toBe(true);
            expect(choiceType.checkContent([])).toBe(false); 
            expect(choiceType.checkContent([img()])).toBe(false); 
            expect(choiceType.checkContent([p(), img()])).toBe(false); 
        });

        const groupTestNodeSpec: NodeSpec = { content: "block*" };
        testSchema.nodes.groupTestNode = new NodeType("groupTestNode", groupTestNodeSpec, testSchema);
        const groupType = testSchema.nodes.groupTestNode;
        groupType._finalizeContentMatcher(); // Manually finalize

        it('groupTestNode (block*)', () => {
            expect(groupType.checkContent([p(), h()])).toBe(true); 
            expect(groupType.checkContent([img()])).toBe(true);     
            expect(groupType.checkContent([])).toBe(true);         
            expect(groupType.checkContent([p(), txt()])).toBe(false); 
        });
    });

    describe('parseContentExpression output', () => {
        it('parses doc content "block+" correctly', () => {
            const docMatcher = testSchema.nodes.doc.contentMatcher;
            expect(docMatcher).toEqual([{ type: 'group', value: 'block', min: 1, max: Infinity }]);
        });
        
        it('parses paragraph content "inline*" correctly', () => {
            const paraMatcher = testSchema.nodes.paragraph.contentMatcher;
            expect(paraMatcher).toEqual([{ type: 'group', value: 'inline', min: 0, max: Infinity }]);
        });

        it('parses "image figcaption?" correctly', () => {
            const figMatcher = testSchema.nodes.figure.contentMatcher;
            expect(figMatcher).toEqual([
                { type: 'name', value: 'image', min: 1, max: 1 },
                { type: 'name', value: 'figcaption', min: 0, max: 1 }
            ]);
        });
        
        it('parses "(paragraph | heading)*" correctly (PoC choice)', () => {
            const choiceTestNodeSpecManual: NodeSpec = { content: "(paragraph | heading)*" };
            const nodeTypeForTest = new NodeType("manualChoiceTest", choiceTestNodeSpecManual, testSchema);
            nodeTypeForTest._finalizeContentMatcher(); // Manually finalize
            const choiceMatcher = nodeTypeForTest.contentMatcher;
            expect(choiceMatcher).toEqual([{
                type: 'group', 
                value: 'choice(paragraph|heading)', 
                min: 0,
                max: Infinity,
                isChoice: true,
                options: ['paragraph', 'heading']
            }]);
        });
    });
});
