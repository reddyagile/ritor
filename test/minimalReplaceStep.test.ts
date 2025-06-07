import * as StepTypes from '../src/transform/replaceStep'; // Changed import
import { Slice } from '../src/transform/slice';
import { Schema } from '../src/schema';
import { basicNodeSpecs, basicMarkSpecs } from '../src/basicSchema';
import { DocNode } from '../src/documentModel';

const schema = new Schema({
    nodes: basicNodeSpecs,
    marks: basicMarkSpecs
});

const createDoc = (...content: any[]): DocNode => schema.node(schema.nodes.doc, {}, content) as DocNode;
const createPara = (...content: any[]): any => schema.node(schema.nodes.paragraph, {}, content);
const createText = (text: string): any => schema.text(text, []);

describe('Minimal ReplaceStep Invert Test', () => {
    it('should recognize the invert method', () => {
        const initialDoc = createDoc(createPara(createText("test")));
        const step: StepTypes.ReplaceStep = new StepTypes.ReplaceStep(0, 0, Slice.empty); // Use namespaced type

        let invertedStep = null;
        let errorOccurred = false;
        try {
            invertedStep = step.invert(initialDoc); // Call method
        } catch (e) {
            console.error("Error calling invert:", e);
            errorOccurred = true;
        }

        expect(errorOccurred).toBe(false);
        // We don't care about the result of invert for this test,
        // only that it could be called without a type error.
        // If it compiled and ran to this point, the method exists from TS perspective.
        expect(true).toBe(true);
    });
});
