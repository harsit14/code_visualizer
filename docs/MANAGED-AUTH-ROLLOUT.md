# Verified email sign-in and safe account linking

Implemented locally, disabled until `MANAGED_AUTH_ENABLED=true`. No real accounts,
email templates, live database or deployments were changed. This migration uses
Supabase email OTP verification; Code Visualizer continues issuing its own opaque
HttpOnly session cookie. Provider access and refresh tokens are discarded on the
server and never reach app JavaScript, URLs, localStorage or the code runner.

## User flows

- **New account or managed sign-in:** Account → enter email → Send email code →
  enter the code → Verify and sign in. Invalid/expired codes can be retried or
  resent, and the destination can be changed before a new request.
- **Existing password account:** Use existing password → sign in → Enable email
  sign-in → request and enter a code → Verify and link account. The confirmation
  explains that linking disables the old password and signs out other sessions.
  The password sign-in must be less than ten minutes old when linking completes.
- **Recovery:** a linked user requests a fresh email code; no password reset is
  needed. Email ownership alone cannot recover an unlinked legacy account. If
  legacy password proof is unavailable, the owner must independently establish
  ownership through an assisted recovery process. Do not manually merge by email.
- **Conflicts:** conflicting provider/account mappings and deleted/recreated
  provider identities require operator review. They do not replace account IDs.
  Provider MFA identities are rejected because this app has no MFA challenge UI;
  do not disable MFA to bypass that requirement.

## Local implementation guarantees

`0002_managed_auth.sql` adds a one-to-one mapping from Supabase identity ID to the
existing internal account ID. An atomic database function checks active verified
provider ownership and, for linking, the fresh legacy session proof. It creates
the mapping, disables password login, revokes old sessions and issues the new
session in one transaction. A session-insert trigger locks the account and blocks
a legacy login that races with linking. Existing history, quota ownership and
provisioned admin IDs retain their original account ID.

Managed session lookups join the provider identity on every account/history/AI
request. Expiry, removed identity mappings, provider bans, deletion, email mismatch
or verified MFA factors deny access. App logout deletes the current app session;
Supabase logout alone does not revoke these separate app sessions. To revoke all
app sessions, delete the rows for the independently verified internal user ID.
Never roll back to code that omits the managed-session lookup or session guard.

Every managed auth request uses database-backed IP and normalized-email counters.
Keys are HMACs using the service credential, so limiter records do not contain
raw emails or IP addresses. Each operation/target allows five attempts per minute;
limits are shared across Worker instances and remain in force when one instance
restarts. An unavailable limiter returns 503 instead of falling back to memory.
The edge IP header is authoritative; absent metadata shares an `unknown` bucket.
Rate limiting is not a complete bot mitigation or email-delivery cost cap.

Legacy-only deployments can opt into the same limiter with
`AUTH_RATE_LIMIT_MODE=database` after applying the migration. Otherwise they retain
the previous process-local limiter. Rotating the service credential changes the
hashed keys, effectively starting new windows.

## Staging setup

1. Back up account IDs, identity mappings, sessions and history. Use a synthetic
   staging Supabase project with the existing `0001_app_schema.sql` applied.
2. Apply `supabase/migrations/0002_managed_auth.sql` once, in order. It is
   transactional and targets the `public` application schema plus Supabase's
   existing `auth.users` and `auth.mfa_factors` tables. Custom application schemas
   require an explicitly adapted migration; do not just change `SUPABASE_SCHEMA`.
3. Configure email OTP delivery and production-appropriate SMTP. Email templates
   must include `{{ .Token }}` so users receive a code to enter, rather than relying
   on a magic-link callback. Verify the email provider's expiry, resend, global
   rate limits and sender delivery settings. No callback token route is used.
   [Supabase email OTP setup](https://supabase.com/docs/guides/auth/auth-email-passwordless)
   and [email templates](https://supabase.com/docs/guides/auth/auth-email-templates).
4. Configure Worker secrets/settings: existing `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY`, plus the project's `SUPABASE_ANON_KEY` for the
   provider OTP endpoints. Keep `PASSWORD_PEPPER` for legacy account linking.
   Set `MANAGED_AUTH_ENABLED=true` only after the staging schema and delivery are
   ready. Do not put service credentials in `VITE_*` variables or runner bindings.
5. Confirm `/api/me` reports `authMode: "email-code"`; managed mode rejects new
   legacy password signup. Existing password login remains solely as a migration
   path. Missing configuration, provider failures and database failures produce
   visible errors without leaking provider responses or database diagnostics.
6. Schedule maintenance through the deployment's database tooling: periodically
   delete expired sessions and `auth_rate_limits` rows whose `reset_at` is older
   than a day. The reset index supports cleanup; counters do not self-delete.
   Measure volume and use bounded batches for a large installation.

## Required staging acceptance

- Deliver a code to a test mailbox; test resend, expiry, replay and wrong codes.
- Link an existing synthetic account with saved history and an admin ID; verify
  the ID and data remain, old sessions stop working and the old password fails.
- Verify a matching email without legacy proof cannot read that legacy history.
- Race password login with linking, and duplicate linking with two real database
  connections; confirm no extra legacy session or duplicate mapping survives.
- Test an expired ten-minute proof, conflicting identities, provider bans,
  deletion, email change, MFA enrollment and app-session revocation.
- Exercise limits from multiple Worker instances and verify fail-closed behavior
  during database/provider outages. Observe generic responses before ownership is
  proven. Review SMTP/bot protections before public rollout.
- Inspect actual cookie and origin headers on the deployed app and runner.
- Test Safari/Firefox and real mobile keyboards; local Chromium emulation alone
  does not establish those behaviors.

Local automated checks execute the actual SQL in embedded PostgreSQL with
synthetic provider tables, and cover API proof validation, cookie/token handling,
provider errors, identity conflicts and UI recovery. This does not validate the
hosted Supabase schema/version, SMTP delivery, concurrent production connections,
Cloudflare bindings or real customer accounts.

## Rollback

Keep managed mappings, the session guard and managed-session validation. Do not
restore passwords for linked users or revert to unverified email-based ownership.
A deployment rollback must retain email-code sign-in for already linked accounts,
or visibly pause their login until a compatible version is restored. Disabling
new signup or pausing migration is safer than downgrading migrated accounts.
Source rollback is not a database rollback: retain backups and reconcile IDs
before any operator-led data repair.
