import { Op, ParagraphBreakMarker } from '../../Document';
import OpUtils from './OpUtils';

class DeltaIterator {
  private readonly ops: Op[];
  private index: number;
  private offset: number;

  constructor(ops: Op[]) {
    this.ops = ops;
    this.index = 0;
    this.offset = 0;
  }

  public hasNext(): boolean {
    if (this.index < this.ops.length) {
      const currentOp = this.ops[this.index];
      if (currentOp) {
        const len = OpUtils.getOpLength(currentOp);
        if (this.offset < len) {
          return true;
        }
        return this.index < this.ops.length - 1;
      }
    }
    return false;
  }

  public peek(): Op | null {
    if (!this.hasNext()) return null;

    const currentOp = this.ops[this.index];
    if (!currentOp) return null;

    if (this.offset > 0) {
      if (typeof currentOp.insert === 'string') {
        return { insert: currentOp.insert.substring(this.offset), attributes: currentOp.attributes };
      }
      if (
        currentOp.insert &&
        typeof currentOp.insert === 'object' &&
        (currentOp.insert as ParagraphBreakMarker).paragraphBreak === true
      ) {
        return null;
      }
      if (currentOp.retain !== undefined) {
        return { retain: currentOp.retain - this.offset, attributes: currentOp.attributes };
      }
      if (currentOp.delete !== undefined) {
        return { delete: currentOp.delete - this.offset };
      }
      return null;
    }

    return currentOp;
  }

  public peekType(): string | null {
    const op = this.peek();
    if (!op) return null;
    if (op.hasOwnProperty('insert')) return 'insert';
    if (op.hasOwnProperty('delete')) return 'delete';
    if (op.hasOwnProperty('retain')) return 'retain';
    return null;
  }

  public next(length?: number): Op {
    if (!this.hasNext()) return {};

    const currentOp = this.ops[this.index];
    if (!currentOp) {
      this.index++;
      return {};
    }

    const currentOpFullLength = OpUtils.getOpLength(currentOp);
    const currentOpEffectiveRemainingLength = currentOpFullLength - this.offset;
    const consumeLength =
      length == null ? currentOpEffectiveRemainingLength : Math.min(length, currentOpEffectiveRemainingLength);

    if (consumeLength < 0) {
      this.index++;
      this.offset = 0;
      return {};
    }

    if (consumeLength === 0) {
      if (currentOpFullLength === 0 && this.offset === 0) {
        const opToReturn = { ...currentOp };
        this.index++;
        this.offset = 0;
        return opToReturn;
      }
      return {};
    }

    let opToReturn: Op;

    if (typeof currentOp.insert === 'string') {
      opToReturn = {
        insert: currentOp.insert.substring(this.offset, this.offset + consumeLength),
        attributes: currentOp.attributes,
      };
    } else if (
      currentOp.insert &&
      typeof currentOp.insert === 'object' &&
      (currentOp.insert as ParagraphBreakMarker).paragraphBreak === true
    ) {
      opToReturn = {
        insert: { paragraphBreak: true } as ParagraphBreakMarker,
        attributes: currentOp.attributes,
      };
    } else if (currentOp.retain !== undefined) {
      opToReturn = {
        retain: consumeLength,
        attributes: currentOp.attributes,
      };
    } else if (currentOp.delete !== undefined) {
      opToReturn = { delete: consumeLength };
    } else {
      opToReturn = {};
      console.warn('DeltaIterator: Unknown op type in next()', currentOp);
    }

    this.offset += consumeLength;
    if (this.offset >= currentOpFullLength) {
      this.index++;
      this.offset = 0;
    }

    return opToReturn;
  }
}

export default DeltaIterator;
