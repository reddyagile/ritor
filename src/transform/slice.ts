import { BaseNode } from '../documentModel.js'; // Adjust path as needed

export class Slice {
    constructor(
        public readonly content: ReadonlyArray<BaseNode>,
        public readonly openStart: number, // Depth to which the start of the slice is open
        public readonly openEnd: number   // Depth to which the end of the slice is open
    ) {}

    get size(): number {
        // Naive size for now for ReplaceStep PoC (sum of nodeSize of top-level nodes in content)
        // A proper slice size might be more complex if it needs to account for open depths
        // and how much of the "flat" content it represents.
        let count = 0;
        for (const node of this.content) {
            count += node.nodeSize; // nodeSize is now expected to be on BaseNode
        }
        return count;
    }

    // Creates a slice that is not open at its ends.
    static fromFragment(fragment: ReadonlyArray<BaseNode>): Slice {
        return new Slice(fragment, 0, 0);
    }
    
    // Creates a slice from a single node.
    static fromNode(node: BaseNode): Slice {
        return new Slice([node], 0, 0);
    }

    static readonly empty = new Slice([], 0, 0);

    // Utility to add toJSON for easier debugging if needed
    toJSON(): object {
        return {
            content: this.content.map(node => (node.type as any).name + ( (node as any).text ? `(${(node as any).text})` : '') ), // Simplified representation
            openStart: this.openStart,
            openEnd: this.openEnd,
            size: this.size
        };
    }
}

console.log("transform/slice.ts defined: Slice class.");
