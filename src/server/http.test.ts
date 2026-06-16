import { describe, expect, it } from 'vitest';
import { isRequestBodyTooLargeError, readLimitedJson, requestBodyTooLargeResponse } from './http';

describe('limited JSON reader', () => {
  it('parses JSON bodies under the limit', async () => {
    await expect(
      readLimitedJson(
        new Request('https://example.com/api/test', {
          body: JSON.stringify({ ok: true }),
          method: 'POST',
        }),
        1024,
      ),
    ).resolves.toEqual({ ok: true });
  });

  it('rejects bodies that exceed the limit while streaming', async () => {
    await expect(
      readLimitedJson(
        new Request('https://example.com/api/test', {
          body: JSON.stringify({ value: 'x'.repeat(32) }),
          method: 'POST',
        }),
        16,
      ),
    ).rejects.toSatisfy(isRequestBodyTooLargeError);
  });

  it('returns a 413 response for body limit errors', async () => {
    try {
      await readLimitedJson(
        new Request('https://example.com/api/test', {
          body: JSON.stringify({ value: 'x'.repeat(32) }),
          method: 'POST',
        }),
        16,
      );
      throw new Error('Expected readLimitedJson to fail.');
    } catch (error) {
      if (!isRequestBodyTooLargeError(error)) {
        throw error;
      }
      const response = requestBodyTooLargeResponse(error);
      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({
        error: expect.stringContaining('Request body is too large'),
      });
    }
  });
});
