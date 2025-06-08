// test/selection.test.ts

// Initialize JSDOM for DOM APIs
import jsdomGlobal from 'jsdom-global';
const cleanupJSDOM = jsdomGlobal(); // Call to initialize, store cleanup function

import { RitorVDOM } from '../src/RitorVDOM';
import { DocNode, TextNode, BaseNode } from '../src/documentModel'; // Added BaseNode
import { Schema } from '../src/schema';
import { basicNodeSpecs, basicMarkSpecs } from '../src/basicSchema';
import { ModelPosition } from '../src/selection';

// Basic assertion helper for model positions
function assertModelPositionEqual(actual: ModelPosition | null, expected: ModelPosition | null, message: string) {
    const actualStr = actual ? JSON.stringify(actual) : "null";
    const expectedStr = expected ? JSON.stringify(expected) : "null";
    if (actualStr !== expectedStr) {
        console.error(`Assertion Failed: ${message}. Expected: ${expectedStr}, Actual: ${actualStr}`);
    } else {
        console.log(`Assertion Passed: ${message}`);
    }
}

// Basic assertion helper for DOM positions
function assertDomPositionEqual(actual: {node: Node, offset: number} | null, expectedNodeName: string | null, expectedOffset: number | null, message: string) {
    if (!actual && (expectedNodeName !== null || expectedOffset !== null)) {
        console.error(`Assertion Failed: ${message}. Actual is null, but expected a value.`);
        return;
    }
    if (actual && (expectedNodeName === null || expectedOffset === null)) {
        console.error(`Assertion Failed: ${message}. Actual is not null, but expected null. Actual: ${actual.node.nodeName.toLowerCase()} @ ${actual.offset}`);
        return;
    }
    if (!actual && expectedNodeName === null && expectedOffset === null) {
         console.log(`Assertion Passed: ${message} (both actual and expected are null)`);
         return;
    }
    // Ensure actual and expectedNodeName/expectedOffset are not null before accessing properties
    if (actual && expectedNodeName !== null && expectedOffset !== null) {
        if (actual.node.nodeName.toLowerCase() !== expectedNodeName.toLowerCase() || actual.offset !== expectedOffset) {
             console.error(`Assertion Failed: ${message}. Expected: ${expectedNodeName} @ ${expectedOffset}, Actual: ${actual.node.nodeName.toLowerCase()} @ ${actual.offset} (Content: '${actual.node.textContent}')`);
        } else {
            console.log(`Assertion Passed: ${message}`);
        }
    } else { // This case should ideally be caught by earlier checks but good for safety
        console.error(`Assertion Failed: ${message}. Mismatch in nullity of actual/expected.`);
    }
}

console.log("Running Selection Mapping Tests...");

// Setup function
function setupEditor(initialContent?: DocNode): { editor: RitorVDOM, targetElement: HTMLElement, schema: Schema } {
    const targetElement = document.createElement('div');
    // Important: Append to body so selection APIs work as expected.
    // Check if document.body exists (it might not in some pure Node test environments without JSDOM setup)
    if (typeof document !== 'undefined' && document.body) {
        document.body.appendChild(targetElement);
    } else {
        // This path should ideally not be taken if jsdomGlobal() worked.
        console.warn("document.body not available. JSDOM setup might have issues.");
    }
    const schema = new Schema({ nodes: basicNodeSpecs, marks: basicMarkSpecs });
    const editorInstance = new RitorVDOM(targetElement, initialContent, schema);
    return { editor: editorInstance, targetElement, schema };
}

// Teardown function
function teardownEditor(targetElement: HTMLElement) {
    if (targetElement.parentNode) {
        targetElement.parentNode.removeChild(targetElement);
    }
}

// --- domToModelPosition Tests ---
(function testDomToModelSimpleText() {
    // Define content using the schema from setupEditor
    const setupResult = setupEditor(); // Setup first to get a schema instance
    const { editor, targetElement, schema } = setupResult;
    editor.currentViewDoc = schema.node(schema.nodes.doc, {}, [
        schema.node(schema.nodes.paragraph, {}, [schema.text('Hello')])
    ]) as DocNode;
    editor.domPatcher.patch(editor.currentViewDoc); // Patch the new content

    const p = targetElement.firstChild as HTMLElement;
    if (!p || !p.firstChild || p.firstChild.nodeType !== Node.TEXT_NODE) {
        console.error("Setup failed for testDomToModelSimpleText: Paragraph or text node not found correctly.");
        teardownEditor(targetElement);
        return;
    }
    const textNode = p.firstChild as Text;

    const modelPos = editor.domToModelPosition(textNode, 2);
    assertModelPositionEqual(modelPos, { path: [0, 0], offset: 2 }, 'domToModel: Simple text node middle');

    const modelPosStart = editor.domToModelPosition(textNode, 0);
    assertModelPositionEqual(modelPosStart, { path: [0, 0], offset: 0 }, 'domToModel: Simple text node start');

    const modelPosEnd = editor.domToModelPosition(textNode, 5);
    assertModelPositionEqual(modelPosEnd, { path: [0, 0], offset: 5 }, 'domToModel: Simple text node end');

    teardownEditor(targetElement);
})();

