/**
 * Escapes LIKE wildcards so user text matches literally. Prisma passes
 * `contains` values straight into a LIKE pattern on PostgreSQL.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
