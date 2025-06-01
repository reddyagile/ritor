// src/transform/stepMap.ts

// A StepMap can be used to map positions in a document before a step to
// positions in the document after a step.
// This is a simplified version for the PoC. A full StepMap handles multiple ranges,
// deletions, insertions, and can map forwards and backwards with bias.
export class StepMap {
    // For this PoC, ranges will store:
    // [fromA, toA, fromB, toB] meaning range fromA-toA in old doc is replaced by fromB-toB in new doc.
    // For a simple ReplaceStep(from, to, slice):
    // ranges would be [from, to, from, from + slice.size]
    // fromA, toA: defines the deleted range in the original document.
    // fromB, toB: defines the range in the new document that corresponds to the inserted content.
    //             The length of this new range is (slice.size).
    constructor(private readonly ranges: ReadonlyArray<number> = []) {}

    /**
     * Maps a position through the changes described by this map.
     * @param pos The position to map.
     * @param bias A bias to apply when the position is at the edge of a change.
     *             -1 will map to the start of the new/changed range.
     *             1 will map to the end. Default is 1.
     */
    map(pos: number, bias: number = 1): number {
        let currentPos = pos;
        let offset = 0; // Total change in length due to replacements *before* the current mapping range

        // This loop iterates through each defined mapping range (a single replacement in our PoC ReplaceStep)
        for (let i = 0; i < this.ranges.length; i += 4) {
            const deletedRangeStart = this.ranges[i];         // fromA
            const deletedRangeEnd = this.ranges[i+1];           // toA
            const insertedRangeStart = this.ranges[i+2];       // fromB (same as fromA for simple replace)
            const insertedRangeEnd = this.ranges[i+3];         // fromB + slice.size

            if (currentPos <= deletedRangeStart) { // Position is before this deleted range
                return currentPos + offset; // Apply accumulated offset from previous ranges (if any)
            }

            // Position is within or after this deleted range
            if (currentPos <= deletedRangeEnd) { // Position is within the deleted range (or at its end)
                // Map to the corresponding position in the inserted range
                if (bias < 0) { // Bias towards the start of the inserted content
                    return insertedRangeStart + offset;
                } else { // Bias towards the end of the inserted content
                    return insertedRangeEnd + offset;
                }
            }

            // Position is after this deleted range, calculate the offset this change introduced
            const lengthChange = (insertedRangeEnd - insertedRangeStart) - (deletedRangeEnd - deletedRangeStart);
            offset += lengthChange;
        }

        // If pos is after all ranges, apply the total accumulated offset
        return currentPos + offset;
    }

    /**
     * Creates an identity StepMap that maps every position to itself.
     */
    static readonly identity = new StepMap();

    /**
     * Inverts the step map. If the map transforms positions from document A to document B,
     * the inverted map transforms positions from B to A.
     * Assumes ranges are [fromA, toA, fromB, toB].
     * Inverted will be [fromB, toB, fromA, toA].
     */
    invert(): StepMap {
        const invertedRanges: number[] = [];
        for (let i = 0; i < this.ranges.length; i += 4) {
            invertedRanges.push(this.ranges[i+2], this.ranges[i+3], this.ranges[i], this.ranges[i+1]);
        }
        return new StepMap(invertedRanges);
    }
}

console.log("transform/stepMap.ts updated with invert() method.");
