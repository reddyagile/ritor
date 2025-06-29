import { Op } from './Document';
import * as OpUtils from './OpUtils';

export class DeltaIterator {
  private ops: Op[];
  private currentIndex: number = 0;
  public currentOffset: number = 0; // Changed from private to public

  constructor(ops: Op[]) {
    this.ops = ops || []; // Ensure ops is an array, even if null/undefined is passed
  }

  hasNext(): boolean {
    // Check if there's a current op that has not been fully consumed
    if (this.currentIndex < this.ops.length) {
      const currentOp = this.ops[this.currentIndex];
      // Ensure currentOp is valid before getting its length
      if (currentOp && OpUtils.getOpLength(currentOp) > this.currentOffset) {
        return true;
      }
      // If current op is fully consumed (offset >= length), check if there's a *next distinct* op
      // Must use OpUtils.getOpLength(currentOp) for comparison, not just relying on currentOp truthiness
      const currentOpOriginalLength = currentOp ? OpUtils.getOpLength(currentOp) : 0;
      if (this.currentOffset >= currentOpOriginalLength && this.currentIndex < this.ops.length - 1) {
        return true; // There's another op to move to
      }
    }
    return false;
  }

  peek(): Op | null {
    if (!this.hasNext()) { // Relies on hasNext's logic to see if anything is available
      return null;
    }

    // If current op is fully consumed (offset >= length) and there's a next one, advance to it.
    const currentOp = this.ops[this.currentIndex];
    const currentOpOriginalLength = currentOp ? OpUtils.getOpLength(currentOp) : 0;

    if (this.currentOffset >= currentOpOriginalLength) {
        // We are at the end of the current op. Try to move to the next.
        if (this.currentIndex < this.ops.length - 1) {
            this.currentIndex++;
            this.currentOffset = 0;
        } else {
            // This state means the current op is consumed, and it's the last op.
            // hasNext() should have returned false.
            return null;
        }
    }
    return this.ops[this.currentIndex]; // Return the op at current (possibly advanced) index
  }

  peekType(): string | null {
    const op = this.peek();
    if (op) {
      if (op.insert !== undefined) return 'insert';
      if (op.delete !== undefined) return 'delete';
      if (op.retain !== undefined) return 'retain';
    }
    return null; // Ensures all paths return a value for TS2366
  }

  peekLength(): number {
    const op = this.peek();
    // peek() returns the current op (original, not sliced), currentOffset applies to it.
    return op ? OpUtils.getOpLength(op) - this.currentOffset : 0;
  }

  next(length?: number): void {
    if (!this.hasNext()) { // Check if there's anything to consume based on hasNext's logic
      return;
    }

    if (length === undefined) {
      // Consume the rest of the current operation segment
      // peek() ensures we're on a valid op (or returns null if truly nothing left after advancing)
      const op = this.peek();
      if (op) {
          // OpUtils.getOpLength(op) is the *original* length of the op returned by peek().
          // Set currentOffset to this original length to mark it as fully consumed.
          this.currentOffset = OpUtils.getOpLength(op);
      }
      // The next call to peek() or hasNext() will handle advancing currentIndex
      // if this.currentOffset now meets/exceeds the length of this.ops[this.currentIndex].
      return;
    }

    let lengthToConsume = length;
    while (lengthToConsume > 0 && this.hasNext()) {
      // peek() ensures we are on an op with remaining content or moves to the next one.
      // It returns the original op at the current index.
      const currentOp = this.peek(); // This might advance currentIndex if previous op was fully consumed.
      if (!currentOp) break; // Nothing left to consume from.

      // Calculate remaining length in the *original* current op from its current offset
      const remainingLengthInCurrentOp = OpUtils.getOpLength(currentOp) - this.currentOffset;

      if (lengthToConsume < remainingLengthInCurrentOp) {
        this.currentOffset += lengthToConsume;
        lengthToConsume = 0; // All requested length consumed
      } else {
        // Consume the rest of this op, and continue if more length needs to be consumed
        lengthToConsume -= remainingLengthInCurrentOp;
        // Mark current op as fully consumed by setting offset to its original full length
        this.currentOffset = OpUtils.getOpLength(currentOp);
        // The next call to peek() or hasNext() will advance currentIndex if needed.
      }
    }
  }
}
