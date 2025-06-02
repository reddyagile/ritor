// test/diff.test.ts

import { Schema } from '../src/schema.js';
import { basicNodeSpecs, basicMarkSpecs } from '../src/basicSchema.js';
import { DocNode, TextNode, BaseNode } from '../src/documentModel.js';
import { diffFragment } from '../src/transform/diff.js';
import { ReplaceStep } from '../src/transform/replaceStep.js'; // Corrected import
import { Slice } from '../src/transform/slice.js';

const schema = new Schema({
    nodes: basicNodeSpecs,
    marks: basicMarkSpecs
});

const createText = (text: string): TextNode => schema.text(text) as TextNode;
const createPara = (...content: TextNode[]): BaseNode => schema.node(schema.nodes.paragraph, {}, content);

// Helper for comparing step structure (simplified)
const getStepStructure = (step: ReplaceStep) => {
    return {
        from: step.from,
        to: step.to,
        sliceContent: step.slice.content.map((n: BaseNode) => ({ type: n.type.name, text: (n as TextNode).text })) // Added BaseNode type for n
    };
};
const getNodesStructure = (nodes: ReadonlyArray<BaseNode>) => {
    return nodes.map(n => ({ type: n.type.name, text: (n as TextNode).text, nodeSize: n.nodeSize }));
}


