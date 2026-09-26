import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const migration = (name: string) =>
  readFileSync(`supabase/migrations/${name}`, 'utf8').replace(
    'CREATE EXTENSION IF NOT EXISTS pgcrypto;',
    '',
  );
const hash = (value: string) => value.repeat(64);
const alice = '60000000-0000-4000-8000-000000000001';
const bob = '60000000-0000-4000-8000-000000000002';
const meta = { tags: ['bfs'], needsReview: false, reviewBy: null };
const body = (text: string) => JSON.stringify({ format: 'code-visualizer-workspace', text });

type SyncResult = {
  status: string;
  head: {
    id: string;
    name: string;
    revision: number;
    meta_version: number;
    change_seq: number;
    deleted_at: string | null;
  } | null;
};

async function seedUser(db: PGlite, id: string, email: string, token: string) {
  await db.query(
    `INSERT INTO users(id,email,password_hash,created_at) VALUES ($1,$2,'legacy-hash',now())`,
    [id, email],
  );
  await db.query(
    `INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES ($1,$2,now(),now()+interval '1 day')`,
    [hash(token), id],
  );
}

async function push(
  db: PGlite,
  user: string,
  workspace: string,
  base: number,
  text: string,
  { maxWorkspaces = 10, maxBytes = 1_000_000, name = 'Two Sum' } = {},
) {
  const result = await db.query<{ result: SyncResult }>(
    'SELECT workspace_sync_push($1,$2,$3,$4,$5,$6,$7,$8) AS result',
    [user, workspace, base, name, text, JSON.stringify(meta), maxWorkspaces, maxBytes],
  );
  return result.rows[0].result;
}

const call = async (db: PGlite, sql: string, params: unknown[]) =>
  (await db.query<{ result: SyncResult }>(sql, params)).rows[0].result;
const count = async (db: PGlite, sql: string, params: unknown[] = []) =>
  (await db.query(sql, params)).rows.length;

