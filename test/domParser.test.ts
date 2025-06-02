// test/domParser.test.ts

import { DOMParser as RitorDOMParser } from '../src/domParser.js';
import { Schema } from '../src/schema.js';
import { basicNodeSpecs, basicMarkSpecs } from '../src/basicSchema.js';
import { DocNode, TextNode, BaseNode, Mark } from '../src/documentModel.js'; 
import { Attrs, NodeSpec } from '../src/schemaSpec.js';

// Disable debug logging
(globalThis as any).DEBUG_REPLACESTEP = false; 
(globalThis as any).DEBUG_MATCHES_RULE = false; 
(globalThis as any).DEBUG_CHECK_CONTENT = false;

const schema = new Schema({ 
    nodes: basicNodeSpecs, 
    marks: basicMarkSpecs 
});

// Helper functions to create nodes
const createMark = (type: string, attrs?: any): Mark => schema.marks[type]?.create(attrs) as Mark;
const createText = (text: string, marksArray?: {type: string, attrs?: any}[]): TextNode => {
    const marks = marksArray?.map(m => createMark(m.type, m.attrs)).filter(m => !!m) || [];
    return schema.text(text, marks) as TextNode;
};
const createPara = (...content: (TextNode | BaseNode)[]): BaseNode => schema.node(schema.nodes.paragraph, {}, content);
const createHeading = (level: number, ...content: (TextNode | BaseNode)[]): BaseNode => schema.node(schema.nodes.heading, { level }, content);
const createListItem = (...content: BaseNode[]): BaseNode => schema.node(schema.nodes.list_item, {}, content);
const createBulletList = (...content: BaseNode[]): BaseNode => schema.node(schema.nodes.bullet_list, {}, content);
const createBlockQuote = (...content: BaseNode[]): BaseNode => schema.node(schema.nodes.blockquote, {}, content);
const createHardBreak = (): BaseNode => schema.node(schema.nodes.hard_break, {});
const createImg = (attrs: Attrs): BaseNode => schema.node(schema.nodes.image, attrs);
const createFigcaption = (...content: (TextNode|BaseNode)[]): BaseNode => schema.node(schema.nodes.figcaption, {}, content);
const createFigure = (...content: BaseNode[]): BaseNode => schema.node(schema.nodes.figure, {}, content);
const createDoc = (...content: BaseNode[]): DocNode => schema.node(schema.nodes.doc, {}, content) as DocNode;

// Enhanced helper for structural comparison
const getStructure = (node: BaseNode | null): any => {
    if (!node) return null;
    if (node.isText && !node.isLeaf) {
        const textNode = node as TextNode;
        const marks = (textNode.marks || []).map(m => m.type.name).sort();
        return { type: 'text', text: textNode.text, ...(marks.length ? { marks } : {}) };
    }
    const content = node.content ? node.content.map(getStructure) : [];
    const attrsToCompare = { ...node.attrs };
    delete attrsToCompare.id; 
    return { type: node.type.name, ...(Object.keys(attrsToCompare).length ? { attrs: attrsToCompare } : {}), ...(content.length ? { content } : {}) };
};

