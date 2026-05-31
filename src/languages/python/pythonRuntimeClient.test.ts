import { describe, expect, it } from 'vitest';
import { createTimeoutResult } from './pythonRuntimeClient';

describe('python runtime client helpers', () => {
  it('creates a synthetic timeout result when a worker must be restarted', () => {
    const result = createTimeoutResult('run-1', 2500, 'worker-terminate', 2520);

    expect(result.status).toBe('timeout');
    expect(result.requestId).toBe('run-1');
    expect(result.interruptMode).toBe('worker-terminate');
    expect(result.error?.name).toBe('ExecutionTimeout');
    expect(result.error?.message).toContain('2500ms');
  });
});
