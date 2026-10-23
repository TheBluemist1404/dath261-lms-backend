import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { pageText } from '../search/page-text.js';

/** Name of the Yjs XML fragment the BlockNote editor binds to. */
export const DOCUMENT_FRAGMENT = 'document-store';

// BlockNote's default paragraph props, written the way its own Yjs export writes them.
const PARAGRAPH_DEFAULTS = {
  backgroundColor: 'default',
  textAlignment: 'left',
  textColor: 'default',
};

/**
 * Builds the first shared state for a page that has none yet, from its stored
 * `content`. The structure mirrors what BlockNote writes through y-prosemirror:
 * blockGroup > blockContainer > paragraph > text, one paragraph per line.
 */
export function seedDocumentState(content: unknown): Uint8Array {
  const doc = new Y.Doc();
  const group = new Y.XmlElement('blockGroup');
  const lines = contentLines(content);

  group.insert(
    0,
    (lines.length > 0 ? lines : ['']).map((line) => {
      const container = new Y.XmlElement('blockContainer');
      container.setAttribute('id', randomUUID());
      const paragraph = new Y.XmlElement('paragraph');
      for (const [key, value] of Object.entries(PARAGRAPH_DEFAULTS)) {
        paragraph.setAttribute(key, value);
      }
      if (line) {
        paragraph.insert(0, [new Y.XmlText(line)]);
      }
      container.insert(0, [paragraph]);
      return container;
    }),
  );
  doc.getXmlFragment(DOCUMENT_FRAGMENT).insert(0, [group]);

  const state = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return state;
}

/** Plain text of a shared document, one line per block, for search and snippets. */
export function documentText(doc: Y.Doc): string {
  const lines: string[] = [];
  collectLines(doc.getXmlFragment(DOCUMENT_FRAGMENT), lines);
  return lines.join('\n').trim();
}

function collectLines(node: Y.XmlFragment | Y.XmlElement, lines: string[]): void {
  const children = node.toArray();
  // A block's own text sits in its XmlText children; nested blocks recurse.
  const text = children
    .filter((child) => child instanceof Y.XmlText)
    .map((child) => textOf(child as Y.XmlText))
    .join('');
  if (text) lines.push(text);
  for (const child of children) {
    if (child instanceof Y.XmlElement) collectLines(child, lines);
  }
}

function textOf(text: Y.XmlText): string {
  return (text.toDelta() as { insert: unknown }[])
    .map((op) => (typeof op.insert === 'string' ? op.insert : ''))
    .join('');
}

function contentLines(content: unknown): string[] {
  const candidate = content as { type?: unknown; text?: unknown } | null;
  const text =
    candidate?.type === 'plain-text' && typeof candidate.text === 'string'
      ? candidate.text
      : pageText(content);
  const lines = text.split(/\r?\n/).map((line) => line.trimEnd());
  while (lines.length > 0 && !lines[0]) lines.shift();
  while (lines.length > 0 && !lines[lines.length - 1]) lines.pop();
  return lines;
}
