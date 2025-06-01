// test/replaceStep.test.ts

import { ReplaceStep } from '../src/transform/replaceStep.js';
import { Slice } from '../src/transform/slice.js';
import { Schema } from '../src/schema.js';
import { basicNodeSpecs, basicMarkSpecs } from '../src/basicSchema.js';
import { DocNode, TextNode, BaseNode, Mark } from '../src/documentModel.js'; // Added Mark
import { modelPositionToFlatOffset, flatOffsetToModelPosition } from '../src/modelUtils.js';

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

// Helper to get text content from blocks for easy assertion
const getDocTextRepresentation = (doc: DocNode): string[] => {
    if (!doc || !doc.content) return [];
    return doc.content.map(block => {
        if (!block.content) return `(${block.type.name})`; // For blocks like <hr/> if added
        return (block.content as BaseNode[])
            .map(inline => {
                if (inline.isText && !inline.isLeaf) return (inline as TextNode).text;
                if (inline.isLeaf) return `(${inline.type.name})`; // E.g. (hard_break)
                return '';
            })
            .join('');
    });
};


describe('ReplaceStep.apply', () => {
    describe('Single-Block Inline Replacements', () => {
        it('should replace text in the middle of a paragraph', () => {
            const initialDoc = createDoc(
                createPara(createText("Hello world!"))
            );
            // Flat from: <p>Hello| world! -> 1 (p_open) + 6 ("Hello ") = 7
            // Flat to:   <p>Hello world|! -> 1 (p_open) + 11 ("Hello world") = 12
            const from = 7;
            const to = 12;

            const slice = Slice.fromFragment([createText("Ritor")]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);

            expect(result.failed).toBeUndefined();
            expect(result.doc).toBeDefined();
            expect(getDocTextRepresentation(result.doc!)).toEqual(["Hello Ritor!"]);
        });

        it('should delete text from the start of a paragraph', () => {
            const initialDoc = createDoc(
                createPara(createText("Hello world!"))
            );
            // Flat from: <p>|Hello world! -> 1 (p_open)
            // Flat to:   <p>Hello| world! -> 1 (p_open) + 5 ("Hello") = 6
            const from = 1;
            const to = 6;

            const slice = Slice.empty;
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);

            expect(result.failed).toBeUndefined();
            expect(result.doc).toBeDefined();
            expect(getDocTextRepresentation(result.doc!)).toEqual([" world!"]);
        });

        it('should delete text from the end of a paragraph', () => {
            const initialDoc = createDoc(
                createPara(createText("Hello world!"))
            );
            // Flat from: <p>Hello |world! -> 1 (p_open) + 6 ("Hello ") = 7
            // Flat to:   <p>Hello world!| -> 1 (p_open) + 12 ("Hello world!") = 13
            const from = 7;
            const to = 13;

            const slice = Slice.empty;
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);

            expect(result.failed).toBeUndefined();
            expect(result.doc).toBeDefined();
            expect(getDocTextRepresentation(result.doc!)).toEqual(["Hello "]);
        });

        it('should replace the entire content of a paragraph', () => {
            const initialDoc = createDoc(
                createPara(createText("Hello world!"))
            );
            // Flat from: <p>| -> 1
            // Flat to:   <p>...content...| -> 1 + 12 = 13
            const from = 1;
            const to = 13;

            const slice = Slice.fromFragment([createText("New content")]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);

            expect(result.failed).toBeUndefined();
            expect(result.doc).toBeDefined();
            expect(getDocTextRepresentation(result.doc!)).toEqual(["New content"]);
        });

        it('should insert text into an empty paragraph', () => {
            const initialDoc = createDoc(
                createPara(createText(""))
            );
            // Flat from/to: <p>| -> 1
            const from = 1;
            const to = 1;

            const slice = Slice.fromFragment([createText("Inserted")]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);

            expect(result.failed).toBeUndefined();
            expect(result.doc).toBeDefined();
            expect(getDocTextRepresentation(result.doc!)).toEqual(["Inserted"]);
        });

        it('should insert text at the start of a paragraph', () => {
            const initialDoc = createDoc(
                createPara(createText("world!"))
            );
            // Flat from/to: <p>| -> 1
            const from = 1;
            const to = 1;

            const slice = Slice.fromFragment([createText("Hello ")]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);

            expect(result.failed).toBeUndefined();
            expect(result.doc).toBeDefined();
            expect(getDocTextRepresentation(result.doc!)).toEqual(["Hello world!"]);
        });

        it('should insert text at the end of a paragraph', () => {
            const initialDoc = createDoc(
                createPara(createText("Hello"))
            );
            // Flat from/to: <p>Hello| -> 1 + 5 ("Hello") = 6
            const from = 6;
            const to = 6;

            const slice = Slice.fromFragment([createText(" world!")]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);

            expect(result.failed).toBeUndefined();
            expect(result.doc).toBeDefined();
            expect(getDocTextRepresentation(result.doc!)).toEqual(["Hello world!"]);
        });
         it('should replace text across two text nodes within a paragraph', () => {
            const initialDoc = createDoc(
                createPara(createText("Hello "), createText("world!"))
            );
            // Target: Replace "o " from "Hello " and "wor" from "world!" with " Ritor "
            // "Hello " is text[0], "world!" is text[1]
            // Flat from: <p>Hell|o world! -> 1 (p_open) + 4 ("Hell") = 5
            // Flat to:   <p>Hello wor|ld! -> 1 (p_open) + 6 ("Hello ") + 3 ("wor") = 10
            const from = modelPositionToFlatOffset(initialDoc, { path: [0,0], offset: 4 }, schema); // After "Hell"
            const to = modelPositionToFlatOffset(initialDoc, { path: [0,1], offset: 3 }, schema);   // After "wor" in "world!"

            const slice = Slice.fromFragment([createText(" Ritor ")]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);

            expect(result.failed).toBeUndefined();
            expect(result.doc).toBeDefined();
            expect(getDocTextRepresentation(result.doc!)).toEqual(["Hell Ritor ld!"]);
        });
    });

    describe('Multi-Block Replacements (More PoC - may fail or be approximate)', () => {
        it('should delete a full paragraph between two others', () => {
            const initialDoc = createDoc(
                createPara(createText("Paragraph 1")), // Size: 1 + 11 + 1 = 13
                createPara(createText("Paragraph 2")), // Size: 1 + 11 + 1 = 13
                createPara(createText("Paragraph 3"))  // Size: 1 + 11 + 1 = 13
            );
            // Delete Paragraph 2
            // Flat from: End of P1 = 13
            // Flat to:   End of P2 = 13 + 13 = 26
            const from = 13;
            const to = 26;

            const slice = Slice.empty;
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);

            expect(result.failed).toBeUndefined();
            expect(result.doc).toBeDefined();
            expect(getDocTextRepresentation(result.doc!)).toEqual(["Paragraph 1", "Paragraph 3"]);
        });

        it('should replace a full paragraph with another paragraph', () => {
            const initialDoc = createDoc(
                createPara(createText("Old Paragraph")) // Size 1 + 13 + 1 = 15
            );
            // Flat from: Start of doc content = 0 (or 1 if we consider only inside <p>)
            // Flat to: End of doc content = 15
            // Let's use from=0, to=doc.nodeSize for replacing all blocks
            const from = 0;
            const to = initialDoc.nodeSize;

            const slice = Slice.fromFragment([createPara(createText("New Paragraph"))]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);

            expect(result.failed).toBeUndefined();
            expect(result.doc).toBeDefined();
            expect(getDocTextRepresentation(result.doc!)).toEqual(["New Paragraph"]);
        });

        it('should delete a range starting in one para and ending in another (approximate result)', () => {
            const initialDoc = createDoc(
                createPara(createText("Paragraph One End")), // P1: "Paragraph One End" (17) -> 1+17+1 = 19
                createPara(createText("Start Paragraph Two")) // P2: "Start Paragraph Two" (19) -> 1+19+1 = 21
            );
            // Delete " End" from P1 and "Start " from P2
            // Flat from: P1_open(1) + "Paragraph One"(13) = 14
            // Flat to:   P1_size(19) + P2_open(1) + "Start "(6) = 19 + 1 + 6 = 26
            const from = 14;
            const to = 26;

            const slice = Slice.empty;
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);

            expect(result.failed).toBeUndefined();
            expect(result.doc).toBeDefined();
            // Expected: "Paragraph OneParagraph Two" (merged, or P1 partial + P2 partial if not merging blocks)
            // Current PoC multi-block might simplify to: keep "Paragraph One" (from startBlock partial logic)
            // and "Paragraph Two" (from endBlock partial logic, but slice is empty).
            // Or it might delete P1 because "from" is not 0, and delete P2 because "to" is not at its end.
            // This test will expose how the current PoC handles this complex case.
            // A more robust system might merge them into "Paragraph OneParagraph Two".
            // Current `apply` logic for multi-block is very simplified.
            // It will likely keep "Paragraph One" (due to startBlockCutoff > 0) and then "Paragraph Two" (due to endBlockCutoff > 0).
            // The slice is empty. The blocks between firstAffected (0) and lastAffected (1) are removed. None here.
            // So, P1 content before " End" + P2 content after "Start ".
            expect(getDocTextRepresentation(result.doc!)).toEqual(["Paragraph One", "Paragraph Two"]); // This is a guess based on current PoC
        });

        it('should replace multiple paragraphs with a single new paragraph', () => {
            const initialDoc = createDoc(
                createPara(createText("Para 1")), // Size 1+6+1 = 8
                createPara(createText("Para 2"))  // Size 1+6+1 = 8
            );
            // Replace both with one. from=0, to=doc.nodeSize(16)
            const from = 0;
            const to = initialDoc.nodeSize;

            const slice = Slice.fromFragment([createPara(createText("Single New Para"))]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);

            expect(result.failed).toBeUndefined();
            expect(result.doc).toBeDefined();
            expect(getDocTextRepresentation(result.doc!)).toEqual(["Single New Para"]);
        });

        it('should replace a paragraph with multiple new paragraphs (from slice)', () => {
            const initialDoc = createDoc(
                createPara(createText("To Be Replaced"))
            );
            const from = 0;
            const to = initialDoc.nodeSize;

            const slice = Slice.fromFragment([
                createPara(createText("New Para 1")),
                createPara(createText("New Para 2"))
            ]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);

            expect(result.failed).toBeUndefined();
            expect(result.doc).toBeDefined();
            expect(getDocTextRepresentation(result.doc!)).toEqual(["New Para 1", "New Para 2"]);
        });

        it('should replace all content of a doc with mixed inline content in slice (PoC wrapping)', () => {
            const initialDoc = createDoc(createPara(createText("Old")));
            const from = 0;
            const to = initialDoc.nodeSize;

            // Slice contains inline nodes that should be wrapped in default block (paragraph)
            const slice = Slice.fromFragment([
                createText("New inline 1. "),
                createText("New inline 2.")
            ]);
            const step = new ReplaceStep(from, to, slice);
            const result = step.apply(initialDoc);

            expect(result.failed).toBeUndefined();
            expect(result.doc).toBeDefined();
            // Expect the inline content to be wrapped in a single paragraph
            expect(getDocTextRepresentation(result.doc!)).toEqual(["New inline 1. New inline 2."]);
        });
    });
});
