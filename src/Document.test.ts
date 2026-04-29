import { describe, expect, it } from 'vitest';
import { Delta, Document } from './Document';

describe('Document model invariants', () => {
  it('counts paragraphBreak marker length in delta length', () => {
    const delta = new Delta([{ insert: 'ab' }, { insert: { paragraphBreak: true } }, { insert: 'c' }]);

    expect(delta.length()).toBe(4);
  });

  it('uses paragraphBreak marker for default document', () => {
    const doc = new Document();
    const ops = doc.getDelta().ops;

    expect(ops.length).toBe(1);
    expect(ops[0].insert).toEqual({ paragraphBreak: true });
  });
});
