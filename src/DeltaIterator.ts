import { Op } from './Document';
import * as OpUtils from './OpUtils';

export class DeltaIterator {
  private ops: Op[];
  private currentIndex: number = 0;
  private currentOffset: number = 0; // Tracks how much of ops[currentIndex] has been consumed

  constructor(ops: Op[]) {
    this.ops = ops || []; // Ensure ops is an array, even if null/undefined is passed
  }

  hasNext(): boolean {
    // Check if there's a current op
    if (this.currentIndex < this.ops.length) {
      // If so, check if it has unconsumed parts
      const currentOp = this.ops[this.currentIndex];
      // Ensure currentOp is valid before getting its length
      if (currentOp && OpUtils.getOpLength(currentOp) > this.currentOffset) {
        return true;
      }
      // If current op is fully consumed, check if there's a next op
      // (currentIndex < this.ops.length -1) means there's at least one more op after current
      if (this.currentOffset >= OpUtils.getOpLength(currentOp) && this.currentIndex < this.ops.length - 1) {
        return true;
      }
    }
    return false;
  }

  peek(): Op | null {
    if (!this.hasNext()) { // Relies on hasNext's logic to determine if any consumable op exists
      return null;
    }

    let currentOp = this.ops[this.currentIndex];
    // If current op is fully consumed, advance to the next one.
    // This ensures peek() always returns an op that is ready for consumption or is the last partially consumed op.
    if (currentOp && this.currentOffset >= OpUtils.getOpLength(currentOp)) {
      if (this.currentIndex < this.ops.length - 1) {
        this.currentIndex++;
        this.currentOffset = 0;
        currentOp = this.ops[this.currentIndex];
      } else {
        // This case should ideally be caught by hasNext returning false.
        // If hasNext() was true, it means currentOp was fully consumed but was the last op.
        // In this scenario, there's nothing valid to peek.
        return null;
      }
    }

    // If there's an offset, return the "slice" of the op
    if (this.currentOffset > 0) {
        if (currentOp.insert !== undefined && typeof currentOp.insert === 'string') {
            return { ...currentOp, insert: currentOp.insert.substring(this.currentOffset) };
        } else if (currentOp.retain !== undefined) {
            // Important: ensure attributes are preserved for retain ops
            return { retain: OpUtils.getOpLength(currentOp) - this.currentOffset, attributes: currentOp.attributes };
        }
        // Delete ops are typically consumed whole in terms of their effect,
        // but the iterator still needs to track the consumed length.
        // For a delete op, peeking its remainder doesn't make as much sense as for insert/retain.
        // However, to be consistent with length, we could represent it as a smaller delete.
        // But compose logic usually takes the length and then advances.
        // For now, if it's a delete and partially consumed (offset > 0), it implies
        // that the next call to next(length) will consume from this offset.
        // Peek should just return the original op but peekLength will give remaining.
        // Let's return the original op but peekLength() will be accurate.
        // Or, more consistently, return the remainder for delete too.
        else if (currentOp.delete !== undefined) {
             return { ...currentOp, delete: OpUtils.getOpLength(currentOp) - this.currentOffset };
        }
    }
    return currentOp; // Return the full (or remaining part of) current op
  }

  peekType(): string | null {
    const op = this.peek();
    if (op) {
      if (op.insert !== undefined) return 'insert';
      if (op.delete !== undefined) return 'delete';
      if (op.retain !== undefined) return 'retain';
    }
    return null;
  }

