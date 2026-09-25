import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const migration = (name: string) =>
  readFileSync(`supabase/migrations/${name}`, 'utf8').replace(
    'CREATE EXTENSION IF NOT EXISTS pgcrypto;',
    '',
  );
const hash = (value: string) => value.repeat(64);
const alice = '30000000-0000-4000-8000-000000000001';
const bob = '30000000-0000-4000-8000-000000000002';
const key = '40000000-0000-4000-8000-000000000001';

async function seedUser(db: PGlite, id: string, email: string, token: string) {
  await db.query(
    `INSERT INTO users(id,email,password_hash,created_at) VALUES ($1,$2,'legacy-hash',now())`,
    [id, email],
  );
  await db.query(
    `INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES ($1,$2,now(),now()+interval '1 day')`,
    [hash(token), id],
  );
  await db.query(
    `INSERT INTO code_history(id,user_id,title,language,code,created_at,updated_at,last_run_at) VALUES ($1,$2,'Saved','python','print(1)',now(),now(),now())`,
    [`history-${token}`, id],
  );
  await db.query(`SELECT * FROM increment_usage_daily($1, '2026-09-25', 'free', now())`, [
    `user:${id}`,
  ]);
}

async function saveWithKey(db: PGlite, id: string, owner: string, idempotencyKey: string | null) {
  return db.query<{ id: string }>(
    `INSERT INTO code_history(id,user_id,title,language,code,created_at,updated_at,last_run_at,idempotency_key)
     VALUES ($1,$2,'Saved','python','print(2)',now(),now(),now(),$3)
     ON CONFLICT (user_id, idempotency_key) DO NOTHING RETURNING id`,
    [id, owner, idempotencyKey],
  );
}

const count = async (db: PGlite, sql: string, params: unknown[] = []) =>
  (await db.query(sql, params)).rows.length;

// 0004 must stand alone on 0001, because 0002 and 0003 are optional rollouts.
describe('account controls migration without managed auth', () => {
  const db = new PGlite();
  beforeAll(async () => {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
    await db.exec(migration('0001_app_schema.sql'));
    await db.exec(migration('0004_account_controls.sql'));
    await seedUser(db, alice, 'alice@example.com', 'a');
    await seedUser(db, bob, 'bob@example.com', 'b');
  }, 20_000);
  afterAll(() => db.close());

  it('returns the stored entry for a replayed key and scopes keys to their owner', async () => {
    expect((await saveWithKey(db, 'first-save', alice, key)).rows).toHaveLength(1);
    expect((await saveWithKey(db, 'retry-save', alice, key)).rows).toHaveLength(0);
    expect(
      (
        await db.query<{ id: string }>(
          'SELECT id FROM code_history WHERE user_id=$1 AND idempotency_key=$2',
          [alice, key],
        )
      ).rows,
    ).toEqual([{ id: 'first-save' }]);
    expect((await saveWithKey(db, 'bob-save', bob, key)).rows).toHaveLength(1);
    expect((await saveWithKey(db, 'no-key-1', alice, null)).rows).toHaveLength(1);
    expect((await saveWithKey(db, 'no-key-2', alice, null)).rows).toHaveLength(1);
  });

  it('stores only a short device label and a last-used time on sessions', async () => {
    await db.query(
      `UPDATE sessions SET device_label='Firefox on Windows', last_used_at=now() WHERE token_hash=$1`,
      [hash('a')],
    );
    await expect(
      db.query('UPDATE sessions SET device_label=$1 WHERE token_hash=$2', [
        'x'.repeat(65),
        hash('a'),
      ]),
    ).rejects.toThrow();
  });

  it('refuses revoked, expired or another user’s session and deletes nothing', async () => {
    const remove = (userId: string, token: string) =>
      db.query('SELECT * FROM delete_account($1, $2, NULL)', [userId, token]);
    await expect(remove(alice, hash('z'))).rejects.toThrow('session_required');
    await expect(remove(alice, hash('b'))).rejects.toThrow('session_required');
    await db.query(
      `INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES ($1,$2,now()-interval '2 days',now()-interval '1 day')`,
      [hash('e'), alice],
    );
    await expect(remove(alice, hash('e'))).rejects.toThrow('session_required');
    expect(await count(db, 'SELECT 1 FROM users WHERE id=$1', [alice])).toBe(1);
    expect(await count(db, 'SELECT 1 FROM code_history WHERE user_id=$1', [alice])).toBe(4);
  });

  it('deletes one user’s usage, history, sessions and account atomically', async () => {
    await db.query(
      `INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES ($1,$2,now(),now()+interval '1 day')`,
      [hash('c'), alice],
    );
    const result = await db.query<Record<string, number>>(
      'SELECT * FROM delete_account($1, $2, NULL)',
      [alice, hash('a')],
    );
    expect(result.rows[0]).toEqual({ history_deleted: 4, sessions_deleted: 3, usage_deleted: 1 });
    expect(await count(db, 'SELECT 1 FROM users WHERE id=$1', [alice])).toBe(0);
    expect(await count(db, 'SELECT 1 FROM sessions WHERE user_id=$1', [alice])).toBe(0);
    expect(await count(db, 'SELECT 1 FROM code_history WHERE user_id=$1', [alice])).toBe(0);
    expect(await count(db, 'SELECT 1 FROM usage_daily WHERE subject=$1', [`user:${alice}`])).toBe(
      0,
    );
    expect(await count(db, 'SELECT 1 FROM users WHERE id=$1', [bob])).toBe(1);
    expect(await count(db, 'SELECT 1 FROM sessions WHERE user_id=$1', [bob])).toBe(1);
    expect(await count(db, 'SELECT 1 FROM code_history WHERE user_id=$1', [bob])).toBe(2);
    expect(await count(db, 'SELECT 1 FROM usage_daily WHERE subject=$1', [`user:${bob}`])).toBe(1);
  });

  it('can be applied twice and keeps deletion away from browser roles', async () => {
    await db.exec(migration('0004_account_controls.sql'));
    const rights = await db.query<{ role: string; allowed: boolean }>(
      `SELECT r AS role, has_function_privilege(r, 'public.delete_account(uuid,text,uuid)', 'EXECUTE') AS allowed
       FROM unnest(ARRAY['anon','authenticated','service_role']) AS r`,
    );
    expect(rights.rows).toEqual([
      { role: 'anon', allowed: false },
      { role: 'authenticated', allowed: false },
      { role: 'service_role', allowed: true },
    ]);
  });
});

