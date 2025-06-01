// test/modelUtils.test.ts

import { Schema } from '../src/schema.js';
import { basicNodeSpecs, basicMarkSpecs } from '../src/basicSchema.js';
import { DocNode, TextNode, BaseNode, Mark } from '../src/documentModel.js';
import { ModelPosition } from '../src/selection.js';
import { modelPositionToFlatOffset, flatOffsetToModelPosition } from '../src/modelUtils.js';

// Helper to create a schema instance for tests
const schema = new Schema({
  nodes: basicNodeSpecs,
  marks: basicMarkSpecs
});

// Helper functions to create nodes for tests using the schema
const doc = (...content: BaseNode[]): DocNode => schema.createDoc(content) as DocNode;
const p = (...content: (TextNode | BaseNode)[]): BaseNode => schema.node('paragraph', {}, content);
const ul = (...content: BaseNode[]): BaseNode => schema.node('bullet_list', {}, content);
const li = (...content: BaseNode[]): BaseNode => schema.node('list_item', {}, content);
const h1 = (...content: TextNode[]): BaseNode => schema.node('heading', { level: 1 }, content);
const blockquote = (...content: BaseNode[]): BaseNode => schema.node('blockquote', {}, content);

const text = (str: string, marks?: Mark[]): TextNode => schema.text(str, marks);
const br = (): BaseNode => schema.node('hard_break', {});

const createMark = (type: string, attrs?:any) : Mark => schema.marks[type].create(attrs);

const strong = (nodes: string | TextNode[]): TextNode[] => {
    const mark = createMark('bold');
    if (typeof nodes === 'string') return [text(nodes, [mark])];
    return nodes.map(n => text(n.text, [...(n.marks || []), mark]));
};

