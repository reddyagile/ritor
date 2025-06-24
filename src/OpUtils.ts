import { Op, OpAttributes, ParagraphBreakMarker } from './Document'; // Added OpAttributes

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

export function areAttributesSemanticallyEqual(attr1?: OpAttributes, attr2?: OpAttributes): boolean {
  const keys1 = Object.keys(attr1 || {});
  const keys2 = Object.keys(attr2 || {});

  if (keys1.length !== keys2.length) return false;

  for (const key of keys1) {
    // Non-null assertion used because if key is from Object.keys(attr1),
    // then attr1 must be defined if keys1 is not empty.
    // And if keys1 is empty, loop doesn't run.
    // Same logic applies to attr2.
    // However, it's safer if attr1 and attr2 are guarded.
    // The `|| {}` in Object.keys handles undefined attr1/attr2 for key generation.
    // For value access, we still need to be careful.
    // If attr1 is undefined, attr1![key] would fail.
    // So, ensure attr1 and attr2 are treated as potentially undefined.
    const val1 = attr1 ? attr1[key] : undefined;
    const val2 = attr2 ? attr2[key] : undefined;
    if (val1 !== val2) {
      return false;
    }
  }
  return true;
}

export function composeAttributes(
  attrA?: OpAttributes,
  attrB?: OpAttributes
): OpAttributes | undefined {
  const attributes: OpAttributes = { ...(attrA || {}) };

  if (!attrB) {
     return Object.keys(attributes).length > 0 ? attributes : undefined;
  }

  for (const key in attrB) {
    if (Object.prototype.hasOwnProperty.call(attrB, key)) {
      if (attrB[key] === null || attrB[key] === undefined) {
        delete attributes[key];
      } else {
        attributes[key] = attrB[key];
      }
    }
  }
  return Object.keys(attributes).length > 0 ? attributes : undefined;
}
