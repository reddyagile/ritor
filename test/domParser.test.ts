// test/domParser.test.ts

import { DOMParser as RitorDOMParser } from '../src/domParser.js';
import { Schema } from '../src/schema.js';
import { basicNodeSpecs, basicMarkSpecs } from '../src/basicSchema.js';
import { DocNode, TextNode, BaseNode } from '../src/documentModel.js';

// Disable debug logging
(globalThis as any).DEBUG_REPLACESTEP = false;
(globalThis as any).DEBUG_MATCHES_RULE = false;
(globalThis as any).DEBUG_CHECK_CONTENT = false;

const schema = new Schema({
    nodes: basicNodeSpecs,
    marks: basicMarkSpecs
});

// Helper for structural comparison
const getStructure = (node: BaseNode): any => {
    if (node.isText && !node.isLeaf) {
        const textNode = node as TextNode;
        const marks = (textNode.marks || []).map(m => m.type.name).sort();
        return { type: 'text', text: textNode.text, ...(marks.length ? { marks } : {}) };
    }

    const content = node.content ? node.content.map(getStructure) : [];
    const attrsToCompare = { ...node.attrs };
    delete attrsToCompare.id;

    return {
        type: node.type.name,
        ...(Object.keys(attrsToCompare).length ? { attrs: attrsToCompare } : {}),
        ...(content.length ? { content } : {})
    };
};


