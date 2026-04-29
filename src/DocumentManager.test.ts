import { describe, expect, it, vi } from 'vitest';
import DocumentManager from './DocumentManager';
import { Delta } from './Document';

describe('DocumentManager block break insertion', () => {
  it('allows inserting a break between two existing breaks', () => {
    const emit = vi.fn();
    const fakeRitor = { emit } as any;
    const initialDelta = new Delta([{ insert: { paragraphBreak: true } }, { insert: { paragraphBreak: true } }]);

    const manager = new DocumentManager(fakeRitor, initialDelta);
    const beforeLength = manager.getDocument().getDelta().length();

    manager.insertBlockBreak({ index: 1, length: 0 });

    const afterDelta = manager.getDocument().getDelta();
    expect(afterDelta.length()).toBe(beforeLength + 1);
    expect(emit).toHaveBeenCalledWith('document:change', expect.anything(), { index: 2, length: 0 });
  });
});
