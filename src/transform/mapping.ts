// src/transform/mapping.ts

import { StepMap } from './stepMap.js';

/**
 * A mapping represents a series of steps that have been applied to a document.
 * It can map positions in the original document to the final document, and vice-versa.
 * This is a simplified version for the PoC, primarily handling forward mapping
 * through a sequence of StepMaps. A full implementation would also handle inverting
 * maps and composing them more robustly.
 */
export class Mapping {
    /**
     * Creates a new mapping.
     * @param maps An array of StepMaps, representing the sequence of changes.
     *             Defaults to an empty array for an identity mapping.
     */
    constructor(public readonly maps: ReadonlyArray<StepMap> = []) {}

    /**
     * Maps a position through the sequence of StepMaps.
     * @param pos The position to map.
     * @param bias Bias for mapping (default is 1, typically towards the end of changes).
     */
    map(pos: number, bias: number = 1): number {
        let mappedPos = pos;
        for (const stepMap of this.maps) {
            mappedPos = stepMap.map(mappedPos, bias);
        }
        return mappedPos;
    }

    /**
     * Appends a StepMap to this mapping, returning a new Mapping.
     * @param map The StepMap to append.
     */
    appendMap(map: StepMap): Mapping {
        // Create a new array with all existing maps plus the new one
        return new Mapping([...this.maps, map]);
    }

    /**
     * An identity mapping that maps all positions to themselves.
     */
    static readonly identity = new Mapping();
}

console.log("transform/mapping.ts defined: Mapping class.");
