// test/replaceStep.test.ts

import { ReplaceStep } from '../src/transform/replaceStep'; // Removed .js extension
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
            const step: ReplaceStep = new ReplaceStep(from, to, slice); // Explicitly typed
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getStructure(result.doc!)).toEqual(getStructure(createDoc(createPara(createText("Hello Ritor!")))));
        });
        it('should replace text across two text nodes within a paragraph', () => {
            const initialDoc = createDoc(createPara(createText("Hello "), createText("world!")));
            const from = modelPositionToFlatOffset(initialDoc, { path: [0,0], offset: 4 }, schema); 
            const to = modelPositionToFlatOffset(initialDoc, { path: [0,1], offset: 3 }, schema);   
            const slice = Slice.fromFragment([createText(" Ritor ")]);
            const step: ReplaceStep = new ReplaceStep(from, to, slice); // Explicitly typed
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
            const step: ReplaceStep = new ReplaceStep(from, to, Slice.empty); // Explicitly typed
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getStructure(result.doc!)).toEqual(getStructure(createDoc(createPara(createText("P1")), createPara(createText("P3")))));
        });
        it('should replace all content of a doc with mixed inline content in slice (PoC wrapping)', () => {
            const initialDoc = createDoc(createPara(createText("Old")));
            const from = 0; const to = initialDoc.nodeSize;
            const slice = Slice.fromFragment([createText("New "), createText("inline.")]);
            const step: ReplaceStep = new ReplaceStep(from, to, slice); // Explicitly typed
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
            const step: ReplaceStep = new ReplaceStep(from, to, slice); // Explicitly typed
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getStructure(result.doc!)).toEqual(getStructure(createDoc(createPara(createText("AAABBBCCC")))));
        });

        it('Test 2: Inline merge at end (openEnd=1) in "AAACCC" with "BBB" -> "AAABBBCCC"', () => {
            const initialDoc = createDoc(createPara(createText("AAACCC")));
            const from = modelPositionToFlatOffset(initialDoc, { path: [0, 0], offset: 3 }, schema); // After "AAA"
            const to = from;
            const slice = new Slice([createText("BBB")], 0, 1); // openEnd=1
            const step: ReplaceStep = new ReplaceStep(from, to, slice); // Explicitly typed
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getStructure(result.doc!)).toEqual(getStructure(createDoc(createPara(createText("AAABBBCCC")))));
        });

        it('Test 3: Inline merge at both start and end (openStart=1, openEnd=1)', () => {
            const initialDoc = createDoc(createPara(createText("AAA CCC"))); // Note space
            const from = modelPositionToFlatOffset(initialDoc, { path: [0, 0], offset: 3 }, schema); // After "AAA"
            const to = modelPositionToFlatOffset(initialDoc, { path: [0, 0], offset: 4 }, schema); // Select space
            const slice = new Slice([createText("BBB")], 1, 1);
            const step: ReplaceStep = new ReplaceStep(from, to, slice); // Explicitly typed
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
            // Removed duplicate and erroneous step declaration from previous attempt
            const step: ReplaceStep = new ReplaceStep(from, to, slice);
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
            const step: ReplaceStep = new ReplaceStep(from, to, slice); // Explicitly typed
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getStructure(result.doc!)).toEqual(getStructure(createDoc(createPara(createText("Hello")))));
        });

        it('Insert with openEnd at end of paragraph', () => {
            const initialDoc = createDoc(createPara(createText("Hello")));
            const from = 1 + 5; const to = 1 + 5; 
            const slice = new Slice([createText(" World")], 0, 1); 
            const step: ReplaceStep = new ReplaceStep(from, to, slice); // Explicitly typed
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getStructure(result.doc!)).toEqual(getStructure(createDoc(createPara(createText("Hello World")))));
        });

        it('Replace content with an empty slice with openStart/openEnd > 0 should delete and merge if compatible', () => {
            const initialDoc = createDoc(createPara( createText("Start "), createText("Middle", [{type: 'bold'}]), createText(" End") ));
            const from = modelPositionToFlatOffset(initialDoc, {path: [0,1], offset: 0}, schema); 
            const to = modelPositionToFlatOffset(initialDoc, {path: [0,1], offset: 6}, schema);   
            const slice = new Slice([], 1, 1); 
            const step: ReplaceStep = new ReplaceStep(from, to, slice); // Explicitly typed
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getStructure(result.doc!)).toEqual(getStructure(createDoc(createPara( createText("Start  End") ))));
        });
    }); // Closes 'ReplaceStep.apply with Slice openStart/openEnd for Inline Merging'

    // --- New tests for Multi-Block Merging with Slice openStart/openEnd ---
    describe('ReplaceStep.apply Multi-Block Merging with Slice openStart/openEnd', () => {
        it('Test MB1: Merge paragraphs, slice openStart=1, openEnd=1', () => {
            // Doc: <p>abc</p><p>def</p><p>ghi</p>
            // Replace <p>def</p> (and boundaries) with <p>xyz</p><p>uvw</p> (open 1,1)
            // Expected: <p>abcxyz</p><p>uvwghi</p>
            const p_abc = createPara(createText("abc"));
            const p_def = createPara(createText("def")); // Node to be replaced
            const p_ghi = createPara(createText("ghi"));
            const initialDoc = createDoc(p_abc, p_def, p_ghi);

            const from = p_abc.nodeSize; // After </p> of abc
            const to = p_abc.nodeSize + p_def.nodeSize; // After </p> of def

            const slice = new Slice([createPara(createText("xyz")), createPara(createText("uvw"))], 1, 1);
            const step: ReplaceStep = new ReplaceStep(from, to, slice); // Explicitly typed
            const result = step.apply(initialDoc);

            expect(result.failed).toBeUndefined();
            const expectedDoc = createDoc(createPara(createText("abcxyz")), createPara(createText("uvwghi")));
            expect(docsAreEqual(result.doc!, expectedDoc)).toBe(true);
        });

        it('Test MB2: Merge paragraphs, slice openStart=1, openEnd=0', () => {
            const p_abc = createPara(createText("abc"));
            const p_def = createPara(createText("def"));
            const p_ghi = createPara(createText("ghi"));
            const initialDoc = createDoc(p_abc, p_def, p_ghi);
            const from = p_abc.nodeSize;
            const to = p_abc.nodeSize + p_def.nodeSize;
            const slice = new Slice([createPara(createText("xyz")), createPara(createText("uvw"))], 1, 0);
            const step: ReplaceStep = new ReplaceStep(from, to, slice); // Explicitly typed
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            // <p>abcxyz</p> <p>uvw</p> (new block) <p>ghi</p> (original, shifted)
            const expectedDoc = createDoc(createPara(createText("abcxyz")), createPara(createText("uvw")), p_ghi);
            expect(docsAreEqual(result.doc!, expectedDoc)).toBe(true);
        });

        it('Test MB3: Merge paragraphs, slice openStart=0, openEnd=1', () => {
            const p_abc = createPara(createText("abc"));
            const p_def = createPara(createText("def"));
            const p_ghi = createPara(createText("ghi"));
            const initialDoc = createDoc(p_abc, p_def, p_ghi);
            const from = p_abc.nodeSize;
            const to = p_abc.nodeSize + p_def.nodeSize;
            const slice = new Slice([createPara(createText("xyz")), createPara(createText("uvw"))], 0, 1);
            const step: ReplaceStep = new ReplaceStep(from, to, slice); // Explicitly typed
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            // <p>abc</p> (original, shifted) <p>xyz</p> (new block) <p>uvwghi</p>
            const expectedDoc = createDoc(p_abc, createPara(createText("xyz")), createPara(createText("uvwghi")));
            expect(docsAreEqual(result.doc!, expectedDoc)).toBe(true);
        });

        it('Test MB4: Merge paragraphs, slice openStart=0, openEnd=0 (no merge)', () => {
            const p_abc = createPara(createText("abc"));
            const p_def = createPara(createText("def"));
            const p_ghi = createPara(createText("ghi"));
            const initialDoc = createDoc(p_abc, p_def, p_ghi);
            const from = p_abc.nodeSize;
            const to = p_abc.nodeSize + p_def.nodeSize;
            const slice = new Slice([createPara(createText("xyz")), createPara(createText("uvw"))], 0, 0);
            const step: ReplaceStep = new ReplaceStep(from, to, slice); // Explicitly typed
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            const expectedDoc = createDoc(p_abc, createPara(createText("xyz")), createPara(createText("uvw")), p_ghi);
            expect(docsAreEqual(result.doc!, expectedDoc)).toBe(true);
        });

        it('Test MB5: Replace middle of a single paragraph with an open slice (should use single-block path)', () => {
            // Doc: <p>hello wonderful world</p>, Replace "wonderful"
            // Slice: text(" amazing ") openStart=1, openEnd=1
            const initialDoc = createDoc(createPara(createText("hello wonderful world")));
            const from = modelPositionToFlatOffset(initialDoc, {path: [0,0], offset: 6}, schema); // after "hello "
            const to = modelPositionToFlatOffset(initialDoc, {path: [0,0], offset: 17}, schema); // after "hello wonderful "

            const slice = new Slice([createText(" amazing ")], 1, 1);
            const step: ReplaceStep = new ReplaceStep(from, to, slice); // Explicitly typed
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            const expectedDoc = createDoc(createPara(createText("hello amazing world")));
            expect(docsAreEqual(result.doc!, expectedDoc)).toBe(true);
        });

        it('Test MB6: Replace a middle paragraph with a slice open at both ends (forces multi-block merge)', () => {
            const p_first = createPara(createText("first part"));
            const p_replace = createPara(createText("REPLACE ME"));
            const p_last = createPara(createText("last part"));
            const initialDoc = createDoc(p_first, p_replace, p_last);

            const from = p_first.nodeSize;
            const to = p_first.nodeSize + p_replace.nodeSize;

            // Slice is p("middle part"), but openStart=1, openEnd=1 means its content "middle part"
            // should merge with surrounding compatible blocks.
            const slice = new Slice([createPara(createText("middle part"))], 1, 1);
            const step: ReplaceStep = new ReplaceStep(from, to, slice); // Explicitly typed
            const result = step.apply(initialDoc);

            expect(result.failed).toBeUndefined();
            const expectedDoc = createDoc(createPara(createText("first partmiddle partlast part")));
            expect(docsAreEqual(result.doc!, expectedDoc)).toBe(true);
        });
    });

    describe('ReplaceStep.invert', () => {
        // ... (existing invert tests are kept) ...

        // Helper for invert tests
        const testInversion = (description: string, initialDoc: DocNode, step: ReplaceStep) => {
            it(description, () => {
                const result = step.apply(initialDoc);
                expect(result.failed).toBeUndefined();
                const modifiedDoc = result.doc!;

                const invertedStep = step.invert(initialDoc) as ReplaceStep | null; // Reverted to invert
                expect(invertedStep).not.toBeNull();

                // Key assertions for the inverted slice's openStart/openEnd
                expect(invertedStep!.slice.openStart).toBe(step.slice.openStart);
                expect(invertedStep!.slice.openEnd).toBe(step.slice.openEnd);

                const resultAfterInvert = invertedStep!.apply(modifiedDoc);
                expect(resultAfterInvert.failed).toBeUndefined();
                expect(docsAreEqual(resultAfterInvert.doc!, initialDoc)).toBe(true);
            });
        };

        // Invert tests for new multi-block scenarios
        describe('Inverting Multi-Block Merging Steps', () => {
            const p_abc = createPara(createText("abc"));
            const p_def = createPara(createText("def"));
            const p_ghi = createPara(createText("ghi"));
            const initialDocMB = createDoc(p_abc, p_def, p_ghi);
            const fromMB = p_abc.nodeSize;
            const toMB = fromMB + p_def.nodeSize;

            testInversion("Invert MB1 (open 1,1)", initialDocMB,
                new ReplaceStep(fromMB, toMB, new Slice([createPara(createText("xyz")), createPara(createText("uvw"))], 1, 1))
            );
            testInversion("Invert MB2 (open 1,0)", initialDocMB,
                new ReplaceStep(fromMB, toMB, new Slice([createPara(createText("xyz")), createPara(createText("uvw"))], 1, 0))
            );
            testInversion("Invert MB3 (open 0,1)", initialDocMB,
                new ReplaceStep(fromMB, toMB, new Slice([createPara(createText("xyz")), createPara(createText("uvw"))], 0, 1))
            );
            testInversion("Invert MB4 (open 0,0)", initialDocMB,
                new ReplaceStep(fromMB, toMB, new Slice([createPara(createText("xyz")), createPara(createText("uvw"))], 0, 0))
            );

            const p_first = createPara(createText("first part"));
            const p_replace = createPara(createText("REPLACE ME"));
            const p_last = createPara(createText("last part"));
            const initialDocMB6 = createDoc(p_first, p_replace, p_last);
            const fromMB6 = p_first.nodeSize;
            const toMB6 = fromMB6 + p_replace.nodeSize;
            testInversion("Invert MB6 (force multi-block merge)", initialDocMB6,
                new ReplaceStep(fromMB6, toMB6, new Slice([createPara(createText("middle part"))], 1, 1))
            );
        });

        describe('Inverting Insertions and Deletions with Openness', () => {
            const doc_ab = createDoc(createPara(createText("ab"))); // p("ab") -> 1(p)+2(ab)+1(p) = 4. After "a" = flat 2
            const insertPos = 1 + 1;

            testInversion("Invert pure insertion (slice open 1,1)", doc_ab,
                new ReplaceStep(insertPos, insertPos, new Slice([createText("XYZ")], 1, 1))
            );
             testInversion("Invert pure insertion (slice open 0,0)", doc_ab,
                new ReplaceStep(insertPos, insertPos, new Slice([createText("XYZ")], 0, 0)) // Will create <p>a</p><p>XYZ</p><p>b</p> if not merging.
            );


            const doc_aDELb = createDoc(createPara(createText("aDELb"))); // DEL is 3 chars. from=2, to=5
            const delFrom = 1 + 1;
            const delTo = delFrom + 3;
            testInversion("Invert pure deletion (Slice.empty, so open 0,0)", doc_aDELb,
                new ReplaceStep(delFrom, delTo, Slice.empty)
            );
        });
        // The following line was a diff marker, removing it. It should have been part of the original file content that followed.
        it('should invert a text replacement in the middle of a paragraph', () => {
            const initialDoc = createDoc(createPara(createText("Hello world!")));
            const from = 7; const to = 12; 
            const slice = Slice.fromFragment([createText("Ritor")]);
            const step: ReplaceStep = new ReplaceStep(from, to, slice); // Explicitly typed
            const result = step.apply(initialDoc);
            expect(result.doc).toBeDefined();
            const invertedStep = step.invert(initialDoc); // Reverted to invert
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
            const step: ReplaceStep = new ReplaceStep(from, to, Slice.empty);  // Explicitly typed
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            expect(getStructure(result.doc!)).toEqual(getStructure(createDoc(createPara(createText("P1")), createPara(createText("P3")))));
            const invertedStep = step.invert(initialDoc); // Reverted to invert
            expect(invertedStep).not.toBeNull();
            const resultAfterInvert = (invertedStep! as ReplaceStep).apply(result.doc!);
            expect(resultAfterInvert.failed).toBeUndefined();
            expect(docsAreEqual(resultAfterInvert.doc!, initialDoc)).toBe(true);
        });
    }); // Closes 'ReplaceStep.apply Multi-Block Merging with Slice openStart/openEnd'
}); // Closes 'ReplaceStep.apply'

