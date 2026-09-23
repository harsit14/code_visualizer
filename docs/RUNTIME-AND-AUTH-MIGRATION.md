# Runtime isolation and account migration

Status: design for staged implementation, 23 September 2026. The current application still executes code in same-origin workers and still uses its existing account system. Neither boundary is certified by the recovery work below.

## Implemented prerequisite: runtime recovery

The transport now has explicit Stop and Retry runtime actions. Python startup has a 45-second deadline, separate from the execution deadline (15 seconds for runs and case requests; 30 seconds for complexity). Warm requests receive a deadline immediately, even if the worker never emits a running status. Timeout attempts a shared-buffer interrupt when available and terminates after a 1.5-second grace period; explicit Stop always terminates immediately. Responses after a timeout remain timeout failures, including an interrupted response during that grace period.

Stop preserves source, case inputs, completed case verdicts and any existing replay, but discards unfinished execution. A stopped batch does not start its next case. Python's interpreter state is recreated on the next run. JavaScript/TypeScript workers receive an AbortSignal and are terminated on Stop. Retry runtime reloads Python and analyzes the current source; it does not execute the program. Failed prewarming is reported rather than leaving an unhandled rejection or an indefinitely busy interface. Old worker callbacks cannot update a replacement worker's session, and disposal rejects pending promises.

These are lifecycle guarantees, not isolation from malicious user code. An untrusted worker remains capable of sending dishonest but well-formed data. Trace payloads must never confer account privileges or authorize host actions.

Validation: `npm run ci` passes typecheck, lint, 218 frontend/server tests, build
and static packaging smoke. Local browser checks stopped a sleeping Python
program and an infinite JavaScript loop, retained their source, then successfully
ran fresh Python and JS programs. Startup failure, explicit retry, stopped batches,
late callbacks, shared-buffer fallback and disposal are covered by automated tests;
real network outages and the production browser matrix remain staging checks.

## Execution boundary

Use an independently deployed, credential-free runner origin, preferably on a separate registrable domain. A sibling subdomain alone does not make requests cross-site for SameSite cookies. Never put account, usage, billing or history routes on the runner deployment, and never send account tokens, session cookies, service keys, user identifiers or browser storage into its messages.

The app embeds a small runner bootstrap document. That document creates the Python or JS worker on the runner's own origin. This avoids assuming that a cross-origin Worker URL can replace the existing local constructor without changes. Keep the iframe sandbox limited to the capabilities required for script/worker execution; no forms, popups, top navigation or downloads. The runner should have no reusable service worker registration or user accounts. Source code stays in an in-memory message payload rather than URLs, request logs or persistent runner storage.

The bootstrap accepts a single initialization handshake only from the configured app origin and expected parent window. Use a fresh nonce and transferred MessageChannel per frame generation. All subsequent messages travel through that channel. Destroy the frame, ports and workers on Stop, timeout, reload or navigation; revoke the old generation. IDs and nonces correlate requests, but do not make worker-provided state trustworthy.

Protocol proposal:

| Envelope               | Required fields                                                       | Permitted effect in host         |
| ---------------------- | --------------------------------------------------------------------- | -------------------------------- |
| Initialize             | version, generation, nonce, exact app origin                          | Establish one channel            |
| Analyze/run/complexity | version, generation, request ID, language, bounded source and options | Submit one operation             |
| Status                 | version, generation, request ID, known phase, bounded message         | Update progress only             |
| Result/error           | version, generation, request ID, validated bounded payload            | Display a trace or error only    |
| Cancel/dispose         | version, generation, request ID                                       | Terminate the matching execution |

Validate envelope version, direction, operation, generation, IDs, field types, aggregate size, nesting, array counts and allowed enums before any UI update. Reuse the import schema's encoded-value validation in an engine-neutral module; also define analysis and complexity validators. Unsupported protocol versions fail visibly. No incoming message can invoke fetch, account APIs, clipboard, storage, navigation or downloads on the app's behalf. Export remains an explicit host UI action on validated data.

### Headers and network policy

