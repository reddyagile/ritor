import { describe, expect, it, vi } from 'vitest';
import DocumentManager from './DocumentManager';
import { Delta } from './Document';

describe('DocumentManager enter guard', () => {
  it('blocks inserting a break between two existing breaks', () => {
    const emit = vi.fn();
    const fakeRitor = { emit } as any;
    const initialDelta = new Delta([{ insert: { paragraphBreak: true } }, { insert: { paragraphBreak: true } }]);

    const manager = new DocumentManager(fakeRitor, initialDelta);
    const before = manager.getDocument().getDelta().ops;

    manager.insertBlockBreak({ index: 1, length: 0 });

    const after = manager.getDocument().getDelta().ops;
    expect(after).toEqual(before);
    expect(emit).not.toHaveBeenCalledWith('document:change', expect.anything(), expect.anything());
  });
});
