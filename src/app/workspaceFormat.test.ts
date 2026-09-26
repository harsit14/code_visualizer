import { describe, expect, it } from 'vitest';
import {
  MAX_WORKSPACE_BYTES,
  parseWorkspace,
  parseWorkspaceBackup,
  serializeWorkspace,
} from './workspaceFormat';
import { workspaceRevision } from './workspaceTestFixtures';

describe('complete workspace backups', () => {
  it('round trips source, inputs, assertions, notebook, watch selections, breakpoints and replay', () => {
    const workspace = workspaceRevision();
    expect(parseWorkspace(serializeWorkspace(workspace))).toEqual(workspace);
  });
  it.each([
    (p: ReturnType<typeof JSON.parse>) => {
      p.version = 99;
    },
    (p: ReturnType<typeof JSON.parse>) => {
      p.workspace.content.notebook.status = 'bogus';
    },
    (p: ReturnType<typeof JSON.parse>) => {
      p.workspace.content.cases[0].inputs = [7];
    },
    (p: ReturnType<typeof JSON.parse>) => {
      p.workspace.content.cases.push(p.workspace.content.cases[0]);
    },
    (p: ReturnType<typeof JSON.parse>) => {
      p.workspace.content.result.run.steps[0].globals = { n: { k: 'bogus' } };
    },
    (p: ReturnType<typeof JSON.parse>) => {
      p.workspace.content.inputDrafts = JSON.parse('{"__proto__":"bad"}');
    },
    (p: ReturnType<typeof JSON.parse>) => {
      p.workspace.content.breakpoints = [-1];
    },
    (p: ReturnType<typeof JSON.parse>) => {
      p.workspace.content.bookmarks = [{ step: 1, note: 7 }];
    },
  ])('rejects malformed/future/nested fields before use', (mutate) => {
    const payload = JSON.parse(serializeWorkspace(workspaceRevision()));
    mutate(payload);
    expect(() => parseWorkspace(JSON.stringify(payload))).toThrow();
  });
  it('rejects oversized files and invalid JSON', () => {
    expect(() => parseWorkspace(' '.repeat(MAX_WORKSPACE_BYTES + 1))).toThrow('25 MB');
    expect(() => parseWorkspace('{')).toThrow('valid JSON');
  });
  it('restores backups written before bookmarks and drops bookmarks outside the trace', () => {
    const payload = JSON.parse(serializeWorkspace(workspaceRevision()));
    delete payload.workspace.content.bookmarks;
    expect(parseWorkspace(JSON.stringify(payload)).content.bookmarks).toEqual([]);
    payload.workspace.content.bookmarks = [
      { step: 9, note: 'gone' },
      { step: 0, note: 'start' },
    ];
    expect(parseWorkspace(JSON.stringify(payload)).content.bookmarks).toEqual([
      { step: 0, note: 'start' },
    ]);
  });
  it('stops unfinished cases and clamps replay position', () => {
    const workspace = workspaceRevision();
    workspace.content.cases[0].status = 'running';
    workspace.content.step = 999;
    const restored = parseWorkspace(serializeWorkspace(workspace));
    expect(restored.content.cases[0].status).toBe('idle');
    expect(restored.content.step).toBe(1);
  });
  it('carries tags and review state in version 2 backups', () => {
    const meta = { tags: ['two pointers', 'dp'], needsReview: true, reviewBy: '2026-10-01' };
    const text = serializeWorkspace(workspaceRevision(), meta);
    expect(JSON.parse(text).version).toBe(2);
    expect(parseWorkspaceBackup(text)).toEqual({ workspace: workspaceRevision(), meta });
    const payload = JSON.parse(text);
    payload.meta.tags = ['x'.repeat(40)];
    expect(() => parseWorkspaceBackup(JSON.stringify(payload))).toThrow('tag');
    payload.meta = { tags: [], needsReview: false, reviewBy: '2026-13-01' };
    expect(() => parseWorkspaceBackup(JSON.stringify(payload))).toThrow('review');
  });
  it('still imports version 1 backups, without tags', () => {
    const v1 = JSON.stringify({
      format: 'code-visualizer-workspace',
      version: 1,
      workspace: workspaceRevision(),
      meta: { tags: ['ignored'], needsReview: true, reviewBy: null },
    });
    expect(parseWorkspaceBackup(v1)).toEqual({
      workspace: workspaceRevision(),
      meta: { tags: [], needsReview: false, reviewBy: null },
    });
  });
});