describe('DOMParser with getContent', () => {
    let parser: RitorDOMParser;

    beforeEach(() => {
        parser = new RitorDOMParser(schema);
    });

    it('should parse a figure with image and figcaption using getContent', () => {
        const html = '<figure id="f1"><img src="test.png" alt="Test Image"><figcaption>Test Caption</figcaption></figure>';
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        const figureElement = tempDiv.firstChild as HTMLElement;
        expect(figureElement).not.toBeNull();
        // Call parseNode with schema.topNodeType as a stand-in for a parent, though fig's rules don't use context here
        const parsedNode = parser['parseNode'](figureElement, [], schema.topNodeType);
        expect(parsedNode).not.toBeNull();
        // For structural comparison, wrap the parsed figure node in a doc node if parseNode doesn't return a doc.
        // If parsedNode is already a complete block, it can be directly put in doc's content.
        const resultDoc = schema.node(schema.topNodeType, null, [parsedNode!]) as DocNode;

        const expectedStructure = {
            type: "doc",
            content: [{
                type: "figure",
                content: [
                    { type: "image", attrs: { src: "test.png", alt: "Test Image", title: null } },
                    { type: "figcaption", content: [{ type: "text", text: "Test Caption" }] }
                ]
            }]
        };
        expect(getStructure(resultDoc)).toEqual(expectedStructure);
    });

    it('should parse a figure with only an image', () => {
        const html = '<figure id="f2"><img src="image.jpg" alt="Solo Image"></figure>';
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        const figureElement = tempDiv.firstChild as HTMLElement;
        expect(figureElement).not.toBeNull();
        const parsedNode = parser['parseNode'](figureElement, [], schema.topNodeType);
        expect(parsedNode).not.toBeNull();
        const resultDoc = schema.node(schema.topNodeType, null, [parsedNode!]) as DocNode;
        const expectedStructure = {
            type: "doc",
            content: [{ type: "figure", content: [ { type: "image", attrs: { src: "image.jpg", alt: "Solo Image", title: null } } ] }]
        };
        expect(getStructure(resultDoc)).toEqual(expectedStructure);
    });

    it('should parse a figure with only a figcaption (triggers schema warning)', () => {
        const html = '<figure id="f3"><figcaption>Caption Only</figcaption></figure>';
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        const figureElement = tempDiv.firstChild as HTMLElement;
        expect(figureElement).not.toBeNull();
        const parsedNode = parser['parseNode'](figureElement, [], schema.topNodeType);
        expect(parsedNode).not.toBeNull(); // Node is still created despite invalid content
        const resultDoc = schema.node(schema.topNodeType, null, [parsedNode!]) as DocNode;
        const expectedStructure = { // This is what getContent produces
            type: "doc",
            content: [{ type: "figure", content: [ { type: "figcaption", content: [{ type: "text", text: "Caption Only" }] } ] }]
        };
        expect(getStructure(resultDoc)).toEqual(expectedStructure);
    });

    it('should parse an empty figure tag (triggers schema warning)', () => {
        const html = '<figure id="f4"></figure>';
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        const figureElement = tempDiv.firstChild as HTMLElement;
        expect(figureElement).not.toBeNull();
        const parsedNode = parser['parseNode'](figureElement, [], schema.topNodeType);
        expect(parsedNode).not.toBeNull(); // Node is still created
        const resultDoc = schema.node(schema.topNodeType, null, [parsedNode!]) as DocNode;
        const resultStruct = getStructure(resultDoc);
        const expectedStructure = { type: "doc", content: [{ type: "figure" }] }; // Figure with no content array
        expect(resultStruct).toEqual(expectedStructure);
    });

    describe('ParseRule.context', () => {
        it('should parse p.special as special_paragraph_for_li only inside list_item', () => {
            const parser = new RitorDOMParser(schema); // Uses main schema
            const html = `
                <ul>
                    <li><p class="special">Special in li</p></li>
                    <li><p>Regular in li</p></li>
                </ul>
                <p class="special">Special outside li</p>
                <p>Regular outside li</p>
            `;
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;
            const resultDoc = parser.parse(tempDiv);
            expect(resultDoc).not.toBeNull();
            expect(resultDoc.type.name).toBe("doc");

            const expectedDocStructure = {
                type: "doc",
                content: [
                    {
                        type: "bullet_list",
                        content: [
                            {
                                type: "list_item",
                                content: [ { type: "special_paragraph_for_li", content: [{ type: "text", text: "Special in li" }] } ]
                            },
                            {
                                type: "list_item",
                                content: [ { type: "paragraph", content: [{ type: "text", text: "Regular in li" }] } ]
                            }
                        ]
                    },
                    { type: "paragraph", content: [{ type: "text", text: "Special outside li" }] },
                    { type: "paragraph", content: [{ type: "text", text: "Regular outside li" }] }
                ]
            };
            expect(getStructure(resultDoc)).toEqual(expectedDocStructure);
        });
    });

    describe('Schema Validation during Parsing', () => {
        let consoleWarnSpy: jest.SpyInstance;

        beforeEach(() => {
            consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        });

        afterEach(() => {
            consoleWarnSpy.mockRestore();
        });

        it('Test 1: list_item with direct text should warn', () => {
            const tempSchema = new Schema({
                nodes: {
                    ...basicNodeSpecs,
                    doc: { ...basicNodeSpecs.doc, content: "bullet_list*" }, // Allow empty or list
                    bullet_list: basicNodeSpecs.bullet_list,
                    list_item: { ...basicNodeSpecs.list_item, content: "paragraph+" }, // Override: Must contain one or more paragraphs
                    paragraph: basicNodeSpecs.paragraph,
                    text: basicNodeSpecs.text,
                },
                marks: basicMarkSpecs
            });
            const testParser = new RitorDOMParser(tempSchema);
            const html = '<ul><li>Direct text in li, not in a p</li></ul>';
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;
            testParser.parse(tempDiv);

            expect(consoleWarnSpy).toHaveBeenCalled();
            const domParserWarningFound = consoleWarnSpy.mock.calls.some(callArgs =>
                typeof callArgs[0] === 'string' &&
                callArgs[0].includes("Schema validation failed during DOMParser.parseNode for content of node type: list_item") &&
                callArgs[3] === "\nExpected content expression:" && // Arg index 3 for message part
                typeof callArgs[4] === 'string' &&
                callArgs[4].includes("paragraph+")
            );
            expect(domParserWarningFound).toBe(true);
        });

        it('Test 2: figure with wrong order of children should warn', () => {
            const parser = new RitorDOMParser(schema);
            const html = '<figure><figcaption>Caption first</figcaption><img src="test.png"></figure>';
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;
            const figureElement = tempDiv.firstChild as HTMLElement;
            // Parse the figure node; its getContent will produce [figcaption, image]
            // Then, when creating the figure node, its own checkContent will fail.
            parser['parseNode'](figureElement, [], schema.topNodeType);

            expect(consoleWarnSpy).toHaveBeenCalled();
            const nodeCreationWarningFound = consoleWarnSpy.mock.calls.some(callArgs =>
                typeof callArgs[0] === 'string' &&
                callArgs[0].startsWith("Invalid content for node type figure:") && // Check for NodeType.create's specific message start
                callArgs[0].includes("based on expression \"(image figcaption?)\"") // Check for the expression part in the same message
            );
            expect(nodeCreationWarningFound).toBe(true);
        });

        it('Test 3: doc with direct inline content should warn during final doc creation', () => {
            const parser = new RitorDOMParser(schema);
            const html = 'Just some text at the root';
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;
            parser.parse(tempDiv);

            expect(consoleWarnSpy).toHaveBeenCalled();
            const docRootWarningFound = consoleWarnSpy.mock.calls.some(callArgs =>
                typeof callArgs[0] === 'string' &&
                callArgs[0].includes("Schema validation failed for content of root DOC node.") &&
                callArgs[1] === "\nExpected content expression:" && // Arg index 1 for message part
                typeof callArgs[2] === 'string' &&
                callArgs[2].includes("(block | figure)+")
            );
            expect(docRootWarningFound).toBe(true);
        });
    });
});
