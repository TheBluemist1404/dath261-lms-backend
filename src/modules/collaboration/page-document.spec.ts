import * as Y from 'yjs';
import { DOCUMENT_FRAGMENT, documentText, seedDocumentState } from './page-document.js';

function load(state: Uint8Array) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc;
}

describe('page document', () => {
  it('seeds one paragraph block per line of plain-text content', () => {
    const doc = load(seedDocumentState({ type: 'plain-text', text: '\nFirst\n\nSecond\n' }));
    const group = doc.getXmlFragment(DOCUMENT_FRAGMENT).get(0) as Y.XmlElement;

    expect(group.nodeName).toBe('blockGroup');
    expect(group.length).toBe(3);
    const container = group.get(0) as Y.XmlElement;
    expect(container.nodeName).toBe('blockContainer');
    expect(container.getAttribute('id')).toEqual(expect.any(String));
    const paragraph = container.get(0) as Y.XmlElement;
    expect(paragraph.nodeName).toBe('paragraph');
    expect(paragraph.getAttribute('textAlignment')).toBe('left');
    expect(documentText(doc)).toBe('First\nSecond');
  });

  it('seeds a single empty block for pages without content', () => {
    const doc = load(seedDocumentState(null));
    const group = doc.getXmlFragment(DOCUMENT_FRAGMENT).get(0) as Y.XmlElement;

    expect(group.length).toBe(1);
    expect(documentText(doc)).toBe('');
  });

  it('falls back to every text field for other editor formats', () => {
    const doc = load(
      seedDocumentState({ type: 'blocknote', blocks: [{ content: [{ text: 'Rich note' }] }] }),
    );
    expect(documentText(doc)).toBe('Rich note');
  });

  it('reads nested blocks and formatted text in document order', () => {
    const doc = new Y.Doc();
    const group = new Y.XmlElement('blockGroup');
    const outer = new Y.XmlElement('blockContainer');
    const heading = new Y.XmlElement('heading');
    const text = new Y.XmlText();
    text.insert(0, 'Bold');
    text.insert(4, ' title', {});
    text.format(0, 4, { bold: true });
    heading.insert(0, [text]);
    const children = new Y.XmlElement('blockGroup');
    const inner = new Y.XmlElement('blockContainer');
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.insert(0, [new Y.XmlText('Child')]);
    inner.insert(0, [paragraph]);
    children.insert(0, [inner]);
    outer.insert(0, [heading, children]);
    group.insert(0, [outer]);
    doc.getXmlFragment(DOCUMENT_FRAGMENT).insert(0, [group]);

    expect(documentText(doc)).toBe('Bold title\nChild');
  });
});
