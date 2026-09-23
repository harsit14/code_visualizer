# Code Visualizer: product and engineering improvement plan

Reviewed 23 September 2026 against local commit `0ab6603`.

## Recommendation

Build around the app's strongest experience: understanding a short algorithm through a trustworthy, replayable trace. Fix correctness and account boundaries first, make learning and practice workflows easier to use, then add comparison and teaching tools.

The findings below describe the audited baseline. Implementation has now started with the first repair batch below. Existing untracked `design/` and `Code visualizer logo/` content was left alone. Monetary contribution features are excluded at the owner's request.

## First implementation batch

- Practice assertions now compare bounded, typed Python return values independently of display truncation. Invalid expectations and unsupported/cyclic/oversized values cannot pass. “Use actual” copies only a parseable literal and requires rerunning the case.
- JS nested object snapshots retain current contents and stable IDs across steps; cycles remain references. Ordinary object accessors are displayed without invoking them. JS null remains distinct from Python None. Trace and output limits preserve bounded partial replay.
- Python line events explicitly mean “before execution”; JS instrumented events mean “after execution.” The transport and AI context use that contract, and AI excerpts retain original line numbers near the active line. JS/TS are visibly marked experimental.
- Runs, case batches, complexity results and AI replies have context guards. Editing code, switching language/function or importing a trace invalidates old execution results; changing the selected AI snapshot aborts its request. This does not yet add a general execution-cancel control.
- Versioned trace imports validate nested replay values, frames, analysis, indices and byte/depth/item limits before replacing the session. Legacy phase/metric fields are normalized. Share payloads have type/size bounds.
- Unlimited AI quota now requires a provisioned server-side account ID. `ADMIN_EMAILS` is ignored; deployment owners must independently verify ownership before setting `ADMIN_USER_IDS`. Existing email-only admins become free-tier users until migrated.
- Hosted explanation requests use the shared prompt/sanitizer, enforce body bytes while reading, reject cross-origin browser requests and time out upstream fetches.

Still planned: isolated runtime origin, authentication/password migration, full AST-based JS/TS instrumentation, mobile workflow redesign, reliable workspace recovery, and the learning/comparison features below. The partial repairs do not close the runtime security boundary or certify public account deployment.

Batch validation: `npm run ci` passes typecheck, lint, 200 frontend/server tests in 36 files, build and production packaging smoke; `npm run test:engine` passes 136 tests. Local browser checks covered Python execution, a whitespace-sensitive failing case, adopting actual output and rerunning to pass, pre-line playback labels, successful Python trace import, malformed import preserving the current replay with a visible dismissible error, and the experimental JS worker/after-line label. Hosted AI, deployed accounts and production configuration were not exercised. The table below records the original audit baseline.

## Second batch: runtime recovery and migration design

Implemented Stop for Python startup/execution, practice batches, complexity and
JS/TS workers; explicit Retry runtime; startup/execution watchdogs; rejection of
pending promises on disposal; and protection against callbacks from replaced
workers. Source, case inputs and completed results survive Stop; unfinished work
does not produce a passing verdict. This implements recovery prerequisites while
runtime origin separation and managed auth remain outstanding.

The [runtime and auth design](RUNTIME-AND-AUTH-MIGRATION.md) specifies the dedicated
origin/message boundary, delivered-header tests, managed identity linking without
email-only account takeover, durable throttling, staged rollout and rollback.
No live configuration, schema, account or deployment was changed.

## Third batch: opt-in runtime origin separation

