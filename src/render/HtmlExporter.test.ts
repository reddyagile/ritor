import { describe, expect, it } from 'vitest';
import { Delta } from '../Document';
import HtmlExporter from './HtmlExporter';

describe('HtmlExporter', () => {
  it('exports inline formatting and paragraph breaks', () => {
    const delta = new Delta([
      { insert: 'Hello ', attributes: { bold: true } },
      { insert: 'World', attributes: { italic: true } },
      { insert: { paragraphBreak: true } },
      { insert: 'Next line' },
      { insert: { paragraphBreak: true } },
    ]);

    const html = HtmlExporter.deltaToHtml(delta);

    expect(html).toContain('<p>');
    expect(html).toContain('<STRONG>Hello&nbsp;</STRONG>');
    expect(html).toContain('<EM>World</EM>');
    expect(html).toContain('<p>Next&nbsp;line</p>');
  });

  it('returns empty paragraph for empty delta', () => {
    const html = HtmlExporter.deltaToHtml(new Delta([]));
    expect(html).toBe('<p><br></p>');
  });
});