describe('account controls migration with managed auth', () => {
  const db = new PGlite();
  const subject = '10000000-0000-4000-8000-000000000009';
  let managed = '';
  beforeAll(async () => {
    // Synthetic provider tables, as in managedAuthMigration.test.ts.
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz, banned_until timestamptz, deleted_at timestamptz);
      CREATE TABLE auth.mfa_factors (id uuid PRIMARY KEY, user_id uuid, status text);`);
    for (const name of [
      '0001_app_schema.sql',
      '0002_managed_auth.sql',
      '0003_explainer_quota.sql',
      '0004_account_controls.sql',
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
  }, 20_000);
  afterAll(() => db.close());

  it('lets the Worker record session details on managed sessions', async () => {
    await db.query(
      `UPDATE sessions SET device_label='Safari on iPhone', last_used_at=now() WHERE token_hash=$1`,
      [hash('m')],
    );
    expect(
      (await db.query('SELECT * FROM managed_session_user($1)', [hash('m')])).rows,
    ).toHaveLength(1);
  });

  it('requires the provider identity verified by a fresh email code', async () => {
    const other = '10000000-0000-4000-8000-000000000010';
    await expect(
      db.query('SELECT * FROM delete_account($1, $2, NULL)', [managed, hash('m')]),
    ).rejects.toThrow('reauthentication_required');
    await expect(
      db.query('SELECT * FROM delete_account($1, $2, $3)', [managed, hash('m'), other]),
    ).rejects.toThrow('reauthentication_required');
    await db.query('SELECT * FROM delete_account($1, $2, $3)', [managed, hash('m'), subject]);
    expect(await count(db, 'SELECT 1 FROM users WHERE id=$1', [managed])).toBe(0);
    expect(
      await count(db, 'SELECT 1 FROM account_identities WHERE app_user_id=$1', [managed]),
    ).toBe(0);
    expect(await count(db, 'SELECT 1 FROM managed_session_user($1)', [hash('m')])).toBe(0);
  });
});