Deliver CSP on both the runner document and the worker script responses. Worker CSP is not generally inherited from its creating document; MDN specifically requires the policy on the worker-script response. [MDN worker CSP](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#content_security_policy).

Split bootstrap and execution policies. Python needs its self-hosted Pyodide/WASM/package assets; JS needs the current evaluator until the AST migration. Permit only measured requirements. Deny nested workers, service workers, unneeded imports, forms and frames from the execution context. Test requests to app APIs, redirects, WebSockets and further execution contexts rather than treating a document header or deleting `fetch` as sufficient. The app's CSP should permit the runner only where needed and remove evaluator permissions from the app deployment once migration permits it.

Keep app session cookies host-only, Secure and HttpOnly. Server account/history/AI endpoints must reject untrusted browser origins and cross-site requests before session lookup, including read endpoints. CORS alone does not prevent a state-changing request from being sent. Verify actual cookies and response headers on both deployed origins. Preserve termination when cross-origin isolation prevents SharedArrayBuffer; it must not be required for Stop.

### Isolation acceptance matrix

Both JS and Python-through-JS-interop probes must fail to read or change app history, use authenticated AI quota, access app local storage, reach parent DOM or navigate the app. Include nested workers, blob scripts, redirects, malformed/oversized messages, duplicate IDs, forged status/results and messages from old generations. Benign programs must still complete a cold Python boot, stepping, case batches, export/import, Stop and recovery. Run in Chromium, Firefox and Safari against staging's actual delivered headers, with and without SharedArrayBuffer. Do not enable the isolated runner in production until these checks pass.

## Managed authentication migration

Use the existing Supabase platform for the next auth implementation, while retaining the application's stable internal user IDs. Current `public.users` records are application accounts; they are not already Supabase `auth.users` identities. Supabase's project-to-project auth export instructions do not migrate this custom HMAC password format. Its Auth0 migration documentation describes bcrypt/Argon2 hash support; do not pass our HMAC hashes as though they were compatible. [Supabase migration formats](https://supabase.com/docs/guides/platform/migrating-to-supabase/auth0).

Proposed identity mapping: `account_identities(provider, provider_subject, app_user_id, linked_at)`, with unique provider/subject and a unique Supabase identity per app user. Existing history, usage, subscriptions and provisioned admin IDs continue to reference the original app user ID. Only the server can create or change mappings. Neither email text nor client metadata can choose an existing user ID.

### Enrollment and linking

1. New users complete managed email verification before gaining a managed app session. Create an app user and mapping only after verified provider identity validation. Recovery and new password storage belong to the managed provider.
2. Existing users must prove control of their existing account through a valid authenticated session or legacy password, and separately prove the managed identity's verified email ownership. Link both proofs in one short-lived server-side migration transaction, protected against replay and conflicting links. Require explicit confirmation of linking in the account UI.
3. Verified email alone must never claim a legacy account: current signup did not verify email, so a legacy email string is not ownership evidence. Ambiguous/conflicting accounts require an operator-reviewed recovery path. Never expose another account's history merely because an address matches.
4. Users unable to prove legacy account control can create a fresh managed account. Merging old history requires separately established ownership; ordinary provider password recovery must not silently merge it.
5. Once linked, disable legacy password login for that app user and revoke its legacy sessions atomically. Existing provider sessions also need server-side revocation/epoch checks if immediate app access removal is required. Supabase documents that an issued access token can remain usable until expiry after some account operations. [Supabase user management](https://supabase.com/docs/guides/auth/managing-user-data).

Keep the browser-to-app session HttpOnly; keep provider refresh material on the server and out of execution messages. Validate provider token issuer, audience, signature, expiry and verified identity using supported provider APIs. Avoid building another custom password algorithm to accommodate a free Worker CPU budget.

### Throttling and operational requirements

Replace the instance-local Map as the enforcement boundary with a durable atomic limiter. Rate-limit IP and account targets without disclosing whether an email exists; bound body sizes before expensive credential/provider work. Define quotas, reset semantics, unavailable-store behavior and monitoring. Log request IDs and failure categories without credentials, source, tokens, full emails or trace locals.

Before implementation cutover, identify the staging Supabase project, provider email/redirect settings, sender delivery setup, runner origin and app origin. Keep these as operator-supplied deployment values; none were provisioned in this task. Local code and migration SQL can be reviewed before any live schema/account changes.

## Delivery and rollback

1. **This batch:** lifecycle recovery and this design, with unit tests and local browser verification.
2. Extract shared protocol validators; add a separate runner build/deployment and iframe bridge behind an explicit configured origin. Fail closed for a broken configured runner, without silently falling back to same-origin execution.
3. Add server origin checks, delivered-header tests and adversarial staging probes. Demonstrate the isolation acceptance matrix before switching production execution.
4. Add managed auth adapter, identity-link schema, verification/recovery UI and durable throttling. Test conflicts, replay, cross-account history access, expired proofs and rollback with synthetic accounts.
5. Pilot opt-in migration, reconcile account/history counts by stable ID, then disable new legacy signup. Complete a tested session-revocation and rollout plan before wider migration.

Do not deploy schema changes or migrate live identities as part of a source-only commit. Retain a tested database backup and audit trail before cutover. Roll back runner versions without enabling a silent same-origin fallback; disable execution visibly if required. Do not re-enable weak legacy login for already migrated accounts on an application rollback. Preserve identity mappings and stable ownership IDs throughout rollback.
