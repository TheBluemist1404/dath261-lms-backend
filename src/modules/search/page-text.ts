/**
 * Text of an editor document: every string `text` field, in document order.
 * Covers Lexical's serialized state and the plain-text stand-in alike.
 */
export function pageText(content: unknown): string {
  if (!content || typeof content !== 'object') {
    return '';
  }
  if (Array.isArray(content)) {
    return joinText(content.map(pageText));
  }
  return joinText(
    Object.entries(content).map(([key, value]) =>
      key === 'text' && typeof value === 'string' ? value : pageText(value),
    ),
  );
}

function joinText(parts: string[]): string {
  return parts.filter(Boolean).join(' ');
}

const SNIPPET_RADIUS = 60;

/** Up to 60 characters either side of a match, with ellipses where cut. */
export function snippetAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(text.length, index + length + SNIPPET_RADIUS);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}
