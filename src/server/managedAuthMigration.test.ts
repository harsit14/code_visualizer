import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

// Run the actual migration against embedded PostgreSQL. Provider tables below are
// a synthetic fixture, not a substitute for testing the live Supabase version.
const db = new PGlite();
const subject = '10000000-0000-4000-8000-000000000001';
const legacy = '20000000-0000-4000-8000-000000000001';
const hash = (value: string) => value.repeat(64);
beforeAll(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz, banned_until timestamptz, deleted_at timestamptz);
    CREATE TABLE auth.mfa_factors (id uuid PRIMARY KEY, user_id uuid, status text);`);
  // gen_random_uuid is built into PostgreSQL; PGlite does not need pgcrypto here.
  await db.exec(
    readFileSync('supabase/migrations/0001_app_schema.sql', 'utf8').replace(
      'CREATE EXTENSION IF NOT EXISTS pgcrypto;',
      '',
    ),
  );
  await db.exec(readFileSync('supabase/migrations/0002_managed_auth.sql', 'utf8'));
}, 20_000);
afterAll(() => db.close());
async function complete(id: string, email: string, proof: string | null, newHash: string) {
  return db.query<{ id: string }>('SELECT * FROM public.complete_managed_auth($1, $2, $3, $4)', [
    id,
    email,
    proof,
    newHash,
  ]);
}
async function seed(id: string, email: string) {
  await db.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES ($1,$2,now())', [
    id,
    email,
  ]);
}
describe('managed identity migration in PostgreSQL', () => {
  it('does not give an email owner access to an unlinked legacy account', async () => {
    await seed(subject, 'legacy@example.com');
    await db.query(
      `INSERT INTO public.users(id,email,password_hash,created_at) VALUES ($1,'legacy@example.com','old-password-hash',now())`,
      [legacy],
    );
    await expect(complete(subject, 'legacy@example.com', null, hash('a'))).rejects.toThrow(
      'legacy_link_required',
    );
    expect((await db.query('SELECT * FROM account_identities')).rows).toHaveLength(0);
  });
  it('rejects an expired proof, then preserves ownership and atomically revokes old sessions', async () => {
    await db.query(
      `INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES ($1,$2,now()-interval '11 minutes',now()+interval '1 day'),($3,$2,now(),now()+interval '1 day')`,
      [hash('b'), legacy, hash('c')],
    );
    await db.query(
      `INSERT INTO code_history(id,user_id,title,language,code,created_at,updated_at,last_run_at) VALUES ('saved',$1,'My code','python','print(1)',now(),now(),now())`,
      [legacy],
    );
    await expect(complete(subject, 'legacy@example.com', hash('b'), hash('d'))).rejects.toThrow(
      'fresh_legacy_login_required',
    );
    expect((await complete(subject, 'legacy@example.com', hash('c'), hash('d'))).rows[0].id).toBe(
      legacy,
    );
    expect(
      (
        await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id=$1', [
          legacy,
        ])
      ).rows[0].password_hash,
    ).toBe('!managed:supabase');
    expect((await db.query('SELECT * FROM sessions WHERE user_id=$1', [legacy])).rows).toHaveLength(
      1,
    );
    expect(
      (await db.query('SELECT * FROM code_history WHERE user_id=$1', [legacy])).rows,
    ).toHaveLength(1);
    await expect(complete(subject, 'legacy@example.com', hash('c'), hash('e'))).rejects.toThrow(
      'fresh_legacy_login_required',
    );
  });
  it('rejects a late legacy login after linking and denies a banned identity on existing sessions', async () => {
    await expect(
      db.query(
        `INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES ($1,$2,now(),now()+interval '1 day')`,
        [hash('f'), legacy],
      ),
    ).rejects.toThrow('session_method_conflict');
    expect(
      (await db.query('SELECT * FROM managed_session_user($1)', [hash('d')])).rows,
    ).toHaveLength(1);
    await db.query("UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=$1", [
      subject,
    ]);
    expect(
      (await db.query('SELECT * FROM managed_session_user($1)', [hash('d')])).rows,
    ).toHaveLength(0);
    await expect(complete(subject, 'legacy@example.com', null, hash('g'))).rejects.toThrow(
      'invalid_identity',
    );
    await db.query('UPDATE auth.users SET banned_until=null WHERE id=$1', [subject]);
  });
  it('creates a fresh app identity and never changes its ID on subsequent sign-in', async () => {
    const fresh = '10000000-0000-4000-8000-000000000002';
    await seed(fresh, 'new@example.com');
    const first = await complete(fresh, 'new@example.com', null, hash('h'));
    const second = await complete(fresh, 'new@example.com', null, hash('i'));
    expect(first.rows[0].id).toBe(second.rows[0].id);
    expect(first.rows[0].id).not.toBe(fresh);
    await db.query('DELETE FROM auth.users WHERE id=$1', [fresh]);
    expect(
      (await db.query('SELECT * FROM managed_session_user($1)', [hash('h')])).rows,
    ).toHaveLength(0);
  });
  it('cannot link an already-mapped identity to another account', async () => {
    const other = '20000000-0000-4000-8000-000000000003';
    await db.query(
      `INSERT INTO users(id,email,password_hash,created_at) VALUES ($1,'other@example.com','legacy',now())`,
      [other],
    );
    await db.query(
      `INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES ($1,$2,now(),now()+interval '1 day')`,
      [hash('j'), other],
    );
    await expect(complete(subject, 'legacy@example.com', hash('j'), hash('k'))).rejects.toThrow(
      'fresh_legacy_login_required',
    );
    expect(
      (
        await db.query<{ app_user_id: string }>(
          'SELECT app_user_id FROM account_identities WHERE provider_subject=$1',
          [subject],
        )
      ).rows[0].app_user_id,
    ).toBe(legacy);
  });
  it('shares attempt counts, resets expired windows and blocks browser database roles', async () => {
    const results = await Promise.all(
      Array.from({ length: 7 }, () =>
        db.query<{ allowed: boolean }>('SELECT * FROM consume_auth_limit($1,5,60)', [hash('l')]),
      ),
    );
    expect(results.map((r) => r.rows[0].allowed)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
    await db.query(
      "UPDATE auth_rate_limits SET reset_at=now()-interval '1 second' WHERE bucket=$1",
      [hash('l')],
    );
    expect(
      (
        await db.query<{ allowed: boolean }>('SELECT * FROM consume_auth_limit($1,5,60)', [
          hash('l'),
        ])
      ).rows[0].allowed,
    ).toBe(true);
    const rights = await db.query<{ allowed: boolean }>(
      `SELECT has_function_privilege('anon', 'public.complete_managed_auth(uuid,text,text,text)', 'EXECUTE') AS allowed UNION ALL SELECT has_function_privilege('authenticated','public.consume_auth_limit(text,integer,integer)','EXECUTE')`,
    );
    expect(rights.rows.every((r) => !r.allowed)).toBe(true);
  });
});
