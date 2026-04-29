import { describe, expect, it } from 'vitest';
import { Delta, Document } from './Document';
import { Renderer } from './Renderer';

describe('Renderer paragraph breaks', () => {
  it('renders consecutive paragraph breaks as multiple empty paragraphs', () => {
    const host = document.createElement('div');
    const renderer = new Renderer(host);

    const doc = new Document(
      new Delta([
        { insert: 'a' },
        { insert: { paragraphBreak: true } },
        { insert: { paragraphBreak: true } },
      ]),
    );

    renderer.render(doc);

    const paragraphs = host.querySelectorAll('p');
    expect(paragraphs.length).toBe(3);
    expect(paragraphs[0].textContent).toBe('a');
    expect(paragraphs[1].querySelector('br')).not.toBeNull();
    expect(paragraphs[2].querySelector('br')).not.toBeNull();
  });
});
