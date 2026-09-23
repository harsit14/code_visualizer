import { describe, expect, it } from 'vitest';
import { runJavaScriptTrace } from '../engine/jsTraceEngine';
import {
  appOrigin,
  MAX_MESSAGE_CHARS,
  parseMessage,
  runnerUrl,
  validateRequest,
  validateResponse,
} from './protocol';

describe('runner protocol', () => {
  it('accepts exact separate origins without credentials or query data', () => {
    expect(runnerUrl('https://runner.example/runner.html', 'https://app.example').origin).toBe(
      'https://runner.example',
    );
    expect(appOrigin('http://127.0.0.1:4173')).toBe('http://127.0.0.1:4173');
    for (const url of [
      'https://app.example/runner.html',
      'http://runner.example/runner.html',
      'https://user:password@runner.example/runner.html',
      'https://runner.example/runner.html?source=private',
      'https://runner.example/other',
      'javascript:alert(1)',
    ]) {
      expect(() => runnerUrl(url, 'https://app.example')).toThrow();
    }
  });
  it('bounds source, options, response types and wire size', () => {
    expect(
      validateRequest(
        { type: 'request', requestId: '1', request: { op: 'run', source: 'pass' } },
        'python',
      ),
    ).toBe('run');
    expect(() =>
      validateRequest({ source: 'x'.repeat(200001), language: 'javascript' }, 'javascript'),
    ).toThrow();
    expect(() =>
      validateRequest(
        {
          type: 'request',
          requestId: '1',
          request: { op: 'run', source: '', options: { maxSteps: 1e9 } },
        },
        'python',
      ),
    ).toThrow();
    expect(() => parseMessage({ type: 'response' })).toThrow();
    expect(() => parseMessage('x'.repeat(MAX_MESSAGE_CHARS + 1))).toThrow();
    expect(() =>
      validateResponse({ type: 'status', status: { phase: 'trusted-admin' } }, 'python', 'run'),
    ).toThrow();
    expect(() =>
      validateResponse({ status: 'ok', run: { steps: [null] } }, 'javascript', 'run'),
    ).toThrow();
  });
  it('validates the full replay and normalizes dispatch errors', () => {
    const result = runJavaScriptTrace('const a = 1;', 'javascript');
    expect(validateResponse(result, 'javascript', 'run')).toEqual(result);
    const error = validateResponse(
      {
        type: 'response',
        requestId: '1',
        durationMs: 0,
        data: { error: { type: 'WorkerError', msg: 'boot failed' } },
      },
      'python',
      'run',
    );
    expect(error).toMatchObject({
      data: { status: 'error', run: null, error: { msg: 'boot failed' } },
    });
  });
  it('rejects malformed complexity and analysis responses', () => {
    const response = (data: unknown) => ({ type: 'response', requestId: '1', durationMs: 1, data });
    expect(() =>
      validateResponse(response({ analysis: { functions: [null] } }), 'python', 'analyze'),
    ).toThrow();
    expect(() =>
      validateResponse(
        response({ functionName: null, seed: null, samples: [{ n: '1', ops: 2 }], error: null }),
        'python',
        'complexity',
      ),
    ).toThrow();
    expect(
      validateResponse(
        response({ functionName: 'solve', seed: 1, samples: [{ n: 1, ops: 2 }], error: null }),
        'python',
        'complexity',
      ),
    ).toBeTruthy();
  });
});