describe('RitorDOMParser', () => {
    let parser: RitorDOMParser;
    let consoleWarnSpy: jest.SpyInstance;

    beforeEach(() => {
        parser = new RitorDOMParser(schema);
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleWarnSpy.mockRestore();
    });

    describe('Basic Block Parsing', () => {
        it('should parse simple paragraphs and headings', () => {
            const html = '<p>Para 1</p><h1>Heading 1</h1>';
            const tempDiv = document.createElement('div'); tempDiv.innerHTML = html;
            const resultDoc = parser.parse(tempDiv);
            expect(getStructure(resultDoc)).toEqual({ type: 'doc', content: [ { type: 'paragraph', content: [{ type: 'text', text: 'Para 1' }] }, { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Heading 1' }] } ]});
        });
        it('should parse a paragraph with strong text', () => {
            const html = '<p>Para with <strong>bold</strong> text</p>';
            const tempDiv = document.createElement('div'); tempDiv.innerHTML = html;
            const resultDoc = parser.parse(tempDiv);
            expect(getStructure(resultDoc)).toEqual({ type: 'doc', content: [ { type: 'paragraph', content: [ { type: 'text', text: 'Para with ' }, { type: 'text', text: 'bold', marks: ['bold'] }, { type: 'text', text: ' text' } ]}]});
        });
        it('should parse a simple unordered list', () => {
            const html = '<ul><li><p>Item 1</p></li><li><p>Item 2</p></li></ul>';
            const tempDiv = document.createElement('div'); tempDiv.innerHTML = html;
            const resultDoc = parser.parse(tempDiv);
            expect(getStructure(resultDoc)).toEqual({ type: 'doc', content: [ { type: 'bullet_list', content: [ { type: 'list_item', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item 1'}] }] }, { type: 'list_item', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item 2'}] }] } ]}]});
        });
        it('should parse a simple blockquote', () => {
            const html = '<blockquote><p>Quote</p></blockquote>';
            const tempDiv = document.createElement('div'); tempDiv.innerHTML = html;
            const resultDoc = parser.parse(tempDiv);
            expect(getStructure(resultDoc)).toEqual({ type: 'doc', content: [ { type: 'blockquote', content: [ { type: 'paragraph', content: [{ type: 'text', text: 'Quote'}] } ]}]});
        });
    });

    describe('Inline Content and Mark Parsing', () => {
        it('should parse text with various marks', () => {
            const html = "<p>Text with <strong>bold</strong>, <em>italic</em>, and <s>strike</s>.</p>";
            const tempDiv = document.createElement('div'); tempDiv.innerHTML = html;
            const resultDoc = parser.parse(tempDiv);
            expect(getStructure(resultDoc)).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [ { type: 'text', text: 'Text with ' }, { type: 'text', text: 'bold', marks: ['bold'] }, { type: 'text', text: ', ' }, { type: 'text', text: 'italic', marks: ['italic'] }, { type: 'text', text: ', and ' }, { type: 'text', text: 'strike', marks: ['strikethrough'] }, { type: 'text', text: '.' } ]}]});
        });
        it('should parse nested marks: strong > em', () => {
            const html = "<p>Nested: <strong>bold<em>italic</em></strong></p>";
            const tempDiv = document.createElement('div'); tempDiv.innerHTML = html;
            const resultDoc = parser.parse(tempDiv);
            expect(getStructure(resultDoc)).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [ { type: 'text', text: 'Nested: ' }, { type: 'text', text: 'bold', marks: ['bold'] }, { type: 'text', text: 'italic', marks: ['bold', 'italic'] } ]}]});
        });
        it('should parse a link with href and title', () => { 
            const html = "<p>Link: <a href='http://example.com' title='Example'>example</a></p>";
            const tempDiv = document.createElement('div'); tempDiv.innerHTML = html;
            const resultDoc = parser.parse(tempDiv);
            expect(getStructure(resultDoc)).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [ { type: 'text', text: 'Link: ' }, { type: 'text', text: 'example', marks: ['link'] }  ]}]});
        });
        it('should parse hard_break (br tag)', () => {
            const html = "<p>Line one<br>Line two</p>";
            const tempDiv = document.createElement('div'); tempDiv.innerHTML = html;
            const resultDoc = parser.parse(tempDiv);
             expect(getStructure(resultDoc)).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [ { type: 'text', text: 'Line one' }, { type: 'hard_break' }, { type: 'text', text: 'Line two' } ]}]});
        });
    });

    describe('ParseRule.tag Selectors (Attribute/Class)', () => {
        const customNodeSpecsForFancy: {[name: string]: NodeSpec} = { doc: { ...(basicNodeSpecs.doc as NodeSpec), content: "(fancy_paragraph | paragraph | block | figure)+" }, fancy_paragraph: { content: "inline*", group: "block", attrs: {id:{}}, toDOM: () => ["p", {class: "fancy-p"}, 0], parseDOM: [{ tag: "p.fancy" }] }, paragraph: basicNodeSpecs.paragraph };
        const orderedCustomNodeSpecs: {[name: string]: NodeSpec} = { doc: customNodeSpecsForFancy.doc, fancy_paragraph: customNodeSpecsForFancy.fancy_paragraph, paragraph: customNodeSpecsForFancy.paragraph };
        for (const key in basicNodeSpecs) if (!orderedCustomNodeSpecs[key]) orderedCustomNodeSpecs[key] = basicNodeSpecs[key];
        const schemaWithFancyPara = new Schema({ nodes: orderedCustomNodeSpecs, marks: basicMarkSpecs });

        it('should parse p.fancy as fancy_paragraph', () => { 
            const testParser = new RitorDOMParser(schemaWithFancyPara);
            const html = '<p class="fancy">Fancy Text</p><p>Normal Text</p>';
            const tempDiv = document.createElement('div'); tempDiv.innerHTML = html;
            const resultDoc = testParser.parse(tempDiv);
            expect(getStructure(resultDoc)).toEqual({ type: 'doc', content: [ { type: 'fancy_paragraph', content: [{ type: 'text', text: 'Fancy Text'}] }, { type: 'paragraph', content: [{ type: 'text', text: 'Normal Text'}] } ]});
        });
    });
    
    describe('ParseRule.getContent and ParseRule.context', () => {
        it('should parse a figure with image and figcaption using getContent', () => { 
            const html = '<figure><img src="test.png" alt="Test Image"><figcaption>Test Caption</figcaption></figure>';
            const tempDiv = document.createElement('div'); tempDiv.innerHTML = html;
            const resultDoc = parser.parse(tempDiv); 
            expect(getStructure(resultDoc.content[0]!)).toEqual( { type: "figure", content: [ { type: "image", attrs: { src: "test.png", alt: "Test Image", title: null } }, { type: "figcaption", content: [{ type: "text", text: "Test Caption" }] } ]});
        });
        it('should parse p.special as special_paragraph_for_li only inside list_item', () => { 
            const html = `<ul><li><p class="special">Special in li</p></li><li><p>Regular in li</p></li></ul><p class="special">Special outside li</p><p>Regular outside li</p>`;
            const tempDiv = document.createElement('div'); tempDiv.innerHTML = html;
            const resultDoc = parser.parse(tempDiv);
            expect(getStructure(resultDoc)).toEqual({ type: "doc", content: [ { type: "bullet_list", content: [ { type: "list_item", content: [ { type: "special_paragraph_for_li", content: [{ type: "text", text: "Special in li" }] } ]}, { type: "list_item", content: [ { type: "paragraph", content: [{ type: "text", text: "Regular in li" }] } ]} ]}, { type: "paragraph", content: [{ type: "text", text: "Special outside li" }] }, { type: "paragraph", content: [{ type: "text", text: "Regular outside li" }] } ]});
        });
    });

    describe('Invalid, Unexpected, or Non-Schema HTML', () => {
        it('should ignore unknown tags and parse their content if possible (basic flattening)', () => {
            const html = '<random-tag><p>Known content inside</p></random-tag>';
            const tempDiv = document.createElement('div'); tempDiv.innerHTML = html;
            const resultDoc = parser.parse(tempDiv);
            expect(getStructure(resultDoc)).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Known content inside' }] }]});
        });
        it('should handle text directly in a div if no block rule matches first', () => {
            const html = '<div>Root text<p>Para</p></div>'; 
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html; 
            const parsedNodes = parser['parseFragment'](tempDiv.firstChild as HTMLElement); 
            
            const resultDoc = createDoc(...parsedNodes); // This call will trigger NodeType.create's checkContent for 'doc'
            
            expect(getStructure(resultDoc)).toEqual({ 
                 type: 'doc',
                 content: [ 
                    { type: 'text', text: 'Root text' }, 
                    { type: 'paragraph', content: [{ type: 'text', text: 'Para' }] }
                 ]
            });

            expect(consoleWarnSpy).toHaveBeenCalled();
            // This test calls createDoc helper, which calls schema.node -> NodeType.create -> checkContent.
            // So we expect the warning from NodeType.create for the 'doc' node.
            const nodeCreationWarningFound = consoleWarnSpy.mock.calls.some(callArgs =>
                typeof callArgs[0] === 'string' &&
                callArgs[0].startsWith("Invalid content for node type doc:") &&
                callArgs[0].includes("based on expression \"(block | figure)+\"") && 
                callArgs[0].includes("[text,paragraph]") 
            );
            expect(nodeCreationWarningFound).toBe(true);
        });
        it('should parse <p><div>Block inside P</div></p> and warn on schema validation', () => {
            const html = '<p><div>Block inside P</div></p>'; 
            const tempDiv = document.createElement('div'); tempDiv.innerHTML = html; 
            parser.parse(tempDiv);
            expect(consoleWarnSpy).toHaveBeenCalled(); 
            const docContentWarningFound = consoleWarnSpy.mock.calls.some(callArgs => typeof callArgs[0] === 'string' && ( callArgs[0].includes("Schema validation failed for content of root DOC node.") || callArgs[0].includes("Invalid content for node type doc:") ) && callArgs.some((arg: any) => typeof arg === 'string' && arg.includes("(block | figure)+")));
            expect(docContentWarningFound).toBe(true);
        });
        it('should parse empty input string to empty doc content', () => {
            const tempDiv = document.createElement('div'); tempDiv.innerHTML = "";
            const resultDoc = parser.parse(tempDiv);
            expect(getStructure(resultDoc)).toEqual({ type: 'doc' }); 
            expect(consoleWarnSpy).toHaveBeenCalled(); 
            const docRootWarningForEmpty = consoleWarnSpy.mock.calls.some(callArgs => typeof callArgs[0] === 'string' && callArgs[0].includes("Schema validation failed for content of root DOC node.") && typeof callArgs[2] === 'string' && callArgs[2].includes("(block | figure)+"));
            expect(docRootWarningForEmpty).toBe(true);
        });
        it('should parse <p></p> as an empty paragraph', () => {
            const tempDiv = document.createElement('div'); tempDiv.innerHTML = "<p></p>";
            const resultDoc = parser.parse(tempDiv);
            expect(getStructure(resultDoc)).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
        });
    });

    describe('Whitespace Handling', () => {
        it('should preserve leading and trailing spaces in a paragraph', () => {
            const html = '<p>  leading and trailing spaces  </p>';
            const tempDiv = document.createElement('div'); tempDiv.innerHTML = html;
            const resultDoc = parser.parse(tempDiv);
            expect(getStructure(resultDoc)).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '  leading and trailing spaces  '}] }]});
        });
        it('should ignore whitespace between block elements at root', () => {
            const html = '<p>Text</p>   <p>More Text</p>';
            const tempDiv = document.createElement('div'); tempDiv.innerHTML = html;
            const resultDoc = parser.parse(tempDiv);
            expect(getStructure(resultDoc)).toEqual({ type: 'doc', content: [ { type: 'paragraph', content: [{ type: 'text', text: 'Text'}] }, { type: 'paragraph', content: [{ type: 'text', text: 'More Text'}] } ]});
        });
        it('should preserve multiple spaces inside text', () => {
            const html = '<p>Multiple   spaces   inside</p>';
            const tempDiv = document.createElement('div'); tempDiv.innerHTML = html;
            const resultDoc = parser.parse(tempDiv);
            expect(getStructure(resultDoc)).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Multiple   spaces   inside'}] }]});
        });
    });
});