describe('Position Conversion Utilities', () => {
  // Structure: [description, docFactory, modelPosition, expectedFlatOffset]
  const testCases: Array<[string, () => DocNode, ModelPosition, number]> = [
    [
      "Empty document, start",
      () => doc(), // nodeSize 0
      { path: [], offset: 0 },
      0
    ],
    [
      "Simple paragraph: <p>abc</p>, at start of text",
      () => doc(p(text("abc"))), // p: 1(open) + 3(abc) + 1(close) = 5. doc: 5
      { path: [0, 0], offset: 0 }, // Path to <p>, then to text "abc", offset 0 within text
      1 // After <p> opening tag
    ],
    [
      "Simple paragraph: <p>abc</p>, mid text",
      () => doc(p(text("abc"))),
      { path: [0, 0], offset: 1 }, // Path to text "abc", offset 1 (after 'a')
      1 + 1 // After <p> (1), after 'a' (1)
    ],
    [
      "Simple paragraph: <p>abc</p>, end of text",
      () => doc(p(text("abc"))),
      { path: [0, 0], offset: 3 }, // Path to text "abc", offset 3 (after 'c')
      1 + 3 // After <p> (1), after 'abc' (3)
    ],
    [
      "Simple paragraph: <p>abc</p>, selecting after paragraph",
      // This means ModelPosition refers to the doc, with offset 1 (after the first child paragraph)
      () => doc(p(text("abc"))), // p size 5
      { path: [], offset: 1 },
      5
    ],
    [
      "Two paragraphs: <p>a</p><p>b</p>, start of first text",
      () => doc(p(text("a")), p(text("b"))), // p("a") size 1+1+1=3. p("b") size 1+1+1=3. Doc size 3+3=6.
      { path: [0, 0], offset: 0 }, // -> p[0] -> text("a"), offset 0
      1 // After first <p> opening tag
    ],
    [
      "Two paragraphs: <p>a</p><p>b</p>, end of first text",
      () => doc(p(text("a")), p(text("b"))),
      { path: [0, 0], offset: 1 }, // -> p[0] -> text("a"), offset 1
      1 + 1 // After first <p> (1), after 'a' (1)
    ],
    [
      "Two paragraphs: <p>a</p><p>b</p>, selecting second para (position at start of its content)",
      () => doc(p(text("a")), p(text("b"))),
      { path: [1], offset: 0 }, // Path to p[1], offset 0 (index into its content array, i.e. before text("b"))
      3 + 1 // After p("a") (size 3), after p[1]'s opening tag (1)
    ],
    [
      "Two paragraphs: <p>a</p><p>b</p>, start of second text",
      () => doc(p(text("a")), p(text("b"))),
      { path: [1, 0], offset: 0 }, // -> p[1] -> text("b"), offset 0
      3 + 1 // After p("a") (size 3), after p[1]'s opening tag (1)
    ],
    [
      "Paragraph with hard break: <p>a<br/>b</p>",
      // Content of p: text("a") (size 1), br (size 1), text("b") (size 1)
      // p nodeSize = 1(p_open) + 1(a) + 1(br) + 1(b) + 1(p_close) = 5
      () => doc(p(text("a"), br(), text("b"))),
      { path: [0, 1], offset: 0 }, // Path to p[0] -> br node (index 1 in content), offset 0 for leaf
      1 + 1 // After <p> (1), after text("a") (1)
    ],
    [
      "Paragraph with hard break: <p>a<br/>b</p>, after <br/> (start of text 'b')",
      () => doc(p(text("a"), br(), text("b"))),
      { path: [0, 2], offset: 0 }, // Path to p[0] -> text("b") (index 2), offset 0
      1 + 1 + 1 // After <p>(1), text("a")(1), br(1)
    ],
    [
      "Paragraph with strong text: <p><strong>abc</strong></p>",
      // text("abc") has marks, but its nodeSize is 3.
      // p( text("abc") ) -> nodeSize 1+3+1=5.
      () => doc(p(...strong("abc"))), // strong returns TextNode[]
      { path: [0,0], offset: 1 }, // path to p[0] -> text("abc"), offset 1
      1 + 1 // After <p> (1), after 'a' (1)
    ],
    [
      "Nested structure: <blockquote><p>text</p></blockquote>",
      // text("text") size 4.
      // p(text("text")) size 1+4+1=6.
      // blockquote(p(...)) size 1+6+1=8.
      () => doc(blockquote(p(text("text")))),
      { path: [0, 0, 0], offset: 2 }, // path to blockquote -> p -> text, offset 2 (in "text")
      1 + 1 + 2 // bq_open(1) + p_open(1) + "te"(2)
    ],
    [
      "Selecting an empty paragraph: <p></p>",
      // p(text("")): text("") has nodeSize 0. p nodeSize is 1+0+1=2.
      () => doc(p(text(""))),
      { path: [0,0], offset: 0 }, // path to p[0] -> text(""), offset 0
      1 // after <p> opening tag
    ],
    [
      "Selecting parent of empty paragraph (position at start of its content)",
      () => doc(p(text(""))), // p size is 2
      { path: [0], offset: 0 }, // Path to the paragraph itself, offset 0 (index in its content array)
      1 // after <p> opening tag
    ],
    [
        "Doc with H1 then P: doc( h1(text('Hi')), p(text('Ho')) )",
        // text("Hi") size 2. h1 node size 1+2+1=4
        // text("Ho") size 2. p node size 1+2+1=4
        // doc size 4+4=8
        () => doc(h1(text("Hi")), p(text("Ho"))),
        { path: [1,0], offset: 1 }, // Path to p[1] -> text("Ho"), offset 1 (after 'H')
        4 + 1 + 1 // after h1 (size 4), after <p> opening tag (1), after 'H'(1)
    ],
    [
      "List: <ul><li><p>item1</p></li></ul>",
      // text("item1") size 5
      // p(text("item1")) size 1+5+1 = 7
      // li(p(text("item1"))) size 1+7+1 = 9
      // ul(li(...)) size 1+9+1 = 11
      () => doc(ul(li(p(text("item1"))))),
      { path: [0,0,0,0], offset: 2 }, // ul -> li -> p -> text, offset 2 (in "item1")
      1+1+1+2 // after <ul>(1), <li>(1), <p>(1), "it"(2 from "item1")
    ],
     [
      "Offset at end of document (after last block)",
      () => doc(p(text("a")), p(text("b"))), // p("a") size 3, p("b") size 3. Total doc size 6.
      { path: [], offset: 2}, // Path to doc, offset 2 (after second child p)
      6
    ],
    [
      "Offset within a text node that is not the first child of its parent",
      // <p> <br/> "cd" </p> -> br is index 0, "cd" is index 1 in p's content
      // br size 1, "cd" size 2. p size 1 + 1 + 2 + 1 = 5
      () => doc(p(br(), text("cd"))),
      { path: [0, 1], offset: 1 }, // p[0] -> text("cd") -> offset 1 (after 'c')
      1 + 1 + 1 // p_open(1) + br(1) + 'c'(1)
    ],
  ];

  testCases.forEach(([description, docFactory, modelPos, expectedFlatOff]) => {
    describe(description, () => {
      let testDoc: DocNode;
      beforeAll(() => {
        testDoc = docFactory();
        // console.log(description, "DocSize:", testDoc.nodeSize, "ExpectedFlat:", expectedFlatOff);
        // console.log(JSON.stringify(testDoc, (key, value) => key === 'schema' || key === 'type' ? '...' : value, 2));
      });

      it(`modelPositionToFlatOffset should convert ${JSON.stringify(modelPos)} to ${expectedFlatOff}`, () => {
        const flatOffset = modelPositionToFlatOffset(testDoc, modelPos);
        expect(flatOffset).toBe(expectedFlatOff);
      });

      it(`flatOffsetToModelPosition should convert ${expectedFlatOff} back to ${JSON.stringify(modelPos)} (or equivalent)`, () => {
        const resolvedModelPos = flatOffsetToModelPosition(testDoc, expectedFlatOff);
        // Direct comparison can be tricky if multiple ModelPositions map to the same flat offset
        // (e.g., end of text node vs. start of next sibling if it's an element boundary).
        // A robust test is to see if the resolved ModelPosition converts back to the same flat offset.
        const reconvertedFlatOffset = modelPositionToFlatOffset(testDoc, resolvedModelPos);

        if (reconvertedFlatOffset !== expectedFlatOff) {
            // Log details if the reconversion fails, helps in debugging.
            console.warn(`Bidirectional test warning for: ${description}`);
            console.warn(`Original ModelPos: ${JSON.stringify(modelPos)}, Expected Flat: ${expectedFlatOff}`);
            console.warn(`Resolved ModelPos by flatOffsetToModelPosition: ${JSON.stringify(resolvedModelPos)}`);
            console.warn(`Reconverted Flat from Resolved ModelPos: ${reconvertedFlatOffset}`);
        }
        expect(reconvertedFlatOffset).toBe(expectedFlatOff);

        // For cases where we expect exact match, we can add:
        // if (some_condition_for_exact_match_expectation) {
        //   expect(resolvedModelPos).toEqual(modelPos);
        // }
      });
    });
  });

  // Additional specific tests for flatOffsetToModelPosition, especially boundaries
  describe("flatOffsetToModelPosition specific boundary cases", () => {
    it("should resolve flat offset 0 in an empty doc to {path: [], offset: 0}", () => {
        const emptyDocInstance = doc();
        expect(flatOffsetToModelPosition(emptyDocInstance, 0)).toEqual({ path: [], offset: 0 });
    });

    it("should resolve flat offset at the very end of a non-empty doc", () => {
        const testDocInstance = doc(p(text("a"))); // p("a") size 3. Doc size 3.
        // Flat offset 3 is after the entire content of p("a"), including its closing tag.
        // This should resolve to a position in the doc node, after its last child.
        expect(flatOffsetToModelPosition(testDocInstance, 3)).toEqual({ path: [], offset: 1 });
    });

    it("should resolve flat offset at start of first block content", () => {
        const testDocInstance = doc(p(text("a"))); // p("a") size 3
        // Flat offset 1 is just after <p> opening tag, before 'a'
        expect(flatOffsetToModelPosition(testDocInstance, 1)).toEqual({ path: [0,0], offset: 0 });
    });

    it("should resolve flat offset between two blocks", () => {
        const testDocInstance = doc(p(text("a")), p(text("b"))); // p("a") size 3, p("b") size 3
        // Flat offset 3 is after p("a") (including its closing tag), effectively before p("b")
        // This means path to doc, offset pointing to the second child (index 1)
        expect(flatOffsetToModelPosition(testDocInstance, 3)).toEqual({ path: [], offset: 1 });
    });

    it("should resolve flat offset at end of text in first of two blocks", () => {
        const testDocInstance = doc(p(text("a")), p(text("b"))); // p("a") size 3
        // Flat offset 1(p_open) + 1(a) = 2. This is end of text 'a'.
        expect(flatOffsetToModelPosition(testDocInstance, 2)).toEqual({ path: [0,0], offset: 1 });
    });

  });
});
