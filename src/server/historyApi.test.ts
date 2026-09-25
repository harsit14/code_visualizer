import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAccountApi } from './accountApi';
import { DatabaseRequestError, getDatabase } from './database';
import {
  ALICE,
  ALICE_TOKEN,
  BOB,
  BOB_TOKEN,
  cookie,
  createAccountFixture,
} from './accountTestFixtures';

vi.mock('./database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./database')>()),
  getDatabase: vi.fn(),
}));

const env = {
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  SUPABASE_URL: 'https://project.supabase.co',
};
const key = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const payload = { code: 'print(42)', language: 'python', title: 'Answer' };
let fixture: Awaited<ReturnType<typeof createAccountFixture>>;

function save(token: string, headers: Record<string, string> = {}, body: unknown = payload) {
  return handleAccountApi(
    new Request('https://app.example/api/history', {
      body: JSON.stringify(body),
      headers: { ...cookie(token), 'Content-Type': 'application/json', ...headers },
      method: 'POST',
    }),
    env,
  ) as Promise<Response>;
}

async function use(migrated = true) {
  fixture = await createAccountFixture({ migrated });
  vi.mocked(getDatabase).mockReturnValue(fixture.database);
}

beforeEach(() => use());

describe('history saves', () => {
  it('requires a session', async () => {
    const response = (await handleAccountApi(
      new Request('https://app.example/api/history', {
        body: JSON.stringify(payload),
        headers: { 'Idempotency-Key': key },
        method: 'POST',
      }),
      env,
    )) as Response;
    expect(response.status).toBe(401);
    expect(fixture.db.insertHistoryOnce).not.toHaveBeenCalled();
  });

  it('returns the stored entry when a save is replayed after a lost acknowledgement', async () => {
    const first = await save(ALICE_TOKEN, { 'Idempotency-Key': key });
    expect(first.status).toBe(201);
    const { item } = await first.json();
    const replay = await save(ALICE_TOKEN, { 'Idempotency-Key': key.toUpperCase() });
    expect(replay.status).toBe(200);
    expect((await replay.json()).item).toEqual(item);
    expect(fixture.history.filter((row) => row.user_id === ALICE)).toHaveLength(2);
    expect(fixture.db.pruneHistory).toHaveBeenCalledOnce();
  });

  it('scopes keys to their owner', async () => {
    const alice = await (await save(ALICE_TOKEN, { 'Idempotency-Key': key })).json();
    const bob = await save(BOB_TOKEN, { 'Idempotency-Key': key });
    expect(bob.status).toBe(201);
    const bobItem = (await bob.json()).item;
    expect(bobItem.id).not.toBe(alice.item.id);
    expect(fixture.history.find((row) => row.id === bobItem.id)?.user_id).toBe(BOB);
  });

  it('rejects malformed keys', async () => {
    expect((await save(ALICE_TOKEN, { 'Idempotency-Key': 'not-a-uuid' })).status).toBe(400);
    expect(fixture.db.insertHistoryOnce).not.toHaveBeenCalled();
  });

  it('keeps saving before migration 0004 by inserting without the key', async () => {
    await use(false);
    const response = await save(ALICE_TOKEN, { 'Idempotency-Key': key });
    expect(response.status).toBe(201);
    expect(fixture.db.insertHistory).toHaveBeenCalledOnce();
    expect((await response.json()).item.code).toBe('print(42)');
  });

  it('surfaces other database errors instead of silently inserting', async () => {
    fixture.db.insertHistoryOnce.mockRejectedValueOnce(
      new DatabaseRequestError('permission denied', 403, '42501'),
    );
    const response = await save(ALICE_TOKEN, { 'Idempotency-Key': key });
    expect(response.status).toBe(503);
    expect(fixture.db.insertHistory).not.toHaveBeenCalled();
  });

  it('still updates an owned entry by ID', async () => {
    const response = await save(
      ALICE_TOKEN,
      { 'Idempotency-Key': key },
      { ...payload, id: 'alice-history' },
    );
    expect(response.status).toBe(200);
    expect(fixture.db.updateHistory).toHaveBeenCalledOnce();
    expect(fixture.db.insertHistoryOnce).not.toHaveBeenCalled();
  });
});
