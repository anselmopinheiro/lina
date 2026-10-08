/**
 * Canonical v1 representation for user-entered search queries.
 *
 * NFC keeps canonically equivalent Unicode spellings equal without applying
 * compatibility transformations or removing linguistic information.
 */
export function normalizeSearchQuery(input: string): string {
  return input
    .normalize("NFC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}
