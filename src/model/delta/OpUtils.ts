import { Op, ParagraphBreakMarker } from '../../Document';

export default class OpUtils {
  public static getOpLength(op: Op): number {
    if (typeof op.delete === 'number') return op.delete;
    if (typeof op.retain === 'number') return op.retain;

    if (typeof op.insert === 'string') {
      return op.insert.length;
    }

    if (
      typeof op.insert === 'object' &&
      op.insert !== null &&
      (op.insert as ParagraphBreakMarker).paragraphBreak === true
    ) {
      return 1;
    }

    if (op.insert === undefined && op.delete === undefined && op.retain === undefined) {
      return 0;
    }

    return 0;
  }
}
