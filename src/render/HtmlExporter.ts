import { Delta, Op } from '../Document';

const ATTRIBUTE_TO_TAG_MAP: Record<string, string> = {
  bold: 'STRONG',
  italic: 'EM',
  underline: 'U',
};

const BOOLEAN_ATTRIBUTES: string[] = ['bold', 'italic', 'underline'];

class HtmlExporter {
  public static deltaToHtml(delta: Delta): string {
    let html = '';
    let currentParagraphContent = '';
    let firstBlockEnsured = false;

    const finalizeParagraph = () => {
      html += `<p>${currentParagraphContent || '<br>'}</p>`;
      currentParagraphContent = '';
      firstBlockEnsured = true;
    };

    if (!delta || !delta.ops || delta.ops.length === 0) {
      return '<p><br></p>';
    }

    delta.ops.forEach((op: Op) => {
      if (op.insert === undefined) {
        return;
      }

      if (typeof op.insert === 'string') {
        let text = op.insert;
        text = text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');

        const segments = text.split('\n');
        segments.forEach((segment, i) => {
          if (!firstBlockEnsured && (segment || i < segments.length - 1)) {
            firstBlockEnsured = true;
          }

          if (segment) {
            let segmentHtml = segment;
            if (op.attributes) {
              for (const attrKey in op.attributes) {
                if (op.attributes.hasOwnProperty(attrKey) && op.attributes[attrKey] === true) {
                  const tagName = ATTRIBUTE_TO_TAG_MAP[attrKey];
                  if (tagName && BOOLEAN_ATTRIBUTES.includes(attrKey)) {
                    segmentHtml = `<${tagName}>${segmentHtml}</${tagName}>`;
                  }
                }
              }
            }
            segmentHtml = segmentHtml.replace(/ /g, '&nbsp;');
            currentParagraphContent += segmentHtml;
          }

          if (i < segments.length - 1) {
            currentParagraphContent += '<br>';
          }
        });
      } else if (typeof op.insert === 'object' && op.insert !== null && (op.insert as any).paragraphBreak === true) {
        if (currentParagraphContent || !firstBlockEnsured || (html.length > 0 && !html.endsWith('</p>'))) {
          finalizeParagraph();
        } else if (firstBlockEnsured) {
          finalizeParagraph();
        }
      }
    });

    if (currentParagraphContent || !firstBlockEnsured) {
      finalizeParagraph();
    }

    return html || '<p><br></p>';
  }
}

export default HtmlExporter;
