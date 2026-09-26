/** Workspace tags and review state: library metadata kept outside code revisions. */
export const MAX_TAGS = 12;
export const MAX_TAG_LENGTH = 32;

export type WorkspaceMeta = {
  tags: string[];
  needsReview: boolean;
  /** Local calendar date (YYYY-MM-DD) after which the workspace counts as due. */
  reviewBy: string | null;
};
export const EMPTY_META: WorkspaceMeta = { tags: [], needsReview: false, reviewBy: null };

/** Pattern names from the guided lessons plus common interview patterns. */
export const SUGGESTED_TAGS = [
  'two pointers',
  'sliding window',
  'binary search',
  'bfs',
  'dfs',
  'dp',
  'heap',
  'recursion',
  'hash map',
  'stack',
  'graph',
  'greedy',
];

// Spellings learners commonly type map onto one filterable tag.
const ALIASES: Record<string, string> = {
  'two pointer': 'two pointers',
  'two-pointer': 'two pointers',
  'two-pointers': 'two pointers',
  'breadth first search': 'bfs',
  'breadth-first search': 'bfs',
  'depth first search': 'dfs',
  'depth-first search': 'dfs',
  'dynamic programming': 'dp',
  hashmap: 'hash map',
  'hash table': 'hash map',
  'priority queue': 'heap',
};
const TAG = /^[\p{L}\p{N}][\p{L}\p{N} _+#./'-]*$/u;

/** Lowercase, trimmed and whitespace-collapsed; null when empty, too long or unprintable. */
export function normalizeTag(raw: string): string | null {
  const tag = raw.normalize('NFC').trim().replace(/^#+/, '').replace(/\s+/g, ' ').toLowerCase();
  const canonical = ALIASES[tag] ?? tag;
  return canonical.length > 0 && canonical.length <= MAX_TAG_LENGTH && TAG.test(canonical)
    ? canonical
    : null;
}

export function addTag(tags: string[], raw: string): { tags: string[]; error: string | null } {
  const tag = normalizeTag(raw);
  if (!tag)
    return {
      tags,
      error: `Tags use letters, numbers and spaces, up to ${MAX_TAG_LENGTH} characters.`,
    };
  if (tags.includes(tag)) return { tags, error: null };
  if (tags.length >= MAX_TAGS)
    return { tags, error: `A workspace can have up to ${MAX_TAGS} tags.` };
  return { tags: [...tags, tag], error: null };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export function validDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  // Rejects dates such as 2026-02-30 that Date would roll into the next month.
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** Validates untrusted metadata from backups and archives; throws on anything unexpected. */
export function parseWorkspaceMeta(value: unknown): WorkspaceMeta {
  const meta = value as Record<string, unknown> | null;
  if (
    !meta ||
    typeof meta !== 'object' ||
    Array.isArray(meta) ||
    !Array.isArray(meta.tags) ||
    meta.tags.length > MAX_TAGS ||
    typeof meta.needsReview !== 'boolean' ||
    !(meta.reviewBy === null || (typeof meta.reviewBy === 'string' && validDate(meta.reviewBy)))
  ) {
    throw new Error('Invalid workspace tags or review state.');
  }
  const tags = meta.tags.map((tag) => (typeof tag === 'string' ? normalizeTag(tag) : null));
  if (tags.some((tag) => tag === null)) throw new Error('Invalid workspace tag.');
  return {
    tags: [...new Set(tags as string[])],
    needsReview: meta.needsReview,
    reviewBy: meta.reviewBy as string | null,
  };
}

/** Local date in the same YYYY-MM-DD form the date input uses. */
export function localDate(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export const reviewDue = (meta: WorkspaceMeta, today: string) =>
  meta.needsReview || (meta.reviewBy !== null && meta.reviewBy <= today);

/** Suggested tags not yet applied; patterns named in the notebook come first. */
export function suggestTags(applied: string[], notebookPatterns = ''): string[] {
  const hint = ` ${notebookPatterns.toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, ' ')} `;
  const mentioned = (tag: string) =>
    hint.includes(` ${tag} `) ||
    Object.entries(ALIASES).some(
      ([alias, target]) => target === tag && hint.includes(` ${alias} `),
    );
  const open = SUGGESTED_TAGS.filter((tag) => !applied.includes(tag));
  return [...open.filter(mentioned), ...open.filter((tag) => !mentioned(tag))];
}
