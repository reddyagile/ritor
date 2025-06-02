// test/replaceStep.test.ts

import { ReplaceStep } from '../src/transform/replaceStep.js';
import { Slice } from '../src/transform/slice.js';
import { Schema } from '../src/schema.js';
import { basicNodeSpecs, basicMarkSpecs } from '../src/basicSchema.js';
import { DocNode, TextNode, BaseNode, Mark } from '../src/documentModel.js';
import { modelPositionToFlatOffset, flatOffsetToModelPosition } from '../src/modelUtils.js';

// Disable debug logging in ReplaceStep for cleaner test output
(globalThis as any).DEBUG_REPLACESTEP = false;

const schema = new Schema({ nodes: basicNodeSpecs, marks: basicMarkSpecs });

// Helper functions to create nodes
const createMark = (type: string, attrs?: any): Mark => schema.marks[type]?.create(attrs) as Mark;

const createText = (text: string, marksArray?: {type: string, attrs?: any}[]): TextNode => {
    const marks = marksArray?.map(m => createMark(m.type, m.attrs)).filter(m => !!m) || [];
    return schema.text(text, marks) as TextNode;
};

const createPara = (...content: (TextNode | BaseNode)[]): BaseNode => {
    return schema.node(schema.nodes.paragraph, {}, content);
};

const createHeading = (level: number, ...content: (TextNode | BaseNode)[]): BaseNode => {
    return schema.node(schema.nodes.heading, { level }, content);
};

const createDoc = (...content: BaseNode[]): DocNode => {
    return schema.node(schema.nodes.doc, {}, content) as DocNode;
};

// New helper for structural comparison
const getDocStructure = (node: BaseNode): any => {
    if (node.isText && !node.isLeaf) {
        const textNode = node as TextNode;
        const marks = (textNode.marks || []).map(m => m.type.name).sort(); // Get mark type names and sort for consistent comparison
        return { type: 'text', text: textNode.text, ...(marks.length ? { marks } : {}) };
    }

    const content = node.content ? node.content.map(getDocStructure) : [];
    const attrsToCompare = { ...node.attrs };
    delete attrsToCompare.id; // Ignore auto-generated ID for structural comparison

    return {
        type: node.type.name,
        ...(Object.keys(attrsToCompare).length ? { attrs: attrsToCompare } : {}),
        ...(content.length ? { content } : {})
    };
};

// Helper to get simple text array for some tests (can be deprecated if getDocStructure is always used)
const getSimpleTextArray = (doc: DocNode): string[] => {
    if (!doc || !doc.content) return [];
    return doc.content.map(block => {
        if (!block.content) return `(${block.type.name})`;
        return (block.content as BaseNode[])
            .map(inline => (inline.isText && !inline.isLeaf) ? (inline as TextNode).text : `(${(inline as BaseNode).type.name})`)
            .join('');
    });
};


const docsAreEqual = (doc1: DocNode, doc2: DocNode): boolean => {
    const struct1 = getDocStructure(doc1);
    const struct2 = getDocStructure(doc2);
    const match = JSON.stringify(struct1) === JSON.stringify(struct2);
    if (!match) {
        console.log("Docs not equal (structural):");
        console.log("Doc1:", JSON.stringify(struct1, null, 2));
        console.log("Doc2:", JSON.stringify(struct2, null, 2));
    }
    return match;
};


