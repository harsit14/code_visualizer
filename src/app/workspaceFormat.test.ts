import { describe, expect, it } from 'vitest';
import { MAX_WORKSPACE_BYTES, parseWorkspace, serializeWorkspace } from './workspaceFormat';
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
  ])('rejects malformed/future/nested fields before use', (mutate) => {
    const payload = JSON.parse(serializeWorkspace(workspaceRevision()));
    mutate(payload);
    expect(() => parseWorkspace(JSON.stringify(payload))).toThrow();
  });
  it('rejects oversized files and invalid JSON', () => {
    expect(() => parseWorkspace(' '.repeat(MAX_WORKSPACE_BYTES + 1))).toThrow('25 MB');
    expect(() => parseWorkspace('{')).toThrow('valid JSON');
  });
  it('stops unfinished cases and clamps replay position', () => {
    const workspace = workspaceRevision();
    workspace.content.cases[0].status = 'running';
    workspace.content.step = 999;
    const restored = parseWorkspace(serializeWorkspace(workspace));
    expect(restored.content.cases[0].status).toBe('idle');
    expect(restored.content.step).toBe(1);
  });
});
