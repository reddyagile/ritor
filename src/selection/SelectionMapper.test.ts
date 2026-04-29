import { describe, expect, it } from 'vitest';
import SelectionMapper from './SelectionMapper';

describe('SelectionMapper', () => {
  it('maps DOM range to doc index across blocks', () => {
    const editor = document.createElement('div');
    editor.innerHTML = '<p>abc</p><p>def</p>';

    const mapper = new SelectionMapper(editor);
    const secondText = editor.querySelectorAll('p')[1].firstChild as Text;

    const range = document.createRange();
    range.setStart(secondText, 0);
    range.setEnd(secondText, 0);

    const selection = mapper.domRangeToDocSelection(range);

    expect(selection).toEqual({ index: 4, length: 0 });
  });

  it('maps doc index back to DOM point', () => {
    const editor = document.createElement('div');
    editor.innerHTML = '<p>abc</p><p>def</p>';

    const mapper = new SelectionMapper(editor);
    const range = mapper.docSelectionToDomRange({ index: 4, length: 0 });

    expect(range).not.toBeNull();
    expect(range?.collapsed).toBe(true);
    expect(range?.startOffset).toBe(0);
    expect((range?.startContainer as Text).textContent).toBe('def');
  });
});
