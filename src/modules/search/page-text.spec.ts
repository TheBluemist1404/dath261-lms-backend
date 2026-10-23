import { describe, expect, it } from 'vitest';
import { pageText, snippetAround } from './page-text.js';

describe('pageText', () => {
  it('joins every string text field of a Lexical state in order', () => {
    const state = {
      root: {
        type: 'root',
        children: [
          { type: 'heading', children: [{ type: 'text', text: 'Graphs' }] },
          {
            type: 'paragraph',
            children: [
              { type: 'text', text: 'Breadth first', format: 1 },
              { type: 'text', text: 'search' },
            ],
          },
        ],
      },
    };

    expect(pageText(state)).toBe('Graphs Breadth first search');
  });

  it('ignores keys, node types and non-string text values', () => {
    expect(pageText({ type: 'paragraph', text: 42, children: [{ text: null }] })).toBe('');
  });

  it('handles empty and scalar content', () => {
    expect(pageText(null)).toBe('');
    expect(pageText('loose string')).toBe('');
    expect(pageText({ text: 'plain' })).toBe('plain');
  });
});

describe('snippetAround', () => {
  it('returns short text whole', () => {
    expect(snippetAround('find me here', 5, 2)).toBe('find me here');
  });

  it('cuts long text around the match with ellipses', () => {
    const text = `${'a'.repeat(100)}MATCH${'b'.repeat(100)}`;
    const snippet = snippetAround(text, 100, 5);

    expect(snippet).toBe(`…${'a'.repeat(60)}MATCH${'b'.repeat(60)}…`);
  });
});