describe('diffFragment', () => {
    const p1 = createPara(createText("Node1")); // nodeSize: 1(p) + 5(text) + 1(p) = 7. Text content size = 5
    const p2 = createPara(createText("Node2")); // nodeSize: 7. Text content size = 5
    const p3 = createPara(createText("Node3")); // nodeSize: 7. Text content size = 5
    const p4 = createPara(createText("Node4New")); // nodeSize: 1+8+1 = 10
    const p5 = createPara(createText("Node5")); // nodeSize: 7

    it('should return empty array for identical node arrays', () => {
        const oldNodes = [p1, p2];
        const newNodes = [p1, p2]; // Same content, effectively equal
        const steps = diffFragment(oldNodes, newNodes, 0);
        expect(steps.length).toBe(0);
    });
    
    it('should detect simple text change in one node', () => {
        const oldP1 = createPara(createText("OldText")); // size 1+7+1 = 9
        const newP1 = createPara(createText("NewText")); // size 1+7+1 = 9
        const oldNodes = [oldP1, p2];
        const newNodes = [newP1, p2];
        const steps = diffFragment(oldNodes, newNodes, 0);
        expect(steps.length).toBe(1);
        const step = steps[0] as ReplaceStep;
        expect(step.from).toBe(0); // Start of oldP1
        expect(step.to).toBe(9);   // End of oldP1
        expect(step.slice.content.length).toBe(1);
        expect((step.slice.content[0] as BaseNode).type.name).toBe("paragraph");
        expect(((step.slice.content[0] as BaseNode).content![0] as TextNode).text).toBe("NewText");
    });

    it('should detect node added at the end', () => {
        const oldNodes = [p1]; // size 7
        const newNodes = [p1, p2]; // size 7, 7
        const steps = diffFragment(oldNodes, newNodes, 10); // startOffset 10
        expect(steps.length).toBe(1);
        const step = steps[0] as ReplaceStep;
        expect(step.from).toBe(10 + 7); // After p1
        expect(step.to).toBe(10 + 7);   // Insertion point
        expect(step.slice.content.length).toBe(1);
        expect(((step.slice.content[0] as BaseNode).content![0] as TextNode).text).toBe("Node2");
    });

    it('should detect node inserted in the middle', () => {
        const oldNodes = [p1, p3]; // p1=7, p3=7
        const newNodes = [p1, p2, p3]; // p1=7, p2=7, p3=7
        const steps = diffFragment(oldNodes, newNodes, 0);
        expect(steps.length).toBe(1);
        const step = steps[0] as ReplaceStep;
        expect(step.from).toBe(7); // After p1
        expect(step.to).toBe(7);   // Insertion point (before original p3)
        expect(step.slice.content.length).toBe(1);
        expect(((step.slice.content[0] as BaseNode).content![0] as TextNode).text).toBe("Node2");
    });
    
    it('should detect node deleted from the end', () => {
        const oldNodes = [p1, p2];
        const newNodes = [p1];
        const steps = diffFragment(oldNodes, newNodes, 0);
        expect(steps.length).toBe(1);
        const step = steps[0] as ReplaceStep;
        expect(step.from).toBe(7); // Start of p2
        expect(step.to).toBe(7 + 7); // End of p2
        expect(step.slice.content.length).toBe(0);
    });

    it('should detect node deleted from the middle', () => {
        const oldNodes = [p1, p2, p3];
        const newNodes = [p1, p3];
        const steps = diffFragment(oldNodes, newNodes, 0);
        expect(steps.length).toBe(1);
        const step = steps[0] as ReplaceStep;
        expect(step.from).toBe(7);    // Start of p2
        expect(step.to).toBe(7 + 7);  // End of p2
        expect(step.slice.content.length).toBe(0);
    });
    
    it('should detect multiple nodes replaced by multiple other nodes', () => {
        const oldNodes = [p1, p2, p3]; // p1=7, p2=7, p3=7. Total effective content size for p2,p3 = 14
        const newNodes = [p1, p4, p5]; // p1=7, p4=10, p5=7
        const steps = diffFragment(oldNodes, newNodes, 0);
        expect(steps.length).toBe(1);
        const step = steps[0] as ReplaceStep;
        expect(step.from).toBe(7);          // Start of p2
        expect(step.to).toBe(7 + 7 + 7);    // End of p3
        expect(step.slice.content.length).toBe(2);
        expect(((step.slice.content[0] as BaseNode).content![0] as TextNode).text).toBe("Node4New");
        expect(((step.slice.content[1] as BaseNode).content![0] as TextNode).text).toBe("Node5");
    });

    it('should detect all nodes replaced', () => {
        const oldNodes = [p1, p2]; // p1=7, p2=7. Total 14
        const newNodes = [p4, p5]; // p4=10, p5=7
        const steps = diffFragment(oldNodes, newNodes, 0);
        expect(steps.length).toBe(1);
        const step = steps[0] as ReplaceStep;
        expect(step.from).toBe(0);
        expect(step.to).toBe(14);
        expect(step.slice.content.length).toBe(2);
        expect(((step.slice.content[0] as BaseNode).content![0] as TextNode).text).toBe("Node4New");
    });

    it('should detect emptying all nodes', () => {
        const oldNodes = [p1, p2];
        const newNodes: BaseNode[] = [];
        const steps = diffFragment(oldNodes, newNodes, 0);
        expect(steps.length).toBe(1);
        const step = steps[0] as ReplaceStep;
        expect(step.from).toBe(0);
        expect(step.to).toBe(14);
        expect(step.slice.content.length).toBe(0);
    });

    it('should detect replacing empty with nodes', () => {
        const oldNodes: BaseNode[] = [];
        const newNodes = [p1, p2];
        const steps = diffFragment(oldNodes, newNodes, 0);
        expect(steps.length).toBe(1);
        const step = steps[0] as ReplaceStep;
        expect(step.from).toBe(0);
        expect(step.to).toBe(0);
        expect(step.slice.content.length).toBe(2);
    });

    it('should handle nodes with different content but same type at ends', () => {
        const p1a = createPara(createText("Node1a")); // size 1+6+1 = 8
        const p1b = createPara(createText("Node1b")); // size 1+6+1 = 8
        const oldNodes = [p1a, p2, p3]; // 8, 7, 7
        const newNodes = [p1b, p2, p3]; // 8, 7, 7
        const steps = diffFragment(oldNodes, newNodes, 0);
        expect(steps.length).toBe(1);
        const step = steps[0] as ReplaceStep;
        expect(step.from).toBe(0);
        expect(step.to).toBe(8); // p1a
        expect(step.slice.content.length).toBe(1);
        expect(((step.slice.content[0] as BaseNode).content![0] as TextNode).text).toBe("Node1b");
    });

    it('should handle common prefix and suffix correctly', () => {
        const commonPrefix = createPara(createText("Prefix")); // size 1+6+1=8
        const commonSuffix = createPara(createText("Suffix")); // size 1+6+1=8
        const oldNodes = [commonPrefix, p1, p2, commonSuffix]; // 8, 7, 7, 8
        const newNodes = [commonPrefix, p3, p4, commonSuffix]; // 8, 7, 10, 8

        const steps = diffFragment(oldNodes, newNodes, 100); // startOffset 100
        expect(steps.length).toBe(1);
        const step = steps[0] as ReplaceStep;
        expect(step.from).toBe(100 + 8); // After prefix
        expect(step.to).toBe(100 + 8 + 7 + 7); // After p2 (end of old differing part)
        expect(step.slice.content.length).toBe(2);
        expect(((step.slice.content[0] as BaseNode).content![0] as TextNode).text).toBe("Node3");
        expect(((step.slice.content[1] as BaseNode).content![0] as TextNode).text).toBe("Node4New");
    });
     it('should correctly diff when old array is empty', () => {
        const oldNodes: BaseNode[] = [];
        const newNodes = [p1, p2];
        const steps = diffFragment(oldNodes, newNodes, 10);
        expect(steps.length).toBe(1);
        const step = steps[0] as ReplaceStep;
        expect(step.from).toBe(10);
        expect(step.to).toBe(10);
        expect(step.slice.content.length).toBe(2);
        expect(((step.slice.content[0] as BaseNode).content![0] as TextNode).text).toBe("Node1");
    });

    it('should correctly diff when new array is empty', () => {
        const oldNodes = [p1, p2]; // 7, 7. Total 14
        const newNodes: BaseNode[] = [];
        const steps = diffFragment(oldNodes, newNodes, 10);
        expect(steps.length).toBe(1);
        const step = steps[0] as ReplaceStep;
        expect(step.from).toBe(10);
        expect(step.to).toBe(10 + 14);
        expect(step.slice.content.length).toBe(0);
    });

     it('should handle one old node replaced by two new nodes', () => {
        const oldNodes = [p1]; // 7
        const newNodes = [p2, p3]; // 7, 7
        const steps = diffFragment(oldNodes, newNodes, 0);
        expect(steps.length).toBe(1);
        const step = steps[0] as ReplaceStep;
        expect(step.from).toBe(0);
        expect(step.to).toBe(7);
        expect(step.slice.content.length).toBe(2);
    });

    it('should handle two old nodes replaced by one new node', () => {
        const oldNodes = [p1, p2]; // 7, 7. Total 14.
        const newNodes = [p3]; // 7
        const steps = diffFragment(oldNodes, newNodes, 0);
        expect(steps.length).toBe(1);
        const step = steps[0] as ReplaceStep;
        expect(step.from).toBe(0);
        expect(step.to).toBe(14);
        expect(step.slice.content.length).toBe(1);
        expect(((step.slice.content[0] as BaseNode).content![0] as TextNode).text).toBe("Node3");
    });
});