describe('workspace sync migration', () => {
  const db = new PGlite();
  beforeAll(async () => {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
    for (const name of [
      '0001_app_schema.sql',
      '0004_account_controls.sql',
      '0005_workspace_sync.sql',
    ])
      await db.exec(migration(name));
    await seedUser(db, alice, 'alice@example.com', 'a');
    await seedUser(db, bob, 'bob@example.com', 'b');
  }, 20_000);
  afterAll(() => db.close());

  it('stores contiguous revisions and treats an identical re-push as a duplicate', async () => {
    const first = await push(db, alice, 'ws-1', 0, body('one'));
    expect(first).toMatchObject({ status: 'stored', head: { id: 'ws-1', revision: 1 } });
    expect(first.head).not.toHaveProperty('user_id');
    const second = await push(db, alice, 'ws-1', 1, body('two'));
    expect(second).toMatchObject({ status: 'stored', head: { revision: 2 } });
    expect(second.head!.change_seq).toBeGreaterThan(first.head!.change_seq);

    // The acknowledgement for revision 2 was lost; the retry changes nothing.
    const retry = await push(db, alice, 'ws-1', 1, body('two'));
    expect(retry).toMatchObject({ status: 'duplicate', head: { revision: 2 } });
    expect(retry.head!.change_seq).toBe(second.head!.change_seq);
    expect(
      await count(db, 'SELECT 1 FROM synced_workspace_revisions WHERE workspace_id=$1', ['ws-1']),
    ).toBe(2);
  });

  it('reports a conflict instead of overwriting when the head has moved', async () => {
    const other = await push(db, alice, 'ws-1', 1, body('two from another device'));
    expect(other).toMatchObject({ status: 'conflict', head: { revision: 2 } });
    const stale = await push(db, alice, 'ws-1', 0, body('one again, edited'));
    expect(stale).toMatchObject({ status: 'conflict', head: { revision: 2 } });
    const stored = await db.query<{ body: string }>(
      'SELECT body FROM synced_workspace_revisions WHERE workspace_id=$1 AND revision=2',
      ['ws-1'],
    );
    expect(stored.rows[0].body).toBe(body('two'));
    await expect(push(db, alice, 'ws-1', -1, body('x'))).rejects.toThrow('invalid_revision');
  });

  it('keeps each account’s workspaces separate, even with the same workspace ID', async () => {
    expect(await push(db, bob, 'ws-1', 0, body('bob'))).toMatchObject({
      status: 'stored',
      head: { revision: 1 },
    });
    expect(
      (
        await db.query<{ user_id: string; revision: number }>(
          'SELECT user_id, revision FROM synced_workspaces WHERE id=$1 ORDER BY revision',
          ['ws-1'],
        )
      ).rows,
    ).toEqual([
      { user_id: bob, revision: 1 },
      { user_id: alice, revision: 2 },
    ]);
  });

  it('versions metadata separately and accepts a retried update once', async () => {
    const next = { ...meta, needsReview: true };
    const update = (version: number, value: unknown) =>
      call(db, 'SELECT workspace_sync_meta($1,$2,$3,$4) AS result', [
        alice,
        'ws-1',
        version,
        JSON.stringify(value),
      ]);
    expect(await update(0, next)).toMatchObject({ status: 'stored', head: { meta_version: 1 } });
    expect(await update(0, next)).toMatchObject({ status: 'duplicate', head: { meta_version: 1 } });
    expect(await update(0, meta)).toMatchObject({ status: 'conflict', head: { meta_version: 1 } });
    expect(
      await call(db, 'SELECT workspace_sync_meta($1,$2,$3,$4) AS result', [
        alice,
        'nope',
        0,
        JSON.stringify(meta),
      ]),
    ).toMatchObject({ status: 'missing', head: null });
  });

  it('tombstones a removed workspace and only lets a fresh upload revive it', async () => {
    await push(db, alice, 'ws-gone', 0, body('secret'));
    const removed = await call(db, 'SELECT workspace_sync_delete($1,$2) AS result', [
      alice,
      'ws-gone',
    ]);
    expect(removed).toMatchObject({
      status: 'stored',
      head: { name: 'Removed workspace', deleted_at: expect.any(String) },
    });
    expect(
      await count(db, 'SELECT 1 FROM synced_workspace_revisions WHERE workspace_id=$1', [
        'ws-gone',
      ]),
    ).toBe(0);
    expect(
      await call(db, 'SELECT workspace_sync_delete($1,$2) AS result', [alice, 'ws-gone']),
    ).toMatchObject({ status: 'duplicate' });
    // A device still holding revision 1 learns about the removal instead of re-uploading.
    expect(await push(db, alice, 'ws-gone', 1, body('late edit'))).toMatchObject({
      status: 'deleted',
    });
    expect(await push(db, alice, 'never-uploaded', 3, body('x'))).toMatchObject({
      status: 'missing',
      head: null,
    });
    const revived = await push(db, alice, 'ws-gone', 0, body('back'));
    expect(revived).toMatchObject({ status: 'stored', head: { revision: 1, deleted_at: null } });
  });

  it('bounds workspaces and bytes per account, and revision size', async () => {
    const carol = '60000000-0000-4000-8000-000000000003';
    await seedUser(db, carol, 'carol@example.com', 'c');
    expect(await push(db, carol, 'c-1', 0, body('1'), { maxWorkspaces: 1 })).toMatchObject({
      status: 'stored',
    });
    expect(await push(db, carol, 'c-2', 0, body('2'), { maxWorkspaces: 1 })).toMatchObject({
      status: 'quota',
    });
    expect(await push(db, carol, 'c-1', 1, 'x'.repeat(200), { maxBytes: 100 })).toMatchObject({
      status: 'quota',
    });
    await expect(
      push(db, carol, 'c-1', 1, 'x'.repeat(2_097_153), { maxBytes: 10_000_000 }),
    ).rejects.toThrow();
    await expect(push(db, carol, 'bad id!', 0, body('1'))).rejects.toThrow();
  });

  it('exports the latest revision of live workspaces within a byte budget', async () => {
    await push(db, alice, 'ws-2', 0, body('newest'));
    const rows = await db.query<{ id: string; revision: number; body: string | null }>(
      'SELECT id, revision, body FROM workspace_sync_export($1, 10, $2)',
      [alice, body('newest').length],
    );
    expect(rows.rows).toEqual([
      { id: 'ws-2', revision: 1, body: body('newest') },
      { id: 'ws-gone', revision: 1, body: null },
      { id: 'ws-1', revision: 2, body: null },
    ]);
  });

  it('deletes synced workspaces with the account and leaves other users alone', async () => {
    await db.query('SELECT * FROM delete_account($1, $2, NULL)', [alice, hash('a')]);
    expect(await count(db, 'SELECT 1 FROM synced_workspaces WHERE user_id=$1', [alice])).toBe(0);
    expect(
      await count(db, 'SELECT 1 FROM synced_workspace_revisions WHERE user_id=$1', [alice]),
    ).toBe(0);
    expect(await count(db, 'SELECT 1 FROM synced_workspaces WHERE user_id=$1', [bob])).toBe(1);
    await expect(push(db, alice, 'ws-1', 0, body('after delete'))).rejects.toThrow(
      'account_missing',
    );
  });

  it('can be applied twice and keeps tables and functions away from browser roles', async () => {
    await db.exec(migration('0005_workspace_sync.sql'));
    const functions = [
      'public.workspace_sync_push(uuid,text,integer,text,text,jsonb,integer,bigint)',
      'public.workspace_sync_meta(uuid,text,integer,jsonb)',
      'public.workspace_sync_delete(uuid,text)',
      'public.workspace_sync_export(uuid,integer,bigint)',
      'public.delete_account(uuid,text,uuid)',
    ];
    for (const fn of functions) {
      const rights = await db.query<{ role: string; allowed: boolean }>(
        `SELECT r AS role, has_function_privilege(r, $1, 'EXECUTE') AS allowed
         FROM unnest(ARRAY['anon','authenticated','service_role']) AS r`,
        [fn],
      );
      expect(rights.rows).toEqual([
        { role: 'anon', allowed: false },
        { role: 'authenticated', allowed: false },
        { role: 'service_role', allowed: true },
      ]);
    }
    const tables = await db.query<{ table: string; role: string; allowed: boolean; rls: boolean }>(
      `SELECT t AS table, r AS role, has_table_privilege(r, 'public.' || t, 'SELECT') AS allowed,
         (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) AS rls
       FROM unnest(ARRAY['synced_workspaces','synced_workspace_revisions']) AS t,
         unnest(ARRAY['anon','authenticated']) AS r`,
    );
    expect(tables.rows.every((row) => !row.allowed && row.rls)).toBe(true);
  });
});

