// test/markSteps.test.ts

import { Schema } from '../src/schema.js';
import { basicNodeSpecs, basicMarkSpecs } from '../src/basicSchema.js';
import { DocNode, TextNode, BaseNode, Mark } from '../src/documentModel.js';
import { AddMarkStep } from '../src/transform/addMarkStep.js';
import { RemoveMarkStep } from '../src/transform/removeMarkStep.js';
import { Transaction } from '../src/transform/transaction.js';
import { modelPositionToFlatOffset, flatOffsetToModelPosition, nodeAtPath } from '../src/modelUtils.js'; // Assuming RitorVDOM's modelUtils are suitable
import { ModelPosition, ModelSelection } from '../src/selection.js';

// Disable debug logging if any
(globalThis as any).DEBUG_REPLACESTEP = false;
(globalThis as any).DEBUG_MATCHES_RULE = false;
(globalThis as any).DEBUG_CHECK_CONTENT = false;

const schema = new Schema({
    nodes: basicNodeSpecs,
    marks: basicMarkSpecs
});

// Helper functions to create nodes and marks
const createMark = (type: string, attrs?: any): Mark => schema.marks[type]?.create(attrs) as Mark;

const createText = (text: string, marksArray?: {type: string, attrs?: any}[] | Mark[]): TextNode => {
    let marks: Mark[];
    if (marksArray && marksArray.length > 0 && (typeof (marksArray[0] as any).type === 'string' && typeof (marksArray[0] as any).eq !== 'function') ) { // Check if it's a plain object spec
        marks = (marksArray as {type: string, attrs?: any}[])
            .map(m => createMark(m.type, m.attrs))
            .filter(m => !!m);
    } else {
        marks = (marksArray as Mark[] || []);
    }
    return schema.text(text, marks) as TextNode;
};

const createPara = (...content: (TextNode | BaseNode)[]): BaseNode => schema.node(schema.nodes.paragraph, {}, content);
const createHeading = (level: number, ...content: (TextNode | BaseNode)[]): BaseNode => schema.node(schema.nodes.heading, { level }, content);
const createDoc = (...content: BaseNode[]): DocNode => schema.node(schema.nodes.doc, {}, content) as DocNode;

// Enhanced helper for structural comparison, ignoring IDs and empty attrs/content
const getStructure = (node: BaseNode | null): any => {
    if (!node) return null;
    if (node.isText && !node.isLeaf) {
        const textNode = node as TextNode;
        const marks = (textNode.marks || []).map(m => m.type.name + (m.attrs && Object.keys(m.attrs).length ? JSON.stringify(m.attrs) : "")).sort();
        return { type: 'text', text: textNode.text, ...(marks.length ? { marks } : {}) };
    }
    const content = node.content ? node.content.map(getStructure).filter(c => c !== null) : [];
    const attrsToCompare = { ...node.attrs };
    delete attrsToCompare.id;
    const hasAttrs = Object.keys(attrsToCompare).length > 0;
    const hasContent = content.length > 0;

    let structure: any = { type: node.type.name };
    if (hasAttrs) structure.attrs = attrsToCompare;
    if (hasContent) structure.content = content;
    
    return structure;
};


