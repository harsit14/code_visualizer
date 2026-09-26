import type { Language } from '../engine/types';
import { reviewDue } from './workspaceTags';
import type { WorkspaceSummary } from './workspaceStore';

export type WorkspaceSort = 'recent' | 'name';
export type WorkspaceFilters = {
  query: string;
  language: Language | '';
  tag: string;
  reviewOnly: boolean;
  sort: WorkspaceSort;
  /** Local YYYY-MM-DD date used for review-by filtering. */
  today: string;
};
export type WorkspaceIndex = { item: WorkspaceSummary; text: string }[];

/** Lowercased once when the list loads, so each keystroke is a plain substring scan. */
export function buildWorkspaceIndex(items: WorkspaceSummary[]): WorkspaceIndex {
  return items.map((item) => ({
    item,
    text: [item.name, ...item.tags, item.source].join('\n').toLowerCase(),
  }));
}

/** Autosaves count as activity, so a workspace being edited stays near the top. */
export const lastActivity = (item: WorkspaceSummary) =>
  Math.max(item.savedAt, item.autosave?.savedAt ?? 0);

const byName = (a: WorkspaceSummary, b: WorkspaceSummary) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/** Every query word must appear in the name, tags or latest source. */
export function searchWorkspaces(
  index: WorkspaceIndex,
  filters: WorkspaceFilters,
): WorkspaceSummary[] {
  const terms = filters.query.toLowerCase().split(/\s+/).filter(Boolean);
  return index
    .filter(
      ({ item, text }) =>
        (!filters.language || item.language === filters.language) &&
        (!filters.tag || item.tags.includes(filters.tag)) &&
        (!filters.reviewOnly || reviewDue(item, filters.today)) &&
        terms.every((term) => text.includes(term)),
    )
    .map(({ item }) => item)
    .sort((a, b) =>
      filters.sort === 'name'
        ? byName(a, b) || lastActivity(b) - lastActivity(a)
        : lastActivity(b) - lastActivity(a) || byName(a, b),
    );
}

export function libraryTags(items: WorkspaceSummary[]): string[] {
  return [...new Set(items.flatMap((item) => item.tags))].sort();
}
