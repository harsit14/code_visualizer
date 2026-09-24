import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const db = new PGlite();
beforeAll(async () => {
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  await db.exec(
    readFileSync('supabase/migrations/0001_app_schema.sql', 'utf8').replace(
      'CREATE EXTENSION IF NOT EXISTS pgcrypto;',
      '',
    ),
  );
  await db.exec(readFileSync('supabase/migrations/0003_explainer_quota.sql', 'utf8'));
}, 20_000);
afterAll(() => db.close());

const count = async () =>
  (await db.query<{ count: number }>("SELECT count FROM usage_daily WHERE subject = 'anon:x'"))
    .rows[0]?.count;

describe('explainer quota migration in PostgreSQL', () => {
  it('refunds a reservation without going below zero', async () => {
    await db.query(
      "SELECT * FROM increment_usage_daily('anon:x', '2026-09-23', 'anonymous', now())",
    );
    await db.query(
      "SELECT * FROM increment_usage_daily('anon:x', '2026-09-23', 'anonymous', now())",
    );
    await db.query("SELECT refund_usage_daily('anon:x', '2026-09-23')");
    expect(await count()).toBe(1);
    await db.query("SELECT refund_usage_daily('anon:x', '2026-09-23')");
    await db.query("SELECT refund_usage_daily('anon:x', '2026-09-23')");
    expect(await count()).toBe(0);
    await db.query("SELECT refund_usage_daily('anon:missing', '2026-09-23')");
  });

  it('caches answers by a hex SHA-256 context hash only', async () => {
    const hash = 'a'.repeat(64);
    await db.query('INSERT INTO explain_cache(context_hash, model, answer) VALUES ($1, $2, $3)', [
      hash,
      'model',
      'answer',
    ]);
    expect((await db.query('SELECT answer FROM explain_cache')).rows).toEqual([
      { answer: 'answer' },
    ]);
    await expect(
      db.query("INSERT INTO explain_cache(context_hash, model, answer) VALUES ('short', 'm', 'a')"),
    ).rejects.toThrow();
  });

  it('keeps the new objects away from public roles', async () => {
    const grants = await db.query<{ grantee: string }>(
      "SELECT grantee FROM information_schema.role_table_grants WHERE table_name = 'explain_cache'",
    );
    expect(grants.rows.map((row) => row.grantee)).not.toContain('anon');
    expect(grants.rows.map((row) => row.grantee)).toContain('service_role');
  });
});
