import { describe, expect, it, vi } from 'vitest';
import {
  DEEPSEEK_EXPLAINER_ENDPOINT,
  buildStepExplanationContext,
  explainStepWithDeepSeek,
} from './deepseekClient';
import { buildDeepSeekMessages } from './deepseekShared';
import type { EncodedValue, SessionResult, TraceStep } from './types';

const num = (value: number): EncodedValue => ({ k: 'num', t: 'int', v: String(value) });

function step(index: number, locals: Record<string, EncodedValue>): TraceStep {
  return {
    event: 'line',
    func: '<module>',
    globals: {},
    i: index,
    line: 2,
    stack: [{ func: '<module>', id: 'frame-0', line: 2, locals }],
    stdoutLen: 0,
  };
}

function result(currentStep: TraceStep): SessionResult {
  return {
    analysis: null,
    durationMs: 4,
    error: null,
    mode: 'script',
    run: {
      exception: null,
      functionName: null,
      inputs: [],
      opCount: 2,
      returnValue: null,
      seed: null,
      setupError: null,
      stderr: '',
      stdout: '',
      steps: [currentStep],
      runtimeMs: 1.1,
      memoryMb: 0.2,
      truncated: false,
      truncationReason: null,
    },
    status: 'ok',
  };
}

describe('buildStepExplanationContext', () => {
  it('includes the active line far into a file with original line numbers', () => {
    const currentStep = { ...step(0, {}), line: 401 };
    const context = buildStepExplanationContext({
      code: Array.from({ length: 450 }, (_, i) => `value = ${i}`).join('\n'),
      currentStep,
      frameIndex: null,
      language: 'python',
      previousStep: undefined,
      result: result(currentStep),
    });
    expect(context!.codeStartLine).toBe(389);
    expect(buildDeepSeekMessages(context!)[1].content).toContain('=> 401 | value = 400');
  });

  it('respects privacy choices and bounds every field', () => {
    const current = step(1, { secret: { k: 'str', v: 'x'.repeat(900), truncated: false } });
    const run = result(current);
    run.run!.stdout = `${'old line\n'.repeat(400)}latest`;
    current.stdoutLen = run.run!.stdout.length;
    const base = {
      code: 'a = 1\nsecret = input()',
      currentStep: current,
      frameIndex: null,
      language: 'python' as const,
      previousStep: step(0, {}),
      result: run,
    };
    const full = buildStepExplanationContext(base)!;
    expect(full.locals.secret.length).toBeLessThan(340);
    expect(full.stdout.endsWith('latest')).toBe(true);
    expect(full.stdout.length).toBeLessThan(1300);
    const redacted = buildStepExplanationContext(base, {
      includeCode: false,
      includeValues: false,
      includeOutput: false,
    })!;
    expect(redacted.locals).toEqual({ secret: '<str>' });
    expect(redacted.variableChanges).toEqual(['secret: created']);
    expect(redacted.stdout).toBe('');
    expect(redacted.codeExcerpt).toBe('secret = input()');
    expect(JSON.stringify(redacted)).not.toContain('xxxx');
  });

  it('keeps the active line when long lines crowd the excerpt', () => {
    const lines = Array.from({ length: 30 }, (_, index) =>
      index === 14 ? 'target = 1' : `pad_${index} = '${'y'.repeat(700)}'`,
    );
    const current = { ...step(1, {}), line: 15 };
    const context = buildStepExplanationContext({
      code: lines.join('\n'),
      currentStep: current,
      frameIndex: null,
      language: 'python',
      previousStep: undefined,
      result: result(current),
    })!;
    expect(context.codeExcerpt).toContain('target = 1');
    expect(context.codeExcerpt.length).toBeLessThanOrEqual(7100);
  });

  it('summarizes the current line and variable diff', () => {
    const previousStep = step(0, { total: num(1) });
    const currentStep = step(1, { total: num(3), i: num(2) });

    const context = buildStepExplanationContext({
      code: 'total = 1\ntotal += i',
      currentStep,
      frameIndex: null,
      language: 'python',
      previousStep,
      result: result(currentStep),
    });

    expect(context?.statePhase).toBe('before');
    expect(context?.currentLineText).toBe('total += i');
    expect(context?.changed).toEqual(['total']);
    expect(context?.added).toEqual(['i']);
    expect(context?.locals).toEqual({ i: '2', total: '3' });
    expect(context?.variableChanges).toEqual(['i: created as 2', 'total: 1 -> 3']);
  });
});