// 0005 replaces delete_account; the managed-account proof from 0004 must survive.
describe('workspace sync migration with managed auth', () => {
  const db = new PGlite();
  const subject = '10000000-0000-4000-8000-000000000019';
  let managed = '';
  beforeAll(async () => {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz, banned_until timestamptz, deleted_at timestamptz);
      CREATE TABLE auth.mfa_factors (id uuid PRIMARY KEY, user_id uuid, status text);`);
    for (const name of [
      '0001_app_schema.sql',
      '0002_managed_auth.sql',
      '0003_explainer_quota.sql',
      '0004_account_controls.sql',
      '0005_workspace_sync.sql',
    ]) {
      await db.exec(migration(name));
    }
    await db.query(
      `INSERT INTO auth.users(id,email,email_confirmed_at) VALUES ($1,'managed@example.com',now())`,
      [subject],
    );
    const created = await db.query<{ id: string }>(
      'SELECT * FROM complete_managed_auth($1, $2, NULL, $3)',
      [subject, 'managed@example.com', hash('m')],
    );
    managed = created.rows[0].id;
    await push(db, managed, 'managed-ws', 0, body('managed'));
  }, 20_000);
  afterAll(() => db.close());

  it('still requires the verified provider identity before removing synced workspaces', async () => {
    await expect(
      db.query('SELECT * FROM delete_account($1, $2, NULL)', [managed, hash('m')]),
    ).rejects.toThrow('reauthentication_required');
    expect(await count(db, 'SELECT 1 FROM synced_workspaces WHERE user_id=$1', [managed])).toBe(1);
    await db.query('SELECT * FROM delete_account($1, $2, $3)', [managed, hash('m'), subject]);
    expect(await count(db, 'SELECT 1 FROM synced_workspaces WHERE user_id=$1', [managed])).toBe(0);
    expect(await count(db, 'SELECT 1 FROM users WHERE id=$1', [managed])).toBe(0);
  });
});
