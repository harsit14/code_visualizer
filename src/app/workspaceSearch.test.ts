import { describe, expect, it } from 'vitest';
import {
  buildWorkspaceIndex,
  libraryTags,
  searchWorkspaces,
  type WorkspaceFilters,
} from './workspaceSearch';
import type { WorkspaceSummary } from './workspaceStore';

const summary = (overrides: Partial<WorkspaceSummary>): WorkspaceSummary => ({
  id: overrides.name ?? 'id',
  name: 'Workspace',
  revision: 1,
  savedAt: 1,
  language: 'python',
  source: '',
  tags: [],
  needsReview: false,
  reviewBy: null,
  metaRevision: 0,
  autosave: null,
  ...overrides,
});
const items = [
  summary({ name: 'Two Sum', savedAt: 30, tags: ['hash map'], source: 'seen = {}' }),
  summary({
    name: 'Max window',
    savedAt: 10,
    tags: ['sliding window'],
    language: 'javascript',
    source: 'let best = 0;',
    needsReview: true,
  }),
  summary({
    name: 'binary search',
    savedAt: 20,
    tags: ['binary search'],
    source: 'lo, hi = 0, len(nums) - 1',
    reviewBy: '2026-09-20',
  }),
];
const filters: WorkspaceFilters = {
  query: '',
  language: '',
  tag: '',
  reviewOnly: false,
  sort: 'recent',
  today: '2026-09-25',
};
const names = (partial: Partial<WorkspaceFilters>) =>
  searchWorkspaces(buildWorkspaceIndex(items), { ...filters, ...partial }).map((w) => w.name);

describe('workspace search', () => {
  it('matches every word across name, tags and latest source', () => {
    expect(names({ query: 'SEEN' })).toEqual(['Two Sum']);
    expect(names({ query: 'hash map' })).toEqual(['Two Sum']);
    expect(names({ query: 'window best' })).toEqual(['Max window']);
    expect(names({ query: 'window missing' })).toEqual([]);
  });
  it('filters by language, tag and review state', () => {
    expect(names({ language: 'javascript' })).toEqual(['Max window']);
    expect(names({ tag: 'binary search' })).toEqual(['binary search']);
    expect(names({ reviewOnly: true })).toEqual(['binary search', 'Max window']);
    expect(names({ reviewOnly: true, today: '2026-09-01' })).toEqual(['Max window']);
  });
  it('sorts by latest activity, including autosaves, or by name', () => {
    expect(names({})).toEqual(['Two Sum', 'binary search', 'Max window']);
    expect(names({ sort: 'name' })).toEqual(['binary search', 'Max window', 'Two Sum']);
    const autosaved = [
      ...items.slice(0, 1),
      { ...items[1], autosave: { token: 't', savedAt: 99, baseRevision: 1, name: 'x' } },
    ];
    expect(searchWorkspaces(buildWorkspaceIndex(autosaved), filters).map((w) => w.name)).toEqual([
      'Max window',
      'Two Sum',
    ]);
  });
  it('lists the distinct tags in use', () => {
    expect(libraryTags(items)).toEqual(['binary search', 'hash map', 'sliding window']);
  });
  it('searches a few hundred workspaces from one prebuilt index', () => {
    const many = Array.from({ length: 400 }, (_, i) =>
      summary({
        id: `w${i}`,
        name: `Exercise ${i}`,
        savedAt: i,
        source: `value_${i} = ${i}\n`.repeat(50),
      }),
    );
    const index = buildWorkspaceIndex(many);
    expect(searchWorkspaces(index, { ...filters, query: 'value_399' }).map((w) => w.id)).toEqual([
      'w399',
    ]);
    expect(searchWorkspaces(index, { ...filters, sort: 'name' })[2].name).toBe('Exercise 2');
  });
});
