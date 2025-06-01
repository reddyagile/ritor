// test/replaceStep.test.ts

import { ReplaceStep } from '../src/transform/replaceStep.js';
import { Slice } from '../src/transform/slice.js';
import { Schema } from '../src/schema.js';
import { basicNodeSpecs, basicMarkSpecs } from '../src/basicSchema.js';
import { DocNode, TextNode, BaseNode, Mark } from '../src/documentModel.js';
import { modelPositionToFlatOffset, flatOffsetToModelPosition } from '../src/modelUtils.js';

// Enable debug logging in ReplaceStep
(globalThis as any).DEBUG_REPLACESTEP = false; // Disabled for full suite run

const schema = new Schema({ nodes: basicNodeSpecs, marks: basicMarkSpecs });

// Helper functions
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
const getDocTextRepresentation = (doc: DocNode): string[] => {
    if (!doc || !doc.content) return [];
    return doc.content.map(block => {
        if (!block.content) return `(${block.type.name})`;
        return (block.content as BaseNode[])
            .map(inline => (inline.isText && !inline.isLeaf) ? (inline as TextNode).text : `(${(inline as BaseNode).type.name})`)
            .join('');
    });
};
const docsAreEqual = (doc1: DocNode, doc2: DocNode): boolean => {
    const rep1 = getDocTextRepresentation(doc1).join('\n');
    const rep2 = getDocTextRepresentation(doc2).join('\n');
    if (rep1 !== rep2) {
        console.log("Docs not equal (textual):");
        console.log("Doc1:", rep1);
        console.log("Doc2:", rep2);
        // console.log("Doc1 JSON:", JSON.stringify(doc1));
        // console.log("Doc2 JSON:", JSON.stringify(doc2));
        return false;
    }
    // Add more robust JSON comparison if needed, but be wary of object circularity if not handled by stringify
    return true;
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
            expect(getDocTextRepresentation(result.doc!)).toEqual(["Hello Ritor!"]);
        });
        // ... other single-block tests remain unchanged ...
        it('should delete text from the start of a paragraph', () => {
            const initialDoc = createDoc(createPara(createText("Hello world!")));
            const from = 1; const to = 6; // "Hello"
            const step = new ReplaceStep(from, to, Slice.empty);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getDocTextRepresentation(result.doc!)).toEqual([" world!"]);
        });
        it('should delete text from the end of a paragraph', () => {
            const initialDoc = createDoc(createPara(createText("Hello world!")));
            const from = 7; const to = 13; // "world!"
            const step = new ReplaceStep(from, to, Slice.empty);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getDocTextRepresentation(result.doc!)).toEqual(["Hello "]);
        });
        it('should replace the entire content of a paragraph', () => {
            const initialDoc = createDoc(createPara(createText("Hello world!")));
            const from = 1; const to = 13;
            const slice = Slice.fromFragment([createText("New content")]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getDocTextRepresentation(result.doc!)).toEqual(["New content"]);
        });
        it('should insert text into an empty paragraph', () => {
            const initialDoc = createDoc(createPara(createText("")));
            const from = 1; const to = 1;
            const slice = Slice.fromFragment([createText("Inserted")]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getDocTextRepresentation(result.doc!)).toEqual(["Inserted"]);
        });
        it('should insert text at the start of a paragraph', () => {
            const initialDoc = createDoc(createPara(createText("world!")));
            const from = 1; const to = 1;
            const slice = Slice.fromFragment([createText("Hello ")]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getDocTextRepresentation(result.doc!)).toEqual(["Hello world!"]);
        });
        it('should insert text at the end of a paragraph', () => {
            const initialDoc = createDoc(createPara(createText("Hello")));
            const from = 6; const to = 6;
            const slice = Slice.fromFragment([createText(" world!")]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getDocTextRepresentation(result.doc!)).toEqual(["Hello world!"]);
        });
         it('should replace text across two text nodes within a paragraph', () => {
            const initialDoc = createDoc(createPara(createText("Hello "), createText("world!")));
            const from = modelPositionToFlatOffset(initialDoc, { path: [0,0], offset: 4 }, schema);
            const to = modelPositionToFlatOffset(initialDoc, { path: [0,1], offset: 3 }, schema);
            const slice = Slice.fromFragment([createText(" Ritor ")]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getDocTextRepresentation(result.doc!)).toEqual(["Hell Ritor ld!"]);
        });
    });

    describe('Multi-Block Replacements', () => {
        it('should delete a full paragraph between two others', () => {
            const initialDoc = createDoc(createPara(createText("P1")), createPara(createText("P2")), createPara(createText("P3")));
            const p1Size = 1+2+1; const p2Size = 1+2+1;
            const from = p1Size; const to = p1Size + p2Size;
            const step = new ReplaceStep(from, to, Slice.empty);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getDocTextRepresentation(result.doc!)).toEqual(["P1", "P3"]);
        });
        it('should replace a full paragraph with another paragraph', () => {
            const initialDoc = createDoc(createPara(createText("Old")));
            const from = 0; const to = initialDoc.nodeSize;
            const slice = Slice.fromFragment([createPara(createText("New"))]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getDocTextRepresentation(result.doc!)).toEqual(["New"]);
        });
        it('should delete a range starting in one para and ending in another (approximate result)', () => {
            const initialDoc = createDoc(createPara(createText("ParaOneEnd")), createPara(createText("StartParaTwo")));
            const from = modelPositionToFlatOffset(initialDoc, { path: [0,0], offset: 7 }, schema);
            const to = modelPositionToFlatOffset(initialDoc, { path: [1,0], offset: 5 }, schema);
            const step = new ReplaceStep(from, to, Slice.empty);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getDocTextRepresentation(result.doc!)).toEqual(["ParaOne", "ParaTwo"]);
        });
        it('should replace multiple paragraphs with a single new paragraph', () => {
            const initialDoc = createDoc(createPara(createText("P1")), createPara(createText("P2")));
            const from = 0; const to = initialDoc.nodeSize;
            const slice = Slice.fromFragment([createPara(createText("NewP"))]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getDocTextRepresentation(result.doc!)).toEqual(["NewP"]);
        });
        it('should replace a paragraph with multiple new paragraphs (from slice)', () => {
            const initialDoc = createDoc(createPara(createText("OldP")));
            const from = 0; const to = initialDoc.nodeSize;
            const slice = Slice.fromFragment([createPara(createText("NewP1")), createPara(createText("NewP2"))]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getDocTextRepresentation(result.doc!)).toEqual(["NewP1", "NewP2"]);
        });
        it('should replace all content of a doc with mixed inline content in slice (PoC wrapping)', () => {
            const initialDoc = createDoc(createPara(createText("Old")));
            const from = 0; const to = initialDoc.nodeSize;
            const slice = Slice.fromFragment([createText("New "), createText("inline.")]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getDocTextRepresentation(result.doc!)).toEqual(["New inline."]);
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
            const initialDoc = createDoc(
                createPara(createText("P1")),
                createPara(createText("P2-DEL")),
                createPara(createText("P3"))
            );
            const p1Size = schema.node(schema.nodes.paragraph, {}, [createText("P1")]).nodeSize; // 4
            const p2DelSize = schema.node(schema.nodes.paragraph, {}, [createText("P2-DEL")]).nodeSize; // 10

            const from = p1Size;
            const to = from + p2DelSize;

            console.log(`DEBUG: Test 'invert deleting full paragraph'. initialDoc text: ${getDocTextRepresentation(initialDoc).join('|')}`);
            console.log(`DEBUG: from=${from}, to=${to} (deleting P2-DEL)`);

            const step = new ReplaceStep(from, to, Slice.empty);
            const result = step.apply(initialDoc);

            console.log(`DEBUG: After apply, result.doc text: ${getDocTextRepresentation(result.doc!).join('|')}`);
            expect(result.failed).toBeUndefined();
            expect(getDocTextRepresentation(result.doc!)).toEqual(["P1", "P3"]); // This is where it failed previously

            const invertedStep = step.invert(initialDoc);
            expect(invertedStep).not.toBeNull();
            const invertedReplaceStep = invertedStep as ReplaceStep; // Cast to ReplaceStep
            console.log(`DEBUG: Inverted step: from=${invertedReplaceStep.from}, to=${invertedReplaceStep.to}, slice content: ${getDocTextRepresentation(createDoc(...invertedReplaceStep.slice.content)).join('|')}`);

            const resultAfterInvert = invertedReplaceStep.apply(result.doc!);
            console.log(`DEBUG: After inverted apply, resultAfterInvert.doc text: ${getDocTextRepresentation(resultAfterInvert.doc!).join('|')}`);

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
            expect(result.doc).toBeDefined();
            expect(getDocTextRepresentation(result.doc!)).toEqual(["P1", "P2-NEW", "P3"]);
            const invertedStep = step.invert(initialDoc);
            expect(invertedStep).not.toBeNull();
            const resultAfterInvert = invertedStep!.apply(result.doc!);
            expect(resultAfterInvert.failed).toBeUndefined();
            expect(docsAreEqual(resultAfterInvert.doc!, initialDoc)).toBe(true);
        });
    });
});