describe('buildDeepSeekMessages', () => {
  it('asks for a compact learner explanation without inventing state', () => {
    const context = buildStepExplanationContext({
      code: 'x = 1\nx += 1',
      currentStep: step(1, { x: num(2) }),
      frameIndex: null,
      language: 'python',
      previousStep: step(0, { x: num(1) }),
      result: result(step(1, { x: num(2) })),
    });

    expect(context).not.toBeNull();
    const messages = buildDeepSeekMessages(context!);

    expect(messages[0].content).toContain('using only the trace');
    expect(messages[0].content).toContain('Tie the active line to its role');
    expect(messages[1].content).toContain('Changed variables: x');
    expect(messages[1].content).toContain('Active line: 2: x += 1');
    expect(messages[1].content).toContain(
      'Variable changes (previous snapshot -> current): x: 1 -> 2',
    );
    expect(messages[1].content).toContain('=>   2 | x += 1');
  });
});

describe('explainStepWithDeepSeek', () => {
  it('posts structured trace context to the hosted explainer route', async () => {
    const currentStep = step(1, { x: num(2) });
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          model: 'deepseek-v4-flash',
          text: 'x increases from 1 to 2.',
          usage: { completionTokens: 8, promptTokens: 40, totalTokens: 48 },
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 },
      );
    });

    const explanation = await explainStepWithDeepSeek({
      code: 'x = 1\nx += 1',
      currentStep,
      fetchImpl: fetchMock as unknown as typeof fetch,
      frameIndex: null,
      language: 'python',
      previousStep: step(0, { x: num(1) }),
      result: result(currentStep),
    });

    expect(explanation.text).toBe('x increases from 1 to 2.');
    expect(explanation.usage?.totalTokens).toBe(48);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(DEEPSEEK_EXPLAINER_ENDPOINT);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(init.body as string) as {
      context: {
        currentLineText: string;
        locals: Record<string, string>;
      };
    };
    expect(body.context.currentLineText).toBe('x += 1');
    expect(body.context.locals).toEqual({ x: '2' });
  });

  it('surfaces hosted explainer errors', async () => {
    const currentStep = step(1, { x: num(2) });
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ error: 'AI explainer is not configured.' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 503,
        statusText: 'Service Unavailable',
      });
    });

    await expect(
      explainStepWithDeepSeek({
        code: 'x = 1\nx += 1',
        currentStep,
        fetchImpl: fetchMock as unknown as typeof fetch,
        frameIndex: null,
        language: 'python',
        previousStep: step(0, { x: num(1) }),
        result: result(currentStep),
      }),
    ).rejects.toThrow('AI explainer request failed (503): AI explainer is not configured.');
  });

  it('explains when Cloudflare serves the app shell instead of the Function', async () => {
    const currentStep = step(1, { x: num(2) });
    const fetchMock = vi.fn(async () => {
      return new Response('<!doctype html><div id="root"></div>', {
        headers: { 'Content-Type': 'text/html' },
        status: 200,
      });
    });

    await expect(
      explainStepWithDeepSeek({
        code: 'x = 1\nx += 1',
        currentStep,
        fetchImpl: fetchMock as unknown as typeof fetch,
        frameIndex: null,
        language: 'python',
        previousStep: step(0, { x: num(1) }),
        result: result(currentStep),
      }),
    ).rejects.toThrow(
      'AI explainer route is serving the app shell instead of the Cloudflare Function',
    );
  });
});