describe('Mark Application Across Multiple Blocks', () => {
    const boldMark = createMark('bold');

    it('should apply bold to selection spanning two paragraphs', () => {
        const initialDoc = createDoc(
            createPara(createText("Paragraph "), createText("one")),
            createPara(createText("Paragraph "), createText("two"))
        );
        // Selection: From "one" (P1) to "Paragraph " (P2)
        // P1: Paragraph one  (Para(0) -> text(1) "one") path: [0,1], offset:0
        // P2: Paragraph two  (Para(1) -> text(0) "Paragraph ") path: [1,0], offset: "Paragraph ".length
        
        // Flat offsets:
        // doc (
        //   p ( Paragraph(10) one(3) ) p ) (1 + 10 + 3 + 1 = 15)
        //   p ( Paragraph(10) two(3) ) p ) (1 + 10 + 3 + 1 = 15)
        // doc ( p text"Paragraph " text"one" /p p text"Paragraph " text"two" /p )
        // Path to "one": [0, 1] -> offset for "Paragraph " is 1(p) + 10 = 11. "one" starts at 11.
        // Path to "Paragraph " in P2: [1, 0] -> offset for P1 is 15. P2 starts at 15+1=16. "Paragraph " in P2 is at 16.
        // End of "Paragraph " in P2: 16 + 10 = 26.

        const selectionAnchor: ModelPosition = { path: [0, 1], offset: 0 }; // Start of "one"
        const selectionHead: ModelPosition = { path: [1, 0], offset: 10 }; // End of "Paragraph "
        
        const fromFlat = modelPositionToFlatOffset(initialDoc, selectionAnchor, schema); // Should be 1 (p) + 10 ("Paragraph ") = 11
        const toFlat = modelPositionToFlatOffset(initialDoc, selectionHead, schema);   // Should be 1(p) + 10+3+1(p1) + 1(p) + 10 = 26
        
        expect(fromFlat).toBe(11);
        expect(toFlat).toBe(26);

        const tr = new Transaction(initialDoc, { anchor: selectionAnchor, head: selectionHead });
        tr.addMark(fromFlat, toFlat, boldMark);
        const resultDoc = tr.doc;

        expect(getStructure(resultDoc)).toEqual(
            getStructure(createDoc(
                createPara(createText("Paragraph "), createText("one", [boldMark])),
                createPara(createText("Paragraph ", [boldMark]), createText("two"))
            ))
        );
    });

    it('should remove bold from selection spanning two paragraphs', () => {
        const initialDoc = createDoc(
            createPara(createText("Bold ", [boldMark]), createText("one", [boldMark])),
            createPara(createText("Bold ", [boldMark]), createText("two", [boldMark]))
        );
        // Selection: " one" (P1) to "Bold t" (P2)
        // P1: Bold(5) one(3) -> total 8. P open/close: 1+8+1=10
        // P2: Bold(5) two(3) -> total 8. P open/close: 1+8+1=10
        // "one" in P1: starts at 1(p) + 5 = 6. Ends at 6+3=9
        // "Bold " in P2: starts at 10 + 1(p) = 11. Ends at 11+5=16
        // "two" in P2: starts at 16. Ends at 16+3=19

        const selectionAnchor: ModelPosition = { path: [0, 1], offset: 0 }; // Start of "one"
        const selectionHead: ModelPosition = { path: [1, 0], offset: 5 };   // End of "Bold " in P2
        
        const fromFlat = modelPositionToFlatOffset(initialDoc, selectionAnchor, schema); // 6
        const toFlat = modelPositionToFlatOffset(initialDoc, selectionHead, schema);   // 16
        
        expect(fromFlat).toBe(6);
        expect(toFlat).toBe(16);

        const tr = new Transaction(initialDoc, { anchor: selectionAnchor, head: selectionHead });
        tr.removeMark(fromFlat, toFlat, boldMark);
        const resultDoc = tr.doc;
        
        expect(getStructure(resultDoc)).toEqual(
            getStructure(createDoc(
                createPara(createText("Bold ", [boldMark]), createText("one")),
                createPara(createText("Bold "), createText("two", [boldMark]))
            ))
        );
    });

    it('should apply bold to selection including a heading and a paragraph', () => {
        const initialDoc = createDoc(
            createHeading(1, createText("Head "), createText("one")),
            createPara(createText("Para "), createText("two"))
        );
        // H1: Head (5) one (3) -> total 8. H1 open/close: 1+8+1=10
        // P1: Para (5) two (3) -> total 8. P open/close: 1+8+1=10
        // "one" in H1: starts at 1(h1) + 5 = 6
        // "Para " in P1: starts at 10 + 1(p) = 11

        const selectionAnchor: ModelPosition = { path: [0, 1], offset: 0 }; // Start of "one"
        const selectionHead: ModelPosition = { path: [1, 0], offset: 5 };   // End of "Para "
        
        const fromFlat = modelPositionToFlatOffset(initialDoc, selectionAnchor, schema); // 6
        const toFlat = modelPositionToFlatOffset(initialDoc, selectionHead, schema);   // 11 + 5 = 16
        
        expect(fromFlat).toBe(6);
        expect(toFlat).toBe(16);

        const tr = new Transaction(initialDoc, { anchor: selectionAnchor, head: selectionHead });
        tr.addMark(fromFlat, toFlat, boldMark);
        const resultDoc = tr.doc;

        expect(getStructure(resultDoc)).toEqual(
            getStructure(createDoc(
                createHeading(1, createText("Head "), createText("one", [boldMark])),
                createPara(createText("Para ", [boldMark]), createText("two"))
            ))
        );
    });
    
    it('should toggle (add) mark when selection spans blocks with mixed marked/unmarked content', () => {
        const initialDoc = createDoc(
            createPara(createText("Normal"), createText("Bold", [boldMark])),
            createPara(createText("More Normal"))
        );
        // P1: Normal(6)Bold(4) -> total 10. P open/close: 1+10+1=12
        // P2: More Normal(11) -> total 11. P open/close: 1+11+1=13
        // "Normal" in P1: starts at 1(p). Ends at 1+6=7
        // "More Normal" in P2: starts at 12+1(p)=13. Ends at 13+11=24

        const selectionAnchor: ModelPosition = { path: [0, 0], offset: 0 }; // Start of "Normal"
        const selectionHead: ModelPosition = { path: [1, 0], offset: 11 };  // End of "More Normal"

        const fromFlat = modelPositionToFlatOffset(initialDoc, selectionAnchor, schema); // 1
        const toFlat = modelPositionToFlatOffset(initialDoc, selectionHead, schema);   // 24
        
        expect(fromFlat).toBe(1);
        expect(toFlat).toBe(24);

        const tr = new Transaction(initialDoc, { anchor: selectionAnchor, head: selectionHead });
        // Since not all content in range is bold, addMark should make it all bold.
        tr.addMark(fromFlat, toFlat, boldMark); 
        const resultDoc = tr.doc;

        expect(getStructure(resultDoc)).toEqual(
            getStructure(createDoc(
                createPara(createText("Normal", [boldMark]), createText("Bold", [boldMark])),
                createPara(createText("More Normal", [boldMark]))
            ))
        );
    });
});
