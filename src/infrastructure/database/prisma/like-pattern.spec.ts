import { describe, expect, it } from 'vitest';
import { escapeLike } from './like-pattern.js';

describe('escapeLike', () => {
  it('escapes LIKE wildcards and the escape character', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeLike('Graph search')).toBe('Graph search');
  });
});