(function testDomToModelEmptyParagraph() {
    const setupResult = setupEditor();
    const { editor, targetElement, schema } = setupResult;
    editor.currentViewDoc = schema.node(schema.nodes.doc, {}, [
        schema.node(schema.nodes.paragraph, {}, [schema.text('')])
    ]) as DocNode;
    editor.domPatcher.patch(editor.currentViewDoc);

    const p = targetElement.firstChild as HTMLElement;
    if (!p) {
        console.error("Setup failed for testDomToModelEmptyParagraph: Paragraph not found.");
        teardownEditor(targetElement);
        return;
    }
    // Ritor's schema/VDOM might ensure an empty text node exists, or a <br> might be rendered.
    // The domToModelPosition should be robust to this.
    // If selection is on the paragraph itself (offset 0):
    let modelPos = editor.domToModelPosition(p, 0);

    // If the paragraph has a text node child (even if empty), and selection is on it:
    if (p.firstChild && p.firstChild.nodeType === Node.TEXT_NODE) {
        const emptyTextNode = p.firstChild as Text;
        modelPos = editor.domToModelPosition(emptyTextNode, 0);
    }
    // Expected model: path to the empty text node [0,0], offset 0
    assertModelPositionEqual(modelPos, { path: [0, 0], offset: 0 }, 'domToModel: Empty paragraph');

    teardownEditor(targetElement);
})();


// --- modelToDomPosition Tests ---
(function testModelToDomSimpleText() {
    const setupResult = setupEditor();
    const { editor, targetElement, schema } = setupResult;
    editor.currentViewDoc = schema.node(schema.nodes.doc, {}, [
        schema.node(schema.nodes.paragraph, {}, [schema.text('Hello')])
    ]) as DocNode;
    editor.domPatcher.patch(editor.currentViewDoc);

    const domPos = editor.modelToDomPosition({ path: [0, 0], offset: 3 });
    assertDomPositionEqual(domPos, '#text', 3, 'modelToDom: Simple text node middle');

    const domPosStart = editor.modelToDomPosition({ path: [0, 0], offset: 0 });
    assertDomPositionEqual(domPosStart, '#text', 0, 'modelToDom: Simple text node start');

    const domPosEnd = editor.modelToDomPosition({ path: [0, 0], offset: 5 });
    assertDomPositionEqual(domPosEnd, '#text', 5, 'modelToDom: Simple text node end');

    teardownEditor(targetElement);
})();

(function testModelToDomEmptyParagraph() {
    const setupResult = setupEditor();
    const { editor, targetElement, schema } = setupResult;
    editor.currentViewDoc = schema.node(schema.nodes.doc, {}, [
        schema.node(schema.nodes.paragraph, {}, [schema.text('')])
    ]) as DocNode;
    editor.domPatcher.patch(editor.currentViewDoc);

    const domPos = editor.modelToDomPosition({ path: [0, 0], offset: 0 });
    assertDomPositionEqual(domPos, '#text', 0, 'modelToDom: Empty paragraph');

    teardownEditor(targetElement);
})();

console.log("Finished Selection Mapping Tests.");

// Trigger execution if in a simple script environment (like subtask runner)
// This is conceptual; the subtask runner might have its own way of executing.
if (typeof process !== 'undefined' && process.env.RUN_TESTS_IN_SUBTASK) {
    // This block will likely not be executed directly by the subtask runner's `run_in_bash_session`
    // unless `RUN_TESTS_IN_SUBTASK` is set and node is called on this file.
    // The presence of `console.log` statements should be enough for output.
}

// Clean up JSDOM at the very end if you want to be tidy, though for a single test script run it might not be strictly necessary.
// cleanupJSDOM(); // Call the cleanup function
// For subtask environment, autorunner might kill process anyway.
// If tests were in a suite, cleanup would be per-suite or per-file.
