// test/replaceStep.test.ts

import { ReplaceStep } from '../src/transform/replaceStep.js';
import { Slice } from '../src/transform/slice.js';
import { Schema } from '../src/schema.js';
import { basicNodeSpecs, basicMarkSpecs } from '../src/basicSchema.js';
import { DocNode, TextNode, BaseNode, Mark } from '../src/documentModel.js';
import { modelPositionToFlatOffset, flatOffsetToModelPosition, normalizeInlineArray } from '../src/modelUtils.js';
import { Attrs, NodeSpec } from '../src/schemaSpec.js';


(globalThis as any).DEBUG_REPLACESTEP = false;
(globalThis as any).DEBUG_MATCHES_RULE = false;
(globalThis as any).DEBUG_CHECK_CONTENT = false;

const schema = new Schema({
    nodes: basicNodeSpecs,
    marks: basicMarkSpecs
});

// Helper functions
const createMark = (type: string, attrs?: any): Mark => schema.marks[type]?.create(attrs) as Mark;
const createText = (text: string, marksArray?: {type: string, attrs?: any}[]): TextNode => {
    const marks = marksArray?.map(m => createMark(m.type, m.attrs)).filter(m => !!m) || [];
    return schema.text(text, marks) as TextNode;
};
const createPara = (...content: (TextNode | BaseNode)[]): BaseNode => schema.node(schema.nodes.paragraph, {}, content);
const createDoc = (...content: BaseNode[]): DocNode => schema.node(schema.nodes.doc, {}, content) as DocNode;

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

const docsAreEqual = (doc1: DocNode, doc2: DocNode): boolean => {
    const struct1 = getStructure(doc1);
    const struct2 = getStructure(doc2);
    const match = JSON.stringify(struct1) === JSON.stringify(struct2);
    if (!match) {
        console.warn("Docs not equal (structural):"); // Changed to console.warn for less noise on pass
        console.warn("Doc1:", JSON.stringify(struct1, null, 2));
        console.warn("Doc2:", JSON.stringify(struct2, null, 2));
    }
    return match;
};