describe('ReplaceStep.apply', () => {
    describe('Single-Block Inline Replacements', () => {
        it('should replace text in the middle of a paragraph', () => {
            const initialDoc = createDoc(createPara(createText("Hello world!")));
            const from = 7; const to = 12;
            const slice = Slice.fromFragment([createText("Ritor")]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getDocStructure(result.doc!)).toEqual(getDocStructure(createDoc(createPara(createText("Hello Ritor!")))));
        });
        it('should delete text from the start of a paragraph', () => {
            const initialDoc = createDoc(createPara(createText("Hello world!")));
            const from = 1; const to = 6;
            const step = new ReplaceStep(from, to, Slice.empty);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getDocStructure(result.doc!)).toEqual(getDocStructure(createDoc(createPara(createText(" world!")))));
        });
        it('should delete text from the end of a paragraph', () => {
            const initialDoc = createDoc(createPara(createText("Hello world!")));
            const from = 7; const to = 13;
            const step = new ReplaceStep(from, to, Slice.empty);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getDocStructure(result.doc!)).toEqual(getDocStructure(createDoc(createPara(createText("Hello ")))));
        });
        it('should replace the entire content of a paragraph', () => {
            const initialDoc = createDoc(createPara(createText("Hello world!")));
            const from = 1; const to = 13;
            const slice = Slice.fromFragment([createText("New content")]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getDocStructure(result.doc!)).toEqual(getDocStructure(createDoc(createPara(createText("New content")))));
        });
        it('should insert text into an empty paragraph', () => {
            const initialDoc = createDoc(createPara(createText("")));
            const from = 1; const to = 1;
            const slice = Slice.fromFragment([createText("Inserted")]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getDocStructure(result.doc!)).toEqual(getDocStructure(createDoc(createPara(createText("Inserted")))));
        });
        it('should insert text at the start of a paragraph', () => {
            const initialDoc = createDoc(createPara(createText("world!")));
            const from = 1; const to = 1;
            const slice = Slice.fromFragment([createText("Hello ")]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getDocStructure(result.doc!)).toEqual(getDocStructure(createDoc(createPara(createText("Hello world!")))));
        });
        it('should insert text at the end of a paragraph', () => {
            const initialDoc = createDoc(createPara(createText("Hello")));
            const from = 6; const to = 6;
            const slice = Slice.fromFragment([createText(" world!")]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getDocStructure(result.doc!)).toEqual(getDocStructure(createDoc(createPara(createText("Hello world!")))));
        });
         it('should replace text across two text nodes within a paragraph', () => {
            const initialDoc = createDoc(createPara(createText("Hello "), createText("world!")));
            const from = modelPositionToFlatOffset(initialDoc, { path: [0,0], offset: 4 }, schema);
            const to = modelPositionToFlatOffset(initialDoc, { path: [0,1], offset: 3 }, schema);
            const slice = Slice.fromFragment([createText(" Ritor ")]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getDocStructure(result.doc!)).toEqual(getDocStructure(createDoc(createPara(createText("Hell Ritor ld!")))));
        });
    });

    describe('Multi-Block Replacements', () => {
        it('should delete a full paragraph between two others', () => {
            const initialDoc = createDoc(createPara(createText("P1")), createPara(createText("P2")), createPara(createText("P3")));
            const p1Size = schema.node(schema.nodes.paragraph, {}, [createText("P1")]).nodeSize;
            const p2Size = schema.node(schema.nodes.paragraph, {}, [createText("P2")]).nodeSize;
            const from = p1Size; const to = p1Size + p2Size;
            const step = new ReplaceStep(from, to, Slice.empty);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getDocStructure(result.doc!)).toEqual(getDocStructure(createDoc(createPara(createText("P1")), createPara(createText("P3")))));
        });
        it('should replace a full paragraph with another paragraph', () => {
            const initialDoc = createDoc(createPara(createText("Old")));
            const from = 0; const to = initialDoc.nodeSize;
            const slice = Slice.fromFragment([createPara(createText("New"))]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getDocStructure(result.doc!)).toEqual(getDocStructure(createDoc(createPara(createText("New")))));
        });
        it('should delete a range starting in one para and ending in another (approximate PoC result)', () => {
            const initialDoc = createDoc(createPara(createText("ParaOneEnd")), createPara(createText("StartParaTwo")));
            const from = modelPositionToFlatOffset(initialDoc, { path: [0,0], offset: 7 }, schema);
            const to = modelPositionToFlatOffset(initialDoc, { path: [1,0], offset: 5 }, schema);
            const step = new ReplaceStep(from, to, Slice.empty);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            // Current PoC is expected to result in ["ParaOne", "ParaTwo"]
            expect(getDocStructure(result.doc!)).toEqual(getDocStructure(createDoc(createPara(createText("ParaOne")), createPara(createText("ParaTwo")))));
        });
        it('should replace multiple paragraphs with a single new paragraph', () => {
            const initialDoc = createDoc(createPara(createText("P1")), createPara(createText("P2")));
            const from = 0; const to = initialDoc.nodeSize;
            const slice = Slice.fromFragment([createPara(createText("NewP"))]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getDocStructure(result.doc!)).toEqual(getDocStructure(createDoc(createPara(createText("NewP")))));
        });
        it('should replace a paragraph with multiple new paragraphs (from slice)', () => {
            const initialDoc = createDoc(createPara(createText("OldP")));
            const from = 0; const to = initialDoc.nodeSize;
            const slice = Slice.fromFragment([createPara(createText("NewP1")), createPara(createText("NewP2"))]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getDocStructure(result.doc!)).toEqual(getDocStructure(createDoc(createPara(createText("NewP1")), createPara(createText("NewP2")))));
        });
        it('should replace all content of a doc with mixed inline content in slice (PoC wrapping)', () => {
            const initialDoc = createDoc(createPara(createText("Old")));
            const from = 0; const to = initialDoc.nodeSize;
            const slice = Slice.fromFragment([createText("New "), createText("inline.")]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            // Expect the inline content to be wrapped in a single paragraph by current PoC logic
            expect(getDocStructure(result.doc!)).toEqual(getDocStructure(createDoc(createPara(createText("New inline.")))));
        });
    });

    describe('Advanced Multi-Block Replacements (Targeting Partial Block Logic)', () => {
        it('Test 1: Replace starting mid-P1, ending mid-P2, with a block slice', () => {
            const initialDoc = createDoc(
                createPara(createText("AAAA")), // P0: "AAAA" -> size 1+4+1=6
                createPara(createText("BBBB")), // P1: "BBBB" -> size 1+4+1=6
                createPara(createText("CCCC"))  // P2: "CCCC" -> size 1+4+1=6
            );
            // Replace from after "AA" in P0 to before "BB" (second B) in P1.
            // Flat from: P0_open(1) + "AA"(2) = 3
            // Flat to: P0_size(6) + P1_open(1) + "B"(1) + "B"(1) = 6 + 1 + 2 = 9
            const from = 3;
            const to = 9;
            const slice = Slice.fromFragment([createPara(createText("XXX"))]); // Block slice
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);

            expect(result.failed).toBeUndefined();
            // Expected: P0 keeps "AA". P1's "BB" (second B onwards) is kept. Slice "XXX" inserted.
            // PoC current expectation: doc( para("AA"), para("XXX"), para("BB"), para("CCCC") )
            // P0's "AA" (remaining from "AAAA") -> new block
            // P1's "BB" (remaining from "BBBB") -> new block
            expect(getDocStructure(result.doc!)).toEqual(getDocStructure(createDoc(
                createPara(createText("AA")),
                createPara(createText("XXX")),
                createPara(createText("BB")),
                createPara(createText("CCCC"))
            )));
        });

        it('Test 2: Replace from start of P0, ending mid-P1, with a block slice', () => {
            const initialDoc = createDoc(
                createPara(createText("AAAA")), // P0
                createPara(createText("BBBB")), // P1
                createPara(createText("CCCC"))  // P2
            );
            // Replace from start of P0 (flat offset 0 for content, but step needs actual doc start)
            // Flat from: 0 (very start of doc, meaning P0 is the first affected block from its beginning)
            // Flat to: P0_size(6) + P1_open(1) + "BB"(2) = 9
            const from = 0;
            const to = 9;
            const slice = Slice.fromFragment([createPara(createText("XXX"))]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);

            expect(result.failed).toBeUndefined();
            // Expected: P0 is gone. P1's "BB" (second B onwards) is kept. Slice "XXX" inserted before it.
            // PoC current expectation: doc( para("XXX"), para("BB"), para("CCCC") )
            expect(getDocStructure(result.doc!)).toEqual(getDocStructure(createDoc(
                createPara(createText("XXX")),
                createPara(createText("BB")),
                createPara(createText("CCCC"))
            )));
        });

        it('Test 3: Replace starting mid-P0, ending end of P1, with a block slice', () => {
            const initialDoc = createDoc(
                createPara(createText("AAAA")), // P0
                createPara(createText("BBBB")), // P1
                createPara(createText("CCCC"))  // P2
            );
            // Replace from after "AA" in P0 to end of P1.
            // Flat from: P0_open(1) + "AA"(2) = 3
            // Flat to: P0_size(6) + P1_size(6) = 12
            const from = 3;
            const to = 12;
            const slice = Slice.fromFragment([createPara(createText("XXX"))]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);

            expect(result.failed).toBeUndefined();
            // Expected: P0 keeps "AA". P1 is gone. Slice "XXX" inserted. P2 ("CCCC") remains.
            // PoC current expectation: doc( para("AA"), para("XXX"), para("CCCC") )
            expect(getDocStructure(result.doc!)).toEqual(getDocStructure(createDoc(
                createPara(createText("AA")),
                createPara(createText("XXX")),
                createPara(createText("CCCC"))
            )));
        });

        it('Test 4: Replace entire document content with a single paragraph slice', () => {
            const initialDoc = createDoc(createPara(createText("AAAA")), createPara(createText("BBBB")));
            const from = 0;
            const to = initialDoc.nodeSize;
            const slice = Slice.fromFragment([createPara(createText("XXX"))]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getDocStructure(result.doc!)).toEqual(getDocStructure(createDoc(createPara(createText("XXX")))));
        });

        it('Test 5: Replace a middle paragraph with multiple paragraphs from slice', () => {
            const p1 = createPara(createText("P1"));
            const p2Replace = createPara(createText("P2_to_replace"));
            const p3 = createPara(createText("P3"));
            const initialDoc = createDoc(p1, p2Replace, p3);

            const from = p1.nodeSize;
            const to = from + p2Replace.nodeSize;
            const slice = Slice.fromFragment([createPara(createText("NewA")), createPara(createText("NewB"))]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);

            expect(result.failed).toBeUndefined();
            expect(getDocStructure(result.doc!)).toEqual(getDocStructure(createDoc(
                createPara(createText("P1")),
                createPara(createText("NewA")),
                createPara(createText("NewB")),
                createPara(createText("P3"))
            )));
        });

        it('Test 6: Insert multiple paragraphs (from slice) into an empty document', () => {
            const initialDoc = createDoc(); // Truly empty doc
            const from = 0; const to = 0;
            const slice = Slice.fromFragment([createPara(createText("NewA")), createPara(createText("NewB"))]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);

            expect(result.failed).toBeUndefined();
            expect(getDocStructure(result.doc!)).toEqual(getDocStructure(createDoc(
                createPara(createText("NewA")),
                createPara(createText("NewB"))
            )));
        });

        it('Test 7: Insert inline slice into middle of blocks (PoC block wrapping)', () => {
            const initialDoc = createDoc(
                createPara(createText("AAA")), // P0 size 1+3+1=5
                createPara(createText("BBB"))  // P1 size 1+3+1=5
            );
            // Insert "XXX" between P0 and P1. Flat pos: 5
            const from = 5; const to = 5;
            const slice = Slice.fromFragment([createText("XXX")]); // Inline slice
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);

            expect(result.failed).toBeUndefined();
            // Current PoC ReplaceStep wraps inline slice content in a new paragraph
            // when the replacement context is block-level.
            expect(getDocStructure(result.doc!)).toEqual(getDocStructure(createDoc(
                createPara(createText("AAA")),
                createPara(createText("XXX")), // Wrapped
                createPara(createText("BBB"))
            )));
        });

    });

    describe('ReplaceStep.invert', () => {
        it('should invert a text replacement in the middle of a paragraph', () => {
            const initialDoc = createDoc(createPara(createText("Hello world!")));
            const from = 7; const to = 12;
            const slice = Slice.fromFragment([createText("Ritor")]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);
            expect(result.doc).toBeDefined();
            const invertedStep = step.invert(initialDoc);
            expect(invertedStep).not.toBeNull();
            const resultAfterInvert = invertedStep!.apply(result.doc!);
            expect(resultAfterInvert.failed).toBeUndefined();
            expect(docsAreEqual(resultAfterInvert.doc!, initialDoc)).toBe(true);
        });

        it('should invert a text deletion from a paragraph', () => {
            const initialDoc = createDoc(createPara(createText("Hello world!")));
            const from = 1; const to = 7;
            const step = new ReplaceStep(from, to, Slice.empty);
            const result = step.apply(initialDoc);
            expect(result.doc).toBeDefined();
            const invertedStep = step.invert(initialDoc);
            expect(invertedStep).not.toBeNull();
            const resultAfterInvert = invertedStep!.apply(result.doc!);
            expect(resultAfterInvert.failed).toBeUndefined();
            expect(docsAreEqual(resultAfterInvert.doc!, initialDoc)).toBe(true);
        });

        it('should invert a text insertion into a paragraph', () => {
            const initialDoc = createDoc(createPara(createText("Hello !")));
            const from = 7; const to = 7;
            const slice = Slice.fromFragment([createText("world")]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);
            expect(result.doc).toBeDefined();
            const invertedStep = step.invert(initialDoc);
            expect(invertedStep).not.toBeNull();
            const resultAfterInvert = invertedStep!.apply(result.doc!);
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
            expect(getDocStructure(result.doc!)).toEqual(getDocStructure(createDoc(createPara(createText("P1")), createPara(createText("P3")))));
            const invertedStep = step.invert(initialDoc);
            expect(invertedStep).not.toBeNull();
            const resultAfterInvert = (invertedStep! as ReplaceStep).apply(result.doc!);
            expect(resultAfterInvert.failed).toBeUndefined();
            expect(docsAreEqual(resultAfterInvert.doc!, initialDoc)).toBe(true);
        });

        it('should invert replacing a full paragraph (PoC multi-block)', () => {
            const initialDoc = createDoc(createPara(createText("P1")), createPara(createText("P2-OLD")), createPara(createText("P3")));
            const p1Size = schema.node(schema.nodes.paragraph, {}, [createText("P1")]).nodeSize;
            const p2OldSize = schema.node(schema.nodes.paragraph, {}, [createText("P2-OLD")]).nodeSize;
            const from = p1Size; const to = p1Size + p2OldSize;
            const newP2Node = createPara(createText("P2-NEW"));
            const slice = Slice.fromFragment([newP2Node]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getDocStructure(result.doc!)).toEqual(getDocStructure(createDoc(createPara(createText("P1")), createPara(createText("P2-NEW")), createPara(createText("P3")))));
            const invertedStep = step.invert(initialDoc);
            expect(invertedStep).not.toBeNull();
            const resultAfterInvert = (invertedStep! as ReplaceStep).apply(result.doc!);
            expect(resultAfterInvert.failed).toBeUndefined();
            expect(docsAreEqual(resultAfterInvert.doc!, initialDoc)).toBe(true);
        });
    });
});
