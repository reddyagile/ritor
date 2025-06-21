// src/Document.ts

export interface OpAttributes {
  bold?: boolean | null;       // Allow null
  italic?: boolean | null;     // Allow null
  underline?: boolean | null;  // Allow null
  // Example for future: link?: string | null;
  [key: string]: any;          // Index signature for extensibility (already present)
}

// New type for the paragraph break marker
export interface ParagraphBreakMarker {
  paragraphBreak: true; // The value is always true, its presence is the marker
}

export interface Op {
  insert?: string | ParagraphBreakMarker; // MODIFIED: insert can be string or ParagraphBreakMarker
  delete?: number;
  retain?: number;
  attributes?: OpAttributes;
}

export class Delta {
  ops: Op[];

  constructor(ops?: Op[] | Delta) {
    if (Array.isArray(ops)) {
      this.ops = ops;
    } else if (ops instanceof Delta) {
      this.ops = ops.ops.slice(); // Create a copy
    } else {
      this.ops = [];
    }
  }

  // Adds an operation to the end of the Delta
  push(op: Op): this {
    this.ops.push(op);
    return this;
  }

  // Concatenates another Delta to this one
  concat(other: Delta): Delta {
    const newDelta = new Delta(this.ops.slice());
    if (other.ops.length > 0) {
      newDelta.ops = newDelta.ops.concat(other.ops.slice());
    }
    return newDelta;
  }

  // Returns the length of the document represented by this Delta
  length(): number {
    return this.ops.reduce((len, op) => {
      if (typeof op.insert === 'string') {
        return len + op.insert.length;
      } else if (typeof op.delete === 'number') {
        // Deletes don't add to the length of the *resulting* document
        return len;
      } else if (typeof op.retain === 'number') {
        return len + op.retain;
      }
      return len;
    }, 0);
  }

  // More methods will be added later, e.g., for transforming, composing Deltas
}

export class Document {
  private currentState: Delta;

  constructor(initialContent?: string | Delta) {
    if (typeof initialContent === 'string') {
      this.currentState = new Delta().push({ insert: initialContent });
    } else if (initialContent instanceof Delta) {
      this.currentState = initialContent;
    } else {
      this.currentState = new Delta().push({ insert: '\n' }); // Start with a newline, common practice
    }
  }

  getDelta(): Delta {
    return new Delta(this.currentState); // Return a copy to maintain immutability
  }

  // Applies a change Delta to the current document state
  // This will be a simplified version for now.
  // A full implementation requires careful handling of op composition.
  applyDelta(change: Delta): Document {
    // For now, let's assume `change` is a new complete state or a simple append.
    // A proper apply function is complex and involves composing deltas.
    // We will refine this in the DocumentManager step.
    // This is a placeholder for the concept.

    // A very naive approach for now, just concatenating.
    // THIS IS NOT HOW DELTAS ARE TRULY APPLIED but serves as a starting point.
    const newOps = this.currentState.ops.slice();

    // Example of a simplistic append, not a real delta application
    // A real apply would involve transforming currentOps based on change.ops
    // For instance, if change.ops has a delete, it should affect newOps.
    // If change.ops has a retain, it might apply attributes.
    // If change.ops has an insert, it inserts at the correct position.

    // For the purpose of this step, we'll just create a new Document with the given delta.
    // The actual logic of applying deltas will be in DocumentManager.
    return new Document(change);
  }

  getText(): string {
    return this.currentState.ops
      .filter(op => typeof op.insert === 'string')
      .map(op => op.insert)
      .join('');
  }
}
