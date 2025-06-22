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
        currentOp = this.ops[this.currentIndex]; // update currentOp to the new one
      } else {
        // This case means currentOp was fully consumed and it was the last op.
        return null;
      }
    }

    // If there's an offset, return the "slice" of the op
    // This "slicing" logic for peek was part of an intermediate version in the previous turn's thought process
    // but the final version of the prompt for *this* turn provides a simplified peek.
    // The version in *this* turn's prompt description for peek() is:
    // peek(): Op | null {
    //   if (!this.hasNext()) { return null; }
    //   const currentOp = this.ops[this.currentIndex];
    //   if (currentOp && this.currentOffset >= OpUtils.getOpLength(currentOp)) {
    //     if (this.currentIndex < this.ops.length - 1) {
    //       this.currentIndex++; this.currentOffset = 0;
    //     } else { return null; }
    //   }
    //   return this.ops[this.currentIndex]; // Returns the *original* op at currentIndex
    // }
    // I will use the version from THIS turn's prompt.
    // The code block above in my current response is from the *previous* turn's overwrite.
    // I must use the one from THIS turn's prompt.

    // Corrected peek() based on THIS turn's prompt:
    // (Re-checking the prompt for this turn...)
    // The prompt for THIS turn (subtask 10) gives the full expected class content.
    // The peek method in that content is:
    // peek(): Op | null {
    //   if (!this.hasNext()) { return null; }
    //   const currentOp = this.ops[this.currentIndex];
    //   if (currentOp && this.currentOffset >= OpUtils.getOpLength(currentOp)) {
    //     if (this.currentIndex < this.ops.length - 1) {
    //       this.currentIndex++; this.currentOffset = 0;
    //     } else { return null; }
    //   }
    //   return this.ops[this.currentIndex]; // This is the one to use.
    // }
    // This is what I will ensure is in the final file.
    // The `currentOp` variable used for the check `this.currentOffset >= OpUtils.getOpLength(currentOp)`
    // must be taken before potentially advancing `this.currentIndex`.

    // Let's re-verify the peek() logic against the prompt's exact specification for this turn:
    // The prompt's version:
    // peek(): Op | null {
    //   if (!this.hasNext()) { return null; }
    //   const currentOp = this.ops[this.currentIndex]; // A
    //   if (currentOp && this.currentOffset >= OpUtils.getOpLength(currentOp)) { // B
    //     if (this.currentIndex < this.ops.length - 1) { // C
    //       this.currentIndex++; this.currentOffset = 0; // D
    //     } else { return null; } // E
    //   }
    //   return this.ops[this.currentIndex]; // F
    // }
    // If current op (A) is consumed (B), and there's a next op (C), advance (D).
    // Then F returns the *new* current op. This is correct.
    // If current op (A) is consumed (B), and no next op (E), return null. This is correct.
    // If current op (A) is NOT consumed, F returns it. This is correct.
    // So, the logic for peek() in the prompt is sound.

    // The code I'm about to write with `overwrite_file_with_block` will use the exact class definition
    // from the current subtask prompt.

    // The following is the *actual* code from the prompt for peek()
    // const currentOp = this.ops[this.currentIndex]; // This line is inside peek()
    // if (currentOp && this.currentOffset >= OpUtils.getOpLength(currentOp)) {
    //   if (this.currentIndex < this.ops.length - 1) {
    //     this.currentIndex++;
    //     this.currentOffset = 0;
    //     // currentOp = this.ops[this.currentIndex]; // No, this was my addition, not in prompt
    //   } else {
    //     return null;
    //   }
    // }
    // return this.ops[this.currentIndex]; // This will correctly return the new current op if advanced.
    // This is fine.

    // The `peekLength` calculation: `op ? OpUtils.getOpLength(op) - this.currentOffset : 0;`
    // Here `op` is from `this.peek()`.
    // If `this.peek()` returns the *original* op at `this.ops[this.currentIndex]` (after potentially advancing currentIndex),
    // then `OpUtils.getOpLength(op)` is the *original full length* of that current op.
    // Subtracting `this.currentOffset` (which would be 0 if `peek` advanced `currentIndex`) is correct.
    // Example: op1 (len 5, offset 0), op2 (len 3, offset 0).
    // peek() -> op1. peekLength() -> 5 - 0 = 5.
    // next(5) -> offset becomes 5 for op1.
    // peek() -> sees op1 offset 5 >= len 5. Advances to op2. currentIndex becomes 1, offset becomes 0. Returns op2.
    // peekLength() -> op is op2. OpUtils.getOpLength(op2) (which is 3) - this.currentOffset (which is 0) = 3. Correct.
    // This seems correct.

    // The provided code in the prompt for the whole class is what I will use directly.
    // No need to reconstruct it line by line in my thoughts if the prompt gives the full correct version.
    // I will use the "Expected content of src/DeltaIterator.ts" verbatim.
    // The version in the prompt for peek() is:
    // peek(): Op | null {
    //   if (!this.hasNext()) { return null; }
    //   const currentOp = this.ops[this.currentIndex]; // Original op at current index
    //   // Check if this original op is fully consumed
    //   if (currentOp && this.currentOffset >= OpUtils.getOpLength(currentOp)) {
    //     // If so, and if there's another op after it
    //     if (this.currentIndex < this.ops.length - 1) {
    //       this.currentIndex++; // Advance to next op
    //       this.currentOffset = 0; // Reset offset for the new op
    //       // currentOp = this.ops[this.currentIndex]; // Update currentOp to the new one for return
    //     } else {
    //       // Fully consumed current op, and it's the last op
    //       return null;
    //     }
    //   }
    //   // Return the op at the (potentially advanced) currentIndex
    //   // If currentOffset > 0 for this op, it means it's partially consumed.
    //   // The prompt's version of peek() returns the *original* op, not a slice.
    //   // This is consistent with peekLength() then subtracting currentOffset.
    //   return this.ops[this.currentIndex];
    // }
    // This is the one I will use.
    // The `peekLength` in the prompt is `op ? OpUtils.getOpLength(op) - this.currentOffset : 0;`
    // where `op` is from `this.peek()`. This is correct if `this.peek()` returns the original op
    // at `this.ops[this.currentIndex]` (after potential advancement).

    // The `next()` method in the prompt:
    // `const op = this.peek(); if (op) { this.currentOffset = OpUtils.getOpLength(op); }` for `next()`
    // This is also correct if `peek()` returns the original op, as `OpUtils.getOpLength(op)` gives its full original length.
    // Setting `currentOffset` to this full length effectively consumes it.

    // The `next(length)`:
    // `const currentOp = this.peek(); if (!currentOp) break;`
    // `const remainingLengthInCurrentOp = OpUtils.getOpLength(currentOp) - this.currentOffset;`
    // This also relies on `peek()` returning the original op at `this.ops[this.currentIndex]`.

    // It seems the "Expected content" in the prompt is self-consistent.
    // I will use it directly.
  }

  peek(): Op | null {
    if (!this.hasNext()) {
      return null;
    }
    const currentOp = this.ops[this.currentIndex];
    if (currentOp && this.currentOffset >= OpUtils.getOpLength(currentOp)) {
      if (this.currentIndex < this.ops.length - 1) {
        this.currentIndex++;
        this.currentOffset = 0;
      } else {
        return null;
      }
    }
    return this.ops[this.currentIndex]; // Returns the original op at the current or newly advanced index
  }

  peekType(): string | null {
    const op = this.peek(); // peek() already handles advancing if current is consumed
    if (op) {
      if (op.insert !== undefined) return 'insert';
      if (op.delete !== undefined) return 'delete';
      if (op.retain !== undefined) return 'retain';
    }
    return null;
  }

  peekLength(): number {
    const op = this.peek(); // op is the original op at the current (possibly advanced) index
    // this.currentOffset is the offset *into this specific op*
    return op ? OpUtils.getOpLength(op) - this.currentOffset : 0;
  }

  next(length?: number): void {
    if (!this.hasNext()) { // Check if any consumable part is left
      return;
    }

    if (length === undefined) {
      // Consume the rest of the current operation
      // this.peek() will ensure we're on a valid op (or return null if truly nothing left)
      const op = this.peek();
      if (op) {
          // OpUtils.getOpLength(op) is the *original* length of the op returned by peek().
          // Set currentOffset to this original length to mark it as fully consumed.
          this.currentOffset = OpUtils.getOpLength(op);
      }
      // The next call to hasNext() or peek() will handle advancing currentIndex
      // if this.currentOffset now meets/exceeds the length of this.ops[this.currentIndex].
      return;
    }

    let lengthToConsume = length;
    while (lengthToConsume > 0 && this.hasNext()) {
      // peek() ensures we are on an op with remaining content or moves to the next one.
      // It returns the original op at the current index.
      const currentOp = this.peek();
      if (!currentOp) break; // Should not happen if hasNext is true

      // Calculate remaining length in the *original* current op from its current offset
      const remainingLengthInCurrentOp = OpUtils.getOpLength(currentOp) - this.currentOffset;

      if (lengthToConsume < remainingLengthInCurrentOp) {
        this.currentOffset += lengthToConsume;
        lengthToConsume = 0;
      } else {
        lengthToConsume -= remainingLengthInCurrentOp;
        // Mark current op as fully consumed by setting offset to its original full length
        this.currentOffset = OpUtils.getOpLength(currentOp);
        // The next call to peek() or hasNext() will advance currentIndex if needed.
      }
    }
  }
}
