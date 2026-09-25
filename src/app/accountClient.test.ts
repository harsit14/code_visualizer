// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteAccount, downloadAccountData, revokeOtherSessions } from './accountClient';
import { saveCodeHistory } from './historyClient';

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('account client', () => {
  it('announces an account change only after a confirmed deletion', async () => {
    const changed = vi.fn();
    window.addEventListener('cv-account-changed', changed);
    vi.stubGlobal(
      'fetch',
      vi
        .fn<FetchMock>()
        .mockResolvedValueOnce(
          Response.json({ error: 'That password is incorrect.' }, { status: 401 }),
        )
        .mockResolvedValueOnce(Response.json({ ok: true })),
    );
    await expect(
      deleteAccount({ confirmEmail: 'person@example.com', password: 'wrong' }),
    ).rejects.toThrow('That password is incorrect.');
    expect(changed).not.toHaveBeenCalled();
    await deleteAccount({ confirmEmail: 'person@example.com', password: 'right' });
    expect(changed).toHaveBeenCalledOnce();
    window.removeEventListener('cv-account-changed', changed);
  });

  it('does not treat session changes elsewhere as an account change', async () => {
    const changed = vi.fn();
    window.addEventListener('cv-account-changed', changed);
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>(async () => Response.json({ revoked: 3 })),
    );
    await expect(revokeOtherSessions()).resolves.toBe(3);
    expect(changed).not.toHaveBeenCalled();
    window.removeEventListener('cv-account-changed', changed);
  });

  it('saves the export as a dated JSON download', async () => {
    const exported = { format: 'code-visualizer-account-export', version: 1 };
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>(async () => Response.json(exported)),
    );
    const { Blob: NativeBlob } = await import('node:buffer');
    vi.stubGlobal('Blob', NativeBlob);
    const create = vi.fn((blob: Blob) => (blob.size ? 'blob:account' : ''));
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = create;
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ['setTimeout'] });

    try {
      const filename = await downloadAccountData();
      expect(filename).toMatch(/^code-visualizer-account-\d{4}-\d{2}-\d{2}\.json$/);
      expect(click).toHaveBeenCalledOnce();
      expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe(filename);
      expect(JSON.parse(await create.mock.calls[0][0].text())).toEqual(exported);
      vi.runAllTimers();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:account');
    } finally {
      vi.useRealTimers();
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });
});

describe('history client', () => {
  it('sends the idempotency key with a save', async () => {
    const fetchMock = vi.fn<FetchMock>(async () => Response.json({ item: null }));
    vi.stubGlobal('fetch', fetchMock);
    await saveCodeHistory(
      { code: 'x = 1', language: 'python', title: 'x' },
      undefined,
      '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
    );
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Idempotency-Key')).toBe(
      '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
    );
  });
});
