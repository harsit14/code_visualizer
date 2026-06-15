import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEEPSEEK_CHAT_COMPLETIONS_URL } from '../../src/engine/deepseekShared';
import { onRequestPost } from './explain-step';

const context = {
  added: ['total'],
  changed: [],
  codeExcerpt: 'total = 1',
  currentLine: 1,
  currentLineText: 'total = 1',
  event: 'line',
  exception: null,
  frameName: '<module>',
  language: 'python',
  locals: { total: '1' },
  removed: [],
  returnValue: null,
  stdout: '',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('/api/explain-step', () => {
  it('uses the server-side DeepSeek secret and returns a compact explanation', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'total is initialized to 1.' } }],
          model: 'deepseek-v4-flash',
          usage: { completion_tokens: 9, prompt_tokens: 40, total_tokens: 49 },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await onRequestPost({
      env: { DEEPSEEK_API_KEY: 'sk-server-only' },
      request: new Request('https://example.com/api/explain-step', {
        body: JSON.stringify({ context }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      model: 'deepseek-v4-flash',
      text: 'total is initialized to 1.',
      usage: {
        completionTokens: 9,
        promptTokens: 40,
        totalTokens: 49,
      },
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(DEEPSEEK_CHAT_COMPLETIONS_URL);
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer sk-server-only',
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(init.body as string) as {
      messages: Array<{ content: string; role: string }>;
      model: string;
      thinking: { type: string };
    };
    expect(body.model).toBe('deepseek-v4-flash');
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.messages[1].content).toContain('Current locals: {"total":"1"}');
  });

  it('does not call DeepSeek when the secret is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await onRequestPost({
      env: {},
      request: new Request('https://example.com/api/explain-step', {
        body: JSON.stringify({ context }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'AI explainer is not configured.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
