import { Op, ParagraphBreakMarker } from './Document'; // Assuming Document.ts is in the same dir or path is adjusted

export function getOpLength(op: Op): number {
  if (typeof op.delete === 'number') {
    return op.delete;
  }
  if (typeof op.retain === 'number') {
    return op.retain;
  }
  if (typeof op.insert === 'string') {
    return op.insert.length;
  }
  if (typeof op.insert === 'object' && op.insert !== null) {
    // Check for paragraphBreak specifically, otherwise assume length 1 for other objects
    if ((op.insert as ParagraphBreakMarker).paragraphBreak === true) {
      return 1;
    }
    // Add other specific object checks here if they have different lengths
    return 1; // Default length for embed-like objects
  }
  return 0;
}

export function isParagraphBreak(op: Op | undefined | null): op is Op & { insert: ParagraphBreakMarker } {
  return !!(op && typeof op.insert === 'object' && op.insert !== null && (op.insert as ParagraphBreakMarker).paragraphBreak === true);
}

// Utility to check if an op is a plain text insert
export function isTextInsert(op: Op | undefined | null): op is Op & { insert: string } {
  return !!(op && typeof op.insert === 'string');
}