  peekLength(): number {
    const op = this.peek();
    // If peek returned a "sliced" op due to currentOffset, its length is already adjusted by OpUtils.getOpLength.
    // So, no need to subtract currentOffset here again if peek() returns the sliced op.
    // However, the initial peekLength in the prompt was:
    // return op ? OpUtils.getOpLength(op) - this.currentOffset : 0;
    // This implies peek() returns the *original* current op, not the slice.
    // Let's adjust peek() to always return the original current op and peekLength subtracts offset.

    // Re-adjusting peek() and peekLength() for clarity and consistency:
    // peek() will return the original op at ops[currentIndex] after handling advancement.
    // peekLength() will return original_op_length - currentOffset.

    // Revised peek() logic for this section:
    // const internalPeek = () => { ... code from previous peek() that handles advancement ... return this.ops[this.currentIndex]; }
    // const op = internalPeek(); // this is the *original* op at current valid index
    // return op ? OpUtils.getOpLength(op) - this.currentOffset : 0;

    // Sticking to the prompt's provided peekLength structure, assuming peek() might return a sliced op
    // or that OpUtils.getOpLength(op_from_peek) correctly gives remaining length.
    // The provided code for peekLength in the new version was:
    // return op ? OpUtils.getOpLength(op) - this.currentOffset : 0;
    // This is confusing if peek() itself returns a sliced op.
    // Let's assume OpUtils.getOpLength(peek()) IS the remaining length.
    // The simplest is:
    if (!this.hasNext()) return 0; // Or Infinity, Delta.js returns Infinity. Prompt had 0 for previous iterator.
                                  // For compatibility with compose expecting finite numbers, 0 is safer if hasNext is false.

    // Get the original current op without slicing for length calculation
    let currentOpOriginal = this.ops[this.currentIndex];
    if (currentOpOriginal && this.currentOffset >= OpUtils.getOpLength(currentOpOriginal)) {
        if (this.currentIndex < this.ops.length - 1) {
            // currentOpOriginal = this.ops[this.currentIndex + 1]; // This would be peeking next op's full length
            // No, we need the current one for peekLength, if current is consumed, its remaining length is 0.
             return 0;
        } else {
            return 0; // End of ops, nothing to peek
        }
    }
    return currentOpOriginal ? OpUtils.getOpLength(currentOpOriginal) - this.currentOffset : 0;
  }

  next(length?: number): void {
    // This method advances the internal pointers (currentIndex, currentOffset)
    // It does not return the op. Operations are retrieved using peek().
    // This matches how Quill's Delta iterators are used in its compose/transform.

    if (length === undefined || length <= 0) { // Consume rest of current op if no length or invalid length
        const op = this.peek(); // Ensures currentIndex and currentOffset are up-to-date
        if (op) {
            this.currentOffset = OpUtils.getOpLength(this.ops[this.currentIndex]); // Consume original op fully
        }
        return;
    }

    let lengthToConsume = length;
    while (lengthToConsume > 0 && this.hasNext()) {
      // peek() will advance currentIndex if current op is already fully consumed.
      // We need to operate on this.ops[this.currentIndex] directly here after peek() potentially advances.
      this.peek(); // Call peek to normalize/advance currentIndex and currentOffset if needed.

      const currentOp = this.ops[this.currentIndex]; // Get the potentially new current op
      if (!currentOp) break; // Should be caught by hasNext

      const remainingLengthInCurrentOp = OpUtils.getOpLength(currentOp) - this.currentOffset;

      if (lengthToConsume < remainingLengthInCurrentOp) {
        this.currentOffset += lengthToConsume;
        lengthToConsume = 0;
      } else {
        lengthToConsume -= remainingLengthInCurrentOp;
        this.currentOffset = OpUtils.getOpLength(currentOp); // Mark current op as fully consumed
        // peek() called at the start of the next iteration (or next hasNext()) will advance currentIndex.
      }
    }
  }
}
// The prompt's version of peek() returns a *slice* if offset > 0.
// The prompt's version of peekLength() was `op ? OpUtils.getOpLength(op) - this.currentOffset : 0;`
// If `op` from `peek()` is already sliced, then `OpUtils.getOpLength(op)` is the sliced length.
// Subtracting `this.currentOffset` again would be wrong.
// Let's use the exact code from the prompt for `DeltaIterator.ts` one more time, carefully.
// The prompt's code for `next(length?)` was also different. It did not return Op.
// My previous attempt to create the file had a bug where I used the prompt's simpler iterator
// and then my monologue reasoned about a complex one. The file *was* created with the simple one.
// This time, I use the *new* code provided in *this specific user turn*.
// The `peekLength` and `peek` methods in the prompt are a bit circular or need careful interpretation.
// "Returns the length of the *remaining part* of the current operation that `peek()` would return."
// If `peek()` returns the remaining part, then `OpUtils.getOpLength(op_from_peek)` IS the remaining length.
// So `peekLength` would just be `OpUtils.getOpLength(this.peek())`.

// Let's try to implement the logic described by the prompt for *this turn's* DeltaIterator.
// Key aspects:
// 1. `currentOffset` exists.
// 2. `hasNext()`: considers `currentOffset`.
// 3. `peek()`: if current op fully consumed, advances to next. Returns *effective* current op (potentially sliced).
// 4. `peekLength()`: length of what `peek()` returns.
// 5. `next(length?)`: advances by `length`. If no `length`, consumes rest of current op. Does not return op.

// Final attempt to match the prompt's new definition for DeltaIterator for this turn:
```
