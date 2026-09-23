import type { WorkspaceContent, WorkspaceRevision } from './workspaceFormat';

export function workspaceContent(): WorkspaceContent {
  return {
    code: 'print(1)',
    language: 'python',
    functionName: null,
    inputDrafts: { nums: '[1, 2]' },
    seed: 42,
    cases: [
      {
        id: 'case-one',
        name: 'One',
        inputs: ['[1]'],
        expected: '1',
        actual: '1',
        actualLiteral: '1',
        error: null,
        status: 'pass',
        runtimeMs: 1,
        memoryMb: null,
      },
    ],
    notebook: {
      notes: 'Keep the invariant',
      patterns: 'two pointers',
      status: 'practicing',
      updatedAt: 1,
    },
    watches: ['nums'],
    breakpoints: [1],
    step: 1,
    result: {
      status: 'ok',
      mode: 'script',
      error: null,
      analysis: null,
      durationMs: 1,
      run: {
        functionName: null,
        inputs: [],
        seed: 42,
        steps: [0, 1].map((i) => ({
          i,
          phase: 'before',
          event: 'line',
          line: 1,
          func: '<module>',
          stack: [],
          globals: {},
          stdoutLen: 0,
        })),
        returnValue: null,
        exception: null,
        stdout: '1\n',
        stderr: '',
        opCount: 1,
        runtimeMs: 1,
        memoryMb: null,
        truncated: false,
        truncationReason: null,
      },
    },
  };
}
export function workspaceRevision(): WorkspaceRevision {
  return {
    id: 'workspace-one',
    name: 'My exercise',
    revision: 1,
    savedAt: 123,
    content: workspaceContent(),
  };
}