describe('ReplaceStep.apply', () => {
    // --- Existing Single-Block Inline Replacements ---
    describe('Single-Block Inline Replacements (No Slice Opening)', () => {
        it('should replace text in the middle of a paragraph', () => {
            const initialDoc = createDoc(createPara(createText("Hello world!")));
            const from = 7; const to = 12;
            const slice = Slice.fromFragment([createText("Ritor")]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getStructure(result.doc!)).toEqual(getStructure(createDoc(createPara(createText("Hello Ritor!")))));
        });
        it('should replace text across two text nodes within a paragraph', () => {
            const initialDoc = createDoc(createPara(createText("Hello "), createText("world!")));
            const from = modelPositionToFlatOffset(initialDoc, { path: [0,0], offset: 4 }, schema);
            const to = modelPositionToFlatOffset(initialDoc, { path: [0,1], offset: 3 }, schema);
            const slice = Slice.fromFragment([createText(" Ritor ")]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getStructure(result.doc!)).toEqual(getStructure(createDoc(createPara(createText("Hell Ritor ld!")))));
        });
    });

    // --- Existing Multi-Block Replacements ---
    describe('Multi-Block Replacements (No Slice Opening)', () => {
        it('should delete a full paragraph between two others', () => {
            const initialDoc = createDoc(createPara(createText("P1")), createPara(createText("P2")), createPara(createText("P3")));
            const p1Size = schema.node(schema.nodes.paragraph, {}, [createText("P1")]).nodeSize;
            const p2Size = schema.node(schema.nodes.paragraph, {}, [createText("P2")]).nodeSize;
            const from = p1Size; const to = p1Size + p2Size;
            const step = new ReplaceStep(from, to, Slice.empty);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getStructure(result.doc!)).toEqual(getStructure(createDoc(createPara(createText("P1")), createPara(createText("P3")))));
        });
        it('should replace all content of a doc with mixed inline content in slice (PoC wrapping)', () => {
            const initialDoc = createDoc(createPara(createText("Old")));
            const from = 0; const to = initialDoc.nodeSize;
            const slice = Slice.fromFragment([createText("New "), createText("inline.")]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getStructure(result.doc!)).toEqual(getStructure(createDoc(createPara(createText("New inline.")))));
        });
    });

    // --- New tests for Slice openStart/openEnd ---
    describe('ReplaceStep.apply with Slice openStart/openEnd for Inline Merging', () => {
        it('Test 1: Inline merge at start (openStart=1) in "AAACCC" with "BBB" -> "AAABBBCCC"', () => {
            const initialDoc = createDoc(createPara(createText("AAACCC")));
            const from = modelPositionToFlatOffset(initialDoc, { path: [0, 0], offset: 3 }, schema); // After "AAA"
            const to = from; // Insertion
            const slice = new Slice([createText("BBB")], 1, 0); // openStart=1
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getStructure(result.doc!)).toEqual(getStructure(createDoc(createPara(createText("AAABBBCCC")))));
        });

        it('Test 2: Inline merge at end (openEnd=1) in "AAACCC" with "BBB" -> "AAABBBCCC"', () => {
            const initialDoc = createDoc(createPara(createText("AAACCC")));
            const from = modelPositionToFlatOffset(initialDoc, { path: [0, 0], offset: 3 }, schema); // After "AAA"
            const to = from;
            const slice = new Slice([createText("BBB")], 0, 1); // openEnd=1
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getStructure(result.doc!)).toEqual(getStructure(createDoc(createPara(createText("AAABBBCCC")))));
        });

        it('Test 3: Inline merge at both start and end (openStart=1, openEnd=1)', () => {
            const initialDoc = createDoc(createPara(createText("AAA CCC"))); // Note space
            const from = modelPositionToFlatOffset(initialDoc, { path: [0, 0], offset: 3 }, schema); // After "AAA"
            const to = modelPositionToFlatOffset(initialDoc, { path: [0, 0], offset: 4 }, schema); // Select space
            const slice = new Slice([createText("BBB")], 1, 1);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getStructure(result.doc!)).toEqual(getStructure(createDoc(createPara(createText("AAABBBCCC")))));
        });

        it('Test 4: Mark compatibility for merge (openStart=1, openEnd=1)', () => {
            const initialDoc = createDoc(createPara(
                createText("AAA ", [{type: 'bold'}]),
                createText("CCC", [{type: 'bold'}])
            ));
            // Target between "AAA " (bold) and "CCC" (bold)
            const from = modelPositionToFlatOffset(initialDoc, { path: [0, 0], offset: 4 }, schema);
            const to = from;

            const slice = new Slice([createText("BBB", [{type: 'bold'}])], 1, 1);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);

            expect(result.failed).toBeUndefined();
            // Expect: <p><strong>AAA BBBCCC</strong></p> (single text node due to mark compatibility and normalization)
            expect(getStructure(result.doc!)).toEqual(getStructure(createDoc(createPara(
                createText("AAA BBBCCC", [{type: 'bold'}])
            ))));
        });

        it('Test 5: Mark incompatibility prevents merge (openStart=1, openEnd=1)', () => {
            const initialDoc = createDoc(createPara(
                createText("AAA ", [{type: 'bold'}]),
                createText("CCC", [{type: 'italic'}])
            ));
            const from = modelPositionToFlatOffset(initialDoc, { path: [0, 0], offset: 4 }, schema); // After "AAA " (bold)
            const to = from;

            const slice = new Slice([createText("BBB", [{type: 'bold'}])], 1, 1);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);

            expect(result.failed).toBeUndefined();
            // Expect: <p><strong>AAA BBB</strong><em>CCC</em></p>
            expect(getStructure(result.doc!)).toEqual(getStructure(createDoc(createPara(
                createText("AAA BBB", [{type: 'bold'}]),
                createText("CCC", [{type: 'italic'}])
            ))));
        });

        it('Insert with openStart into empty paragraph', () => {
            const initialDoc = createDoc(createPara(createText("")));
            const from = 1; const to = 1;
            const slice = new Slice([createText("Hello")], 1, 0);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getStructure(result.doc!)).toEqual(getStructure(createDoc(createPara(createText("Hello")))));
        });

        it('Insert with openEnd at end of paragraph', () => {
            const initialDoc = createDoc(createPara(createText("Hello")));
            const from = 1 + 5; const to = 1 + 5;
            const slice = new Slice([createText(" World")], 0, 1);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getStructure(result.doc!)).toEqual(getStructure(createDoc(createPara(createText("Hello World")))));
        });

        it('Replace content with an empty slice with openStart/openEnd > 0 should delete and merge if compatible', () => {
            const initialDoc = createDoc(createPara( createText("Start "), createText("Middle", [{type: 'bold'}]), createText(" End") ));
            const from = modelPositionToFlatOffset(initialDoc, {path: [0,1], offset: 0}, schema);
            const to = modelPositionToFlatOffset(initialDoc, {path: [0,1], offset: 6}, schema);
            const slice = new Slice([], 1, 1);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getStructure(result.doc!)).toEqual(getStructure(createDoc(createPara( createText("Start  End") ))));
        });
    });

    describe('ReplaceStep.invert', () => {
        // ... (existing invert tests are kept) ...
        it('should invert a text replacement in the middle of a paragraph', () => {
            const initialDoc = createDoc(createPara(createText("Hello world!")));
            const from = 7; const to = 12;
            const slice = Slice.fromFragment([createText("Ritor")]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);
            expect(result.doc).toBeDefined();
            const invertedStep = step.invert(initialDoc);
            expect(invertedStep).not.toBeNull();
            const resultAfterInvert = (invertedStep! as ReplaceStep).apply(result.doc!);
            expect(resultAfterInvert.failed).toBeUndefined();
            expect(docsAreEqual(resultAfterInvert.doc!, initialDoc)).toBe(true);
        });
        it('should invert deleting a full paragraph (PoC multi-block)', () => {
            const initialDoc = createDoc(createPara(createText("P1")), createPara(createText("P2-DEL")), createPara(createText("P3")));
            const p1Size = schema.node(schema.nodes.paragraph, {}, [createText("P1")]).nodeSize;
            const p2DelSize = schema.node(schema.nodes.paragraph, {}, [createText("P2-DEL")]).nodeSize;
            const from = p1Size; const to = from + p2DelSize;
            const step = new ReplaceStep(from, to, Slice.empty);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getStructure(result.doc!)).toEqual(getStructure(createDoc(createPara(createText("P1")), createPara(createText("P3")))));
            const invertedStep = step.invert(initialDoc);
            expect(invertedStep).not.toBeNull();
            const resultAfterInvert = (invertedStep! as ReplaceStep).apply(result.doc!);
            expect(resultAfterInvert.failed).toBeUndefined();
            expect(docsAreEqual(resultAfterInvert.doc!, initialDoc)).toBe(true);
        });
    });
});