Implemented a dedicated runner build and Cloudflare handler, an exact-origin
iframe/MessageChannel bridge, bounded shared request/result validation, fail-closed
connection errors, termination-based cancellation, and browser-origin checks for
API reads and writes. No account bindings or API routes exist on the runner.
Deployment variables and local two-origin instructions are in
[deployment.md](deployment.md#separate-origin-runner-opt-in).

Local browser checks exercised Python startup/Two Sum, JavaScript tracing, Stop
and recovery, a blocked Python-to-app network probe and malformed worker output.
The feature remains opt-in. Deployed adversarial tests and the Safari/Firefox
matrix are still required; managed authentication and durable throttling remain
unimplemented. No live deployment was changed.

Batch validation: `npm run ci` passes typecheck, lint, 236 tests in 42 files, the
app production build/smoke and the separate runner build/smoke. Bootstrap tests
cover parent/origin checks, replayed sequences, overlapping requests and disposal.

## Fourth batch: managed accounts, phone workflow and save recovery

- Added opt-in verified email-code sign-in and explicit linking from a fresh legacy
  login. The SQL migration retains stable app IDs/history, blocks email-only
  takeover, revokes old sessions and rejects legacy logins racing with linking.
- Added shared database-backed IP/email throttling with fail-closed outages.
  Managed sessions recheck provider eligibility. See the
  [managed-auth rollout guide](MANAGED-AUTH-ROLLOUT.md).
- Added phone Code / Visualize / Inputs / Inspect tabs, compact persistent
  transport, a current-source-line summary, keyboard tab navigation and bounded
  account/workspace popovers. Desktop panel preferences are preserved.
- Draft writes now flush on source replacement, page hiding and unmount; failures
  remain visible and retryable. Account-history uploads default to local only,
  expose save/retry status and are cancelled/disabled on account changes.
- Updated vulnerable tooling dependencies, including Vitest 4.1.11. The approved
  npm advisory check reports zero known vulnerabilities after these updates.

Still outstanding: hosted isolation/auth rollout and real browser matrix; AST-based
JS/TS instrumentation; stable named/versioned workspaces with complete backups;
trace bookmarks/search, richer learning feedback, run comparison, algorithm views,
lessons and performance measurements. Current history saves can duplicate an
entry after a lost acknowledgement; full idempotent workspace sync is not complete.
Monetary contributions remain excluded.

Validation: full CI passes typecheck, lint, 262 tests in 48 files, app build/smoke
and isolated runner build/smoke. Local Chromium checks covered the email-code and
linking UI with synthetic API responses, invalid-code recovery, phone Python/JS
runs, inputs, inspection, More/Less transport, draft restore, history save failure
and retry, and restoring the desktop panel layout. Real email delivery and hosted
account changes were not exercised. The CI workflow now checks the runner build.

## Fifth batch: local workspace revisions and complete exercise backups

- Added a named IndexedDB library with stable IDs, immutable revisions, rename by
  saving, copies, and opening older revisions. Atomic writes and optimistic
  concurrency prevent a stale tab from overwriting a newer save.
- Explicit saves include source/language, function/inputs/seed, cases, notebook,
  watches, breakpoints and replay position. Saved workspace edits preserve notes
  and cases even while the source is invalid. Unsaved state and failures are visible.
- Added bounded versioned workspace export/restore, fresh IDs for restored files,
  validation before replacing the editor, and protection for edits during reads.
  Local replay restore disables account-history upload and does not run saved code.
- Replacing an open workspace (example, draft, history item, trace import or
  language change) asks first, then detaches the Library so later saves create a
  new workspace, and returns practice cases/notes to per-source storage without
  overwriting existing records.
- Added [workspace instructions and limits](LOCAL-WORKSPACES.md). These are explicit
  revision saves and single-exercise backups. Full workspace autosave, all-library
  archives, searchable/tag-filtered library UI and idempotent cloud sync remain future work.

Validation: full CI passes typecheck, lint, 285 tests in 51 files, app build/smoke
and runner build/smoke. Browser checks covered reload/reopen of a complete Python
exercise, valid backup restore, future-version rejection and phone library layout.
The browser stalled during a later confirmation dialog; older-revision recovery
is verified by automated tests. Download payload/wiring is tested; the browser's
actual download event was not observed. No live deployment changed.

## Sixth batch: parser-based JavaScript tracing (finding 1)

- Replaced regex line rewriting with acorn parsing and position-preserving
  instrumentation. Every statement and loop iteration is traced on its original
  line, including multi-line literals, unbraced/one-line bodies, labeled loops,
  switch cases, ASI-style code, classes, getters, static blocks and closures.
- JavaScript now follows the Python trace contract: "before execution" line steps,
  a real bottom-first call stack, call/return events with return values, an
  exception event in each frame an error leaves, and a final module state step.
  Variables are read through scope-aware getters, so shadowing and the temporal
  dead zone behave natively. Locals below the 12 most recent frames are elided.
- `console` output follows Node's `util.format` (checked against Node in tests);
  `console.error`/`warn` go to stderr. Snapshots never run getters; proxy traps
  triggered by the tracer are not recorded. Sets, typed arrays, dates, class names
  and JS `TreeNode`/`ListNode` shapes use the existing structure views.
- Async functions, generators, `await` and modules are rejected before running with
  a line-numbered capability message; syntax errors report their source line.
  Caught trace-limit errors cannot keep a program running.
- JavaScript is no longer labelled experimental. TypeScript keeps the label: the
  stop-gap annotation stripper no longer breaks object literals, but a real
  TypeScript transform (for example Sucrase, which preserves line numbers) still
  needs a dependency approval. Editor syntax highlighting for JS/TS likewise
  needs `@codemirror/lang-javascript`.

Validation: full CI passes typecheck, lint, 359 tests in 52 files, app build/smoke
and runner build/smoke. A 25-program corpus compares traced stdout, stderr and
errors with running the same source natively. Browser checks covered a recursive
tree program (five live frames, tree view of a caller's `node`, Node-style console
output and the final module step) and the TypeScript example. The JS worker chunk
grows from about 6 KB to 145 KB (parser included); it loads only for JS/TS runs.

## Seventh batch: explain the change, trace search/bookmarks and case feedback

- **Explain the change (P1).** A card at the top of Variables names the statement
  that produced the current state (clickable to reveal it in the editor), lists
  each changed value down to list indices, dict keys, object attributes and set
  members (`lookup[11]: absent → 0`), and shows printed output. Calls, returns
  with values, resuming a caller, loop iterations and exceptions have their own
  wording. The editor also marks the line that just ran, next to the active line.
- **Trace search and bookmarks (P1).** `/` opens a finder that searches variable
  changes (`total`, `total = 6`, `seen[4]`), lines, functions, events and printed
  text; results jump to the step and name the line responsible. `B` bookmarks a
  step; bookmarks carry notes, appear as scrubber ticks and are saved in workspace
  revisions and backups (older backups load with none).
- **Better practice feedback (P1).** Failing cases explain how the actual value
  differs: the first differing index or key, missing/unexpected items, the same
  items in a different order, whitespace or capitalization-only differences,
  off-by-one numbers, float rounding, int/float or list/tuple type changes and a
  `None` return. "Trace this case" already existed and is unchanged.

Validation: full CI passes typecheck, lint, 437 tests in 57 files, app build/smoke
and runner build/smoke. Browser checks with Python Two Sum covered the change card
and "just ran" mark, searching `lookup` and jumping to a result, bookmarking with
`B`, a note surviving a workspace save, reload and reopen, a failing case's
"different order" hint, and the phone layout (card, finder and scrubber ticks).

## Eighth batch: guided lessons

- Added six guided lessons (two pointers, sliding window, binary search, recursion,
  BFS and dynamic programming) as a **Guided lessons** example group. Each is a
  deterministic Python script with an explicit goal and invariant.
- Checkpoints name a line and visit to pause before, plus a variable, `name[key]`
  or `<return>` target. Playback pauses once at each unanswered checkpoint; the
  learner predicts, checks (equivalent Python literals and unquoted strings count)
  or reveals the answer, reads the explanation and can jump to the step where the
  value appears. A summary reports correct predictions. On phones a banner points
  to the Inspect tab when a prediction is waiting.
- Answers are read from the real trace. `engine/tests/test_lessons.py` runs every
  lesson through the Python engine and checks each authored answer, so lesson text
  cannot drift from what learners see.

This completes the Stage C list (explain-change card, bookmarks, workspaces and
backups, lessons, case feedback). Lesson progress is not saved between sessions,
and lessons exist only for Python.

Validation: full CI passes typecheck, lint, 455 tests in 59 files, app build/smoke
and runner build/smoke; the engine suite passes 143 tests, including all 22 lesson
checkpoints. Browser checks ran the DP lesson end to end (automatic pauses, a
correct, a revealed and a wrong answer, "See it happen" and the summary) and the
BFS lesson (string and dictionary answers).

## Ninth batch: TypeScript transform and JS/TS editing

- Replaced the stop-gap annotation stripper with Sucrase, which removes TypeScript
  syntax while keeping every statement on its original line. Interfaces, type
  aliases, generics, enums, parameter properties, access modifiers, abstract
  classes, overloads, `declare`, `satisfies`, non-null assertions and type-only
  imports now trace like JavaScript. Namespaces (which Sucrase would drop) and
  decorators are rejected with a line-numbered message; syntax errors report
  their line. TypeScript is no longer labelled experimental.
- Added JavaScript/TypeScript syntax highlighting with `@codemirror/lang-javascript`,
  and JS/TS syntax errors are now underlined inline like Python diagnostics.
- `acorn` is declared directly (it was already installed through ESLint). `npm audit`
  reports no production vulnerabilities after adding `sucrase` and
  `@codemirror/lang-javascript`.

- Sucrase lives in its own chunk (207 KB) that the worker loads only for TypeScript
  runs, so the JavaScript worker stays at 145 KB. The JS/TS grammar (33 KB gzip)
  loads only when a JS/TS session opens; the shared editor chunk is unchanged.

Validation: full CI passes typecheck, lint, 469 tests in 60 files, app build/smoke
and runner build/smoke. An 8-program corpus compares traced output and errors with
compiling the same TypeScript through the TypeScript compiler and running it
natively, plus line-mapping, rejection and syntax-error tests. Browser checks ran a
TypeScript program with an enum, an interface and parameter properties (correct
output, highlighting, structure views) and showed an inline JavaScript syntax error.

## Tenth batch: algorithm-focused views (Stage D)

- Deques and `queue`/`q`-named lists draw as queues with front/back ends, newly
  enqueued items and the items dequeued since the previous step; `stack`-named
  lists draw top-first with popped items; `heap`/`pq` lists draw as binary heaps
  (index i has children 2i+1 and 2i+2).
- Dicts whose values are neighbour lists, sets or weight maps draw as graphs with a
  layout that stays fixed as the search moves. Other variables color the nodes:
  sets and dicts of nodes mark visited (dict values become labels such as
  `dist=2`), the queue/stack marks the frontier and `node`/`cur`/`u`-style variables
  mark the current node. Undirected graphs are detected; weights are shown.
- `dp`/`memo`/`ways`-named lists and grids are DP tables: the statement that just
  ran is parsed, its index expressions are evaluated with the values from before it
  ran, the cells it read are outlined, and a formula shows the substitution.
- Inference is conservative and every card with more than one fitting view has a
  **View as** selector, following the plan's manual-adapter guidance. The generic
  reference map is unchanged.

Validation: unit tests cover graph recognition (including leaf nodes, weights and
non-graph dicts), decorations, view inference, queue/stack deltas and 1D/2D DP
transitions; component tests cover stack, heap, graph and DP rendering and switching
views. Browser checks used the BFS lesson (graph coloring, queue) and the DP lesson
(formula and read cells at every recurrence step).

## Evidence and limits (original audit)

| Check                                       | Result                                                                                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript typecheck and ESLint             | Passed through `npm run ci`                                                                                                             |
| Frontend/server tests                       | 34 files, 173 tests passed                                                                                                              |
| Python engine tests                         | 121 passed through `npm run test:engine`                                                                                                |
| Production build and static packaging smoke | Passed                                                                                                                                  |
| Local browser                               | Landing page, Python Two Sum run and completed return value; desktop 1440×1000 and narrow 390×844 layouts inspected                     |
| Additional direct engine probes             | Reproduced JS/TS instrumentation failures, missing nested snapshots, flattened recursive stack, and a false-positive practice assertion |
| Production services                         | Not exercised: deployed authentication, Supabase, hosted AI, payments, real customer data                                               |
| Browser matrix                              | Not certified: Safari/Firefox, physical phones, external embedding, and full keyboard/screen-reader workflows                           |

The build emitted Pyodide Node-module externalization warnings but completed. These are not evidence of a runtime failure. Passing unit tests and packaging smoke checks do not establish end-to-end correctness; the extra probes below demonstrate the coverage gap.

## What is already valuable

The code supports more than a basic line visualizer:

- Python execution in a Pyodide worker; JS/TS in a separate worker path.
- Reverse/forward replay, timeline scrubbing, step-over, cursor navigation, breakpoints, execution counts, and playback speed.
- Variables, changed values, watched-variable timelines and next/previous-change navigation.
- Arrays, strings, dictionaries, matrices, trees, linked lists, aliases, heap references, and recursive call trees.
- Python function selection, inferred/generated inputs, reproducible seeds, cases, edge-case generation, failure reruns, and local practice notes.
- Local custom-code draft, signed-in rerunnable history, share links, iframe code, JSON trace exchange, and animated SVG exports.
- Learn/Default/Advanced panel presets, resizable panels, light/dark themes, inline diagnostics, and error boundaries around individual panels.
- Server-side AI credentials, request-size protections on account/history routes, HttpOnly session cookies, and database access restricted to the Worker.

Preserve these capabilities. Recommendations such as “add breakpoints,” “add recursion,” “add a notebook,” or “add sharing” would duplicate existing work. The opportunity is to improve their reliability and connection to one another.

## Findings to resolve before expanding

### 1. JS/TS transformations can break valid programs — P1, reproduced

[jsTraceEngine.ts](</Users/harsit/Documents/Code Visualizer/src/engine/jsTraceEngine.ts:73>) strips TypeScript with regular expressions and inserts trace calls by physical source line. That cannot reliably preserve syntax, scope, or statement boundaries.

The following otherwise-valid examples produced syntax errors in direct calls to the current engine:

```javascript
const nums = [1, 2];
console.log(nums.length);
```

```javascript
const n = 1;
if (n > 0) {
  console.log('positive');
} else {
  console.log('negative');
}
```

```typescript
const item = { value: 2 };
console.log(item.value);
```

The single-line loop `for (let i = 0; i < 5; i++) sum += i;` computes the correct total but records no per-iteration trace. A recursive factorial prints `6`, yet every recorded step has a one-frame stack. These are educational correctness issues, not just unsupported editor syntax.

**Plan:** publish a visible capability matrix immediately; describe JS/TS as limited/experimental until repaired. Replace line rewriting with parser-based statement instrumentation, lexical-scope tracking, a real TypeScript transform, source-location mapping, and function enter/exit events. Add JS/TS syntax highlighting in [EditorPanel.tsx](</Users/harsit/Documents/Code Visualizer/src/components/EditorPanel.tsx:274>), which currently enables language syntax extensions only for Python. Explicitly reject unsupported async/module constructs until their lifecycle is implemented.

**Acceptance:** ordinary multiline arrays/objects, branches, loop variants, nested scopes, recursion, destructuring and TS annotations preserve native output and exceptions. Every supported executed statement maps to the correct original source location. Unsupported constructs produce a clear capability message rather than a misleading user-code syntax error.

### 2. JS nested object state becomes incomplete — P1, reproduced

The JS snapshotter retains IDs across the run but emits a reference for every previously seen nested object at [jsTraceEngine.ts:206](</Users/harsit/Documents/Code Visualizer/src/engine/jsTraceEngine.ts:206>).

For `const item = { child: { n: 1 } };` followed by `item.child.n = 2;`, the first snapshot contains `n=1`; later snapshots contain only a reference to the child. The new value `2` is absent from those snapshots. There is no corresponding per-step heap table in this JS payload.

**Plan:** keep identity stable across steps, but reset traversal/visited bookkeeping per snapshot; alternatively use a complete heap table per step or explicit deltas plus checkpoints. Make `null`, `undefined`, strings and array pointer rules language-aware; JS `null` currently enters the Python `none` display path.

**Acceptance:** nested mutation, shared aliases and cycles remain inspectable at every step, including after export/import. Snapshotting must not invoke arbitrary getters or change program behavior.

### 3. The step meaning is inconsistent across engines and AI — P1, reproduced/source verified

Python's `sys.settrace` line events represent state **before** executing the highlighted line. A direct probe of `x = 1; x = 2; print(x)` on separate lines shows `x=1` when line 2 is highlighted, and `x=2` when line 3 is highlighted. JS hooks are generally inserted after a source line.

The explainer prompt says “Current locals after this step” in [deepseekShared.ts:83](</Users/harsit/Documents/Code Visualizer/src/engine/deepseekShared.ts:83>) and the duplicate server implementation in [explain-step.ts:188](</Users/harsit/Documents/Code Visualizer/functions/api/explain-step.ts:188>). This can attribute the previous statement's state change to the next statement.

**Plan:** define an explicit trace contract with event phase, source location, executed statement and before/after state. Keep “next line to execute” distinct from “statement that produced this change.” Use that contract in highlighting, variable diffs, stdout, exports and AI. Consolidate the duplicated AI context/prompt implementation.

**Acceptance:** assignment, branch, call, return and exception examples tell the same story in every panel; a fixture asserts the exact state and explanation context for each event phase.

### 4. Practice cases can mark wrong answers as passing — P1, reproduced

[practiceCases.ts:90](</Users/harsit/Documents/Code Visualizer/src/app/practiceCases.ts:90>) compares formatted previews and then removes all whitespace. Actual string `'a b'` with expected `'ab'` returns `status: "pass"`. Custom objects and truncated structures also have display previews that cannot prove equality.

**Plan:** compare typed values in the execution engine using a separately bounded assertion representation, independent of visualization truncation. Preserve string whitespace. Support exact structural equality first; add explicit tolerances for floats, unordered comparisons and in-place mutation expectations as separate options. Distinguish invalid input, execution error, assertion failure and inconclusive/truncated comparison. Generated cases should show assumptions such as sorted inputs or valid `k` ranges.

**Acceptance:** whitespace-sensitive strings fail correctly; objects with different attributes fail; values beyond the visual truncation boundary are compared or explicitly marked inconclusive. Promoting actual output remains a deliberate user action, not a claim that the implementation is correct.

### 5. Same-origin execution is not an account-security sandbox — P0, source-derived risk

[jsRuntimeClient.ts:11](</Users/harsit/Documents/Code Visualizer/src/engine/jsRuntimeClient.ts:11>) creates a same-origin worker, and [jsTraceEngine.ts:307](</Users/harsit/Documents/Code Visualizer/src/engine/jsTraceEngine.ts:307>) evaluates user source using `new Function`. A worker separates execution from the UI thread but still exposes browser APIs. Same-origin fetch requests can carry session cookies; HttpOnly prevents direct cookie reading, not authenticated requests. The current CSP permits same-origin connections. [MDN worker capabilities](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers), [fetch credentials](https://developer.mozilla.org/en-US/docs/Web/API/Request/credentials).

This is a source-derived boundary concern, not a claim that a live account was compromised. The Python worker and its JavaScript interoperability must be included in the same review. Shared code currently requires a user run; preserve that deliberate action.

**Plan:** put execution on a dedicated, credential-free origin with a narrow validated messaging protocol. Keep account cookies host-only on the app origin, deny runner-origin access to account APIs, constrain runtime network access and storage, and validate every response before rendering. Test the runner's actual delivered CSP and cookie behavior, including its ability to create further execution contexts. Preserve a termination fallback if isolation prevents SharedArrayBuffer use. Simply deleting `fetch` from a global object is not an adequate isolation design.

**Acceptance:** adversarial snippets cannot read or mutate app history, spend authenticated AI quota, access app storage, or forge trusted runtime envelopes. Test both Python and JS/TS in a controlled staging environment.

### 6. Account identity and password handling need hardening — P0/P1, source verified

- Signup creates an active session immediately without proving ownership of the email in [accountApi.ts:96](</Users/harsit/Documents/Code Visualizer/src/server/accountApi.ts:96>).
- [usage.ts:139](</Users/harsit/Documents/Code Visualizer/src/server/usage.ts:139>) grants the unlimited admin AI quota based on that email string. An unclaimed allowlisted address could therefore be registered by someone else. This finding concerns AI quota privileges; no separate admin dashboard was found.
- New password hashes use one salted, peppered HMAC-SHA256 operation in [auth.ts:149](</Users/harsit/Documents/Code Visualizer/src/server/auth.ts:149>). A pepper helps when the database alone is exposed, but this lacks an adaptive password hash's work factor. [OWASP password-storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
- The auth throttle in [rateLimit.ts](</Users/harsit/Documents/Code Visualizer/src/server/rateLimit.ts:13>) is a module-local Map, not a durable global limit across Worker instances.
- Email verification and password reset are explicitly deferred in the feature checklist.

**Plan:** immediately attach privileged roles to verified, provisioned user IDs. Prefer a managed authentication service with verified email, recovery and established password handling; evaluate the existing Supabase platform first. Preserve history ownership through an explicit old-user-ID migration and session invalidation plan. Use durable edge throttling plus account-level limits, and add session revocation and account deletion/export.

**Acceptance:** registering an allowlisted email never grants privileges without verification; recovery cannot transfer another user's history; throttling holds across instances; migrated accounts retain the correct data. Do not lower password security to fit a runtime CPU budget.

### 7. Async results can be applied to a different current context — P1, source verified

[useSession.ts:435](</Users/harsit/Documents/Code Visualizer/src/app/useSession.ts:435>) sets the completed run without checking a source revision/run token. The editor and language/example selectors can change while work is pending. This creates a path for an old trace to be displayed alongside newer code.

[ExplainerPanel.tsx:54](</Users/harsit/Documents/Code Visualizer/src/components/ExplainerPanel.tsx:54>) clears displayed text on step changes, but does not abort or invalidate the request there; a late response can populate the new step with the old step's explanation.

**Plan:** attach immutable run IDs, source hashes and language IDs to requests and results. Cancel or discard results when their context changes. Apply the same rule to batches, complexity measurement, AI and history saves. Let users cancel execution and retry initialization.

**Acceptance:** changing code/language/step during deliberately delayed work cannot display or save a stale result. Keep an explicit “trace from previous code version” view only when the user requests it.

### 8. Resource limits and import validation are uneven — P1, source verified

Python has a 3,000-step default and an internal time guard. JS has a worker timeout but no trace-count/serialized-byte limit in its recording loop. Both paths can accumulate output. The Python client arms its timeout only after a `running` status, so initial runtime loading has no equivalent watchdog.

[useTraceTransfer.ts:168](</Users/harsit/Documents/Code Visualizer/src/app/useTraceTransfer.ts:168>) reads an entire file and accepts any truthy `result` beside a string `code`; it does not enforce the exported schema version or validate nested steps. Share decoding similarly checks only the code string. A malformed import can reach code expecting `run.steps` and break the application shell.

**Plan:** shared code/output/step/depth/byte limits; bounded import file size before reading; versioned schema validation; clear migration/rejection messages; bounded share URLs; runtime-load watchdog and retry; cancel control; partial traces on ordinary limit stops. Validate worker messages as untrusted input too.

**Acceptance:** malformed, oversized, future-version and deeply nested files fail gracefully while preserving the current work. Infinite loops and large output end predictably, and the next valid run succeeds.

### 9. Mobile needs a task-oriented layout — P1, browser observed

At 390×844 the current stacked layout puts code, inputs, data and variables far apart, while the transport occupies multiple rows. This makes comparing state with code difficult. The saved full-panel desktop layout also contains several independent scroll regions. Learn/Default/Advanced presets already exist; improve their discoverability instead of adding more panels by default.

**Plan:** on phones, use Code / Visualize / Inputs / Inspect tabs with a compact persistent transport and current-line summary. Move secondary navigation and speed controls into an expandable tray. Provide full-screen structure focus, readable code wrapping controls, and clear access to case failures. Preserve desktop panel positions and user sizing. Make touch targets, safe-area spacing and keyboard focus part of acceptance.

**Acceptance:** a learner can run, step, inspect a changed variable and return to the source at 390px without horizontal page overflow or controls hiding focused content. Verify on real Safari and Android Chrome as well as desktop browser tests.

### 10. Persistence works, but does not yet form a dependable workspace — P1/P2

Draft storage keeps one custom snippet. Cases and notebooks use source/function-based localStorage keys, so edited versions can leave multiple records; save errors are swallowed. Signed-in history saves successful runs best-effort and silently ignores failures. Trace JSON does not include cases, notebook notes, watch selections or breakpoints.

**Plan:** introduce stable workspace IDs with named revisions; separate code, inputs/cases, notebook and trace artifacts; move larger local storage to IndexedDB; display Local saved / Syncing / Synced / Save failed states. Add a complete workspace backup and restore before adding broader cloud sync. Offer a private/local-only workspace setting and explain automatic history upload.

**Acceptance:** editing or renaming a workspace preserves its cases and notes; failed saves are visible; backup/restore is complete; account changes cannot mix histories. Keep viewing a downloaded trace possible without running code.

### 11. Performance and deployment claims need real measurements — P2

The build reports approximately 158 KB gzip for CodeMirror, 60 KB for React, 47 KB for the main JS and 46 KB for CSS. Copied Python assets include about 9.1 MB WASM and 3.1 MB standard-library ZIP on disk; those disk sizes are not measured network transfer sizes. The app eagerly imports the dashboard and starts Python prewarming from the landing page.

[CallStackPanel.tsx:196](</Users/harsit/Documents/Code Visualizer/src/components/CallStackPanel.tsx:196>) rebuilds the call tree from the trace prefix during rendering; watched-variable timelines also scan steps. These are optimization candidates, not measured bottlenecks yet.

**Plan:** measure cold landing load, first Python run, warm run, peak trace memory and p95 scrubbing latency. Lazy-load the dashboard/editor, prewarm on clear intent or connection-aware conditions, and index call/variable histories once per result. Virtualize long inspector lists. Later consider trace deltas and checkpoints if byte budgets justify them.

GitHub Pages builds set a base path, but navigation in App/LandingPage hardcodes `/` and `/app`. Test base-path navigation, reload and shares or declare one canonical Cloudflare deployment. The Pages alternative only contains an explainer function, while account/history routing is in the Worker. Serve host capability information so static deployments do not offer unavailable account/AI actions.

### 12. AI cost and data handling should be explicit — P1/P2

The AI payload includes up to 7,000 characters from the start of the source plus formatted locals/output, not solely a tiny neighborhood around the current line. The UI mentions a hosted service but does not clearly describe this payload. Usage is incremented before the provider responds, so an upstream failure still consumes quota. The anonymous subject includes user agent, which is easy to vary.

**Plan:** show what will be sent, use a bounded active-line excerpt, allow redaction, and make cloud history/AI data handling clear. Implement request timeouts, idempotency and a deliberate successful-request versus attempted-request quota policy. Add overall spend/concurrency caps and durable abuse controls. Cache answers by immutable trace context. Keep deterministic local explanations for basic state changes and common exceptions, with AI as an optional deeper explanation.

**Acceptance:** provider failures have understandable quota behavior; repeated identical requests do not unexpectedly double-charge quota; no source/locals are written into analytics or operational logs; unavailable services have a clean user-facing state.

## Feature additions with the best payoff

| Priority | Feature                              | Concrete experience                                                                                                            | Dependency / effort                                             |
| -------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| P1       | Explain the change                   | A compact card says `lookup[11]: absent → 0` and identifies the statement responsible; click it to focus the source/object     | Correct event contract; medium                                  |
| P1       | Trace bookmarks and search           | Bookmark a confusing step; search line/event/function/value changes; attach a note                                             | Stable run IDs and event index; medium                          |
| P1       | Better practice feedback             | Typed assertions, mutation checks, failing-case input diff and “trace this failure”                                            | Assertion repair; medium                                        |
| P2       | Compare two runs                     | Compare an old and new solution on the same input; align by function/line milestones and show the first divergent value        | Versioned workspaces and reliable traces; large                 |
| P2       | Algorithm-focused views              | Explicit queue/stack/priority-queue adapters, adjacency-list graph view, visited/frontier coloring and DP-cell transitions     | Existing matrix/heap views are a base; medium/large per adapter |
| P2       | Guided lessons                       | Predict the next value, reveal the step, explain the invariant; start with two pointers, sliding window, recursion, BFS and DP | Trusted traces and authored lesson metadata; medium             |
| P2       | Teaching mode                        | Presentation layout, annotations and replay checkpoints packaged with an embed/export                                          | Workspace transfer and mobile replay; medium                    |
| P2       | Searchable workspace library         | Named sessions, pattern tags, review filters and complete backup                                                               | Stable IDs/storage plan; medium/large                           |
| P2       | Better complexity experiments        | Choose which input dimension grows, show actual sampled sizes/failures and distinguish measured growth from theoretical Big-O  | Reliable generation/assertions; medium                          |
| P3       | Offline replay and installable shell | Previously saved lessons remain usable without network; runtime cache is versioned                                             | Storage/runtime budgets; medium                                 |

Use manual adapter selection when structural inference is ambiguous. Do not imply that a generic heap reference graph is already an algorithm graph view, or that existing matrix rendering is already a DP tutorial.

Defer broad language expansion, real-time multiplayer, a marketplace, and paid feature entitlements until trace fidelity and saved work are dependable. Existing animated SVG export should be improved before promising GIF/video export.

## Delivery order and completion criteria

Effort estimates are planning ranges for focused engineering work, not delivery promises. Account migration and runtime isolation require a design spike before reliable scheduling.

| Stage                         | Scope                                                                                                                                                    | Exit criteria                                                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| A: Correctness and protection | Privileged identity fix; runtime isolation design; JS/TS capability labeling; typed case comparison; event semantics; stale-result guards; import limits | Reproductions covered by regression tests; no known false pass or mismatched source/trace; security boundary demonstrated in staging |
| B: Reliable public use        | Implement runtime/auth migrations; cancellation/retry; save status; responsive workflow; production browser CI                                           | Cold-start/failure/recovery tested, ownership preserved, mobile core loop usable, browser tests run on PRs                           |
| C: Learning and retention     | Explain-change card, bookmarks, stable workspaces/backups, curated lessons and better case feedback                                                      | Learners can understand and save a complete exercise without account/AI dependence                                                   |
| D: Differentiation            | Run comparison, graph/queue adapters, presentation/annotated exports and measured performance work                                                       | Each feature has native-output parity fixtures and a complete user workflow                                                          |

A practical first batch is: (1) privilege protection, (2) practice equality repair, (3) JS/TS limitation labels plus reproduction tests, (4) event-phase contract, (5) async result guards and import validation. Runtime isolation/authentication migration should proceed from an early design spike before wider account adoption.

## Verification and measurement plan

- Add real browser CI against a built app/Worker preview: Python and JS runs, stepping, cases, share reload, export/import, nested structures, failed loads, timeout recovery, mobile navigation and keyboard focus.
- Add a language corpus that compares supported transformed code with native language output and asserts state at chosen execution points. Include syntax that spans lines, cycles/aliases, recursion and Unicode output.
- Add controlled staging security tests for runner isolation, verified identity, history ownership and durable throttling.
- Test replay with 100, 1,000 and 3,000 steps and several structure sizes. Agree budgets after measuring baseline; a reasonable initial target is p95 step-to-render under 100 ms on a named reference device.
- Measure first successful run, meaningful stepping after a run, successful failure-case debugging, saved-work recovery and return visits. Use privacy-preserving events; exclude code, inputs, locals, notebook text and full share URLs.

Next remaining milestones: stage the isolated runner and managed accounts, verify the real browser/device matrix, and implement the remaining Stage D features (run comparison, teaching mode), workspace autosave/search and cloud sync. Phone navigation, save-failure recovery, explicit local workspace revisions/backups, parser-based JavaScript/TypeScript tracing, step explanations, trace search/bookmarks, failing-case explanations, guided lessons and algorithm views are implemented locally.