describe('ReplaceStep.invert', () => {
    // ... (existing invert tests are kept) ...

    // Helper for invert tests
    const testInversion = (description: string, initialDoc: DocNode, step: ReplaceStep) => {
        it(description, () => {
            const result = step.apply(initialDoc);
            expect(result.failed).toBeUndefined();
            const modifiedDoc = result.doc!;

            const invertedStep = step.invert(initialDoc) as ReplaceStep | null;
            expect(invertedStep).not.toBeNull();

            // Key assertions for the inverted slice's openStart/openEnd
            expect(invertedStep!.slice.openStart).toBe(step.slice.openStart);
            expect(invertedStep!.slice.openEnd).toBe(step.slice.openEnd);

            const resultAfterInvert = invertedStep!.apply(modifiedDoc);
            expect(resultAfterInvert.failed).toBeUndefined();
            expect(docsAreEqual(resultAfterInvert.doc!, initialDoc)).toBe(true);
        });
    };

    // Invert tests for new multi-block scenarios
    describe('Inverting Multi-Block Merging Steps', () => {
        const p_abc = createPara(createText("abc"));
        const p_def = createPara(createText("def"));
        const p_ghi = createPara(createText("ghi"));
        const initialDocMB = createDoc(p_abc, p_def, p_ghi);
        const fromMB = p_abc.nodeSize;
        const toMB = fromMB + p_def.nodeSize;

        testInversion("Invert MB1 (open 1,1)", initialDocMB,
            new ReplaceStep(fromMB, toMB, new Slice([createPara(createText("xyz")), createPara(createText("uvw"))], 1, 1))
        );
        testInversion("Invert MB2 (open 1,0)", initialDocMB,
            new ReplaceStep(fromMB, toMB, new Slice([createPara(createText("xyz")), createPara(createText("uvw"))], 1, 0))
        );
        testInversion("Invert MB3 (open 0,1)", initialDocMB,
            new ReplaceStep(fromMB, toMB, new Slice([createPara(createText("xyz")), createPara(createText("uvw"))], 0, 1))
        );
        testInversion("Invert MB4 (open 0,0)", initialDocMB,
            new ReplaceStep(fromMB, toMB, new Slice([createPara(createText("xyz")), createPara(createText("uvw"))], 0, 0))
        );

        const p_first = createPara(createText("first part"));
        const p_replace = createPara(createText("REPLACE ME"));
        const p_last = createPara(createText("last part"));
        const initialDocMB6 = createDoc(p_first, p_replace, p_last);
        const fromMB6 = p_first.nodeSize;
        const toMB6 = fromMB6 + p_replace.nodeSize;
        testInversion("Invert MB6 (force multi-block merge)", initialDocMB6,
            new ReplaceStep(fromMB6, toMB6, new Slice([createPara(createText("middle part"))], 1, 1))
        );
    });

    describe('Inverting Insertions and Deletions with Openness', () => {
        const doc_ab = createDoc(createPara(createText("ab"))); // p("ab") -> 1(p)+2(ab)+1(p) = 4. After "a" = flat 2
        const insertPos = 1 + 1;

        testInversion("Invert pure insertion (slice open 1,1)", doc_ab,
            new ReplaceStep(insertPos, insertPos, new Slice([createText("XYZ")], 1, 1))
        );
         testInversion("Invert pure insertion (slice open 0,0)", doc_ab,
            new ReplaceStep(insertPos, insertPos, new Slice([createText("XYZ")], 0, 0)) // Will create <p>a</p><p>XYZ</p><p>b</p> if not merging.
        );


        const doc_aDELb = createDoc(createPara(createText("aDELb"))); // DEL is 3 chars. from=2, to=5
        const delFrom = 1 + 1;
        const delTo = delFrom + 3;
        testInversion("Invert pure deletion (Slice.empty, so open 0,0)", doc_aDELb,
            new ReplaceStep(delFrom, delTo, Slice.empty)
        );
    });
    // The following line was a diff marker, removing it. It should have been part of the original file content that followed.
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
}); // Closes 'ReplaceStep.invert'
// No extra }); here
