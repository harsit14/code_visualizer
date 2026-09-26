<p align="center">
  <img src="public/brand/step-logo.svg" alt="Code Visualizer Step logo" width="96" />
</p>

# Code Visualizer

**See your code run, line by line.**

Code Visualizer turns short programs into replayable execution traces. Paste an
algorithm, press run, and watch variables, pointers, calls, objects, stdout,
return values, and exceptions move together through a timeline.

It is built for the moments when code is technically correct but still hard to
see: learning recursion, tracing interview problems, teaching data structures,
or understanding how state mutates one line at a time.

## Preview

![Code Visualizer dashboard with editor, generated inputs, trace controls, array state, variables, and output.](docs/screenshots/two-sum-dashboard.jpg)

![Code Visualizer tracing Reverse Linked List with linked-list nodes, aliases, and pointer labels.](docs/screenshots/linked-list-trace.jpg)

## Highlights

- Trace Python, JavaScript and TypeScript snippets in the browser.
- Step forward and backward through a recorded execution timeline.
- Stop running code or runtime loading, and retry a failed Python startup.
- See active lines, changed variables, call stack frames, stdout, return values,
  and runtime errors in sync.
- Read what each step did: the statement that just ran (also marked in the
  editor), each value it changed such as `lookup[11]: absent → 0`, and its output.
- Search the trace for a variable, a value (`total = 6`), a line, a function,
  returns, exceptions or printed text, and bookmark confusing steps with notes.
- Work through guided lessons (two pointers, sliding window, binary search,
  recursion, BFS and dynamic programming) that pause to ask you to predict the
  next value, then reveal it with the invariant behind it.
- Visualize arrays, strings, dictionaries, binary trees, linked lists, object
  references, aliases, and heap state.
- See algorithm views: queues (front/back, dequeued items), stacks (top first,
  popped items), binary heaps as trees, adjacency lists as graphs colored by
  visited/frontier/current node, and DP tables that outline the cells a recurrence
  read (`ways[5] = ways[4] + ways[3] → 5 + 3 = 8`). Each card has a **View as**
  choice when a guess is wrong.
- Generate editable Python function inputs for LeetCode-style snippets. As on
  LeetCode, `defaultdict`, `Counter`, `deque`, `heappush`, `bisect_left`, `inf`,
  `lru_cache`, `List` and similar names work without imports, and misspelled
  names or attributes get a "Did you mean …?" hint (JavaScript and TypeScript
  `ReferenceError`s too).
- Save compact practice cases, add generated edge cases, run all cases, rerun
  only failed cases, and promote trusted actual output into expected output.
  Failing cases explain the difference, such as a wrong index, items in a
  different order, whitespace-only changes or a missing `return`.
- Keep a local practice notebook with pattern tags, review status, and notes for
  each code/function pair.
- Save named local workspace revisions with cases, notes, inputs, watches,
  breakpoints, bookmarks and replay. Tag them by pattern, mark them for review,
  search names, tags and code, and let open workspaces autosave. Export one
  exercise or the whole library as a backup, or opt in to sync the library with
  your account.
- Keep a run as a baseline, edit the code and compare: the first divergent return
  value, variable, output line or call is named, with a jump to that step.
- Run complexity experiments: choose which input grows, see every sampled size
  (including failures) on a chart, and read measured growth separately from a
  loop-nesting heuristic.
- Present a trace in a focused, larger-type layout with captioned checkpoints, and
  export a self-contained HTML replay that plays without the app or a network.
- Install the app and keep using saved workspaces, imported traces and lessons
  offline; Python runs offline once its runtime has been cached.
- Track pointer variables such as `i`, `left`, `right`, `lo`, `hi`, `prev`,
  `curr`, and `nxt`.
- Inspect recursive execution with a persistent call tree.
- Ask the hosted AI explainer to translate the current trace step into plain
  language.
- Save signed-in history, share runnable links, import/export trace sessions,
  and copy iframe embeds. Signed-in users can review and sign out sessions,
  download their data and delete their account.
- Export animated SVG replays for notes, lessons, and writeups.
- Switch between polished light and dark themes.

## How It Feels

Code Visualizer is not a print-debugging replacement. It is a visual surface for
state.

The dashboard keeps the editor, trace controls, current data structure, locals,
call stack, console, and explainer close together so you can compare what the
code says with what the program actually did. The landing page includes a live
demo, preset algorithms, and structure previews for variables, arrays, linked
lists, trees, heap references, call stack frames, console output, and complexity
hints. For interview practice, the test inputs panel also keeps saved cases,
edge-case generation, failure reruns, and a local notebook close to the trace
without opening a separate workspace.

## Guided lessons

Pick a lesson from **Guided lessons** in the example list and press **Run**. Playback
pauses at each checkpoint before the important line runs and asks you to predict a
value, such as `ways[2]` or what a recursive call returns. **Check** compares your
answer with the real trace (Python literals and unquoted strings are accepted),
**Show answer** reveals it, and **See it happen** jumps to the step where the value
appears. Press Play to continue to the next checkpoint. Editing the code ends the
lesson. Lesson programs and their expected answers live in
`src/lessons/lessons.json`; `engine/tests/test_lessons.py` checks every checkpoint
against the Python engine.

## Local workspace library

Use **Library → Save revision** to keep a named exercise on this device. Revisions
include code, inputs, cases, notebook, watches, breakpoints and replay. Edits and
renames preserve the workspace identity; older revisions remain available.
**Export workspace** backs up the current exercise, and **Restore backup** opens
it as a new local workspace. Revisions are explicit; between them, an open saved
workspace autosaves, and reopening it offers to restore or discard that autosave.
Tags, review flags and search help find old exercises, and **Export library**
archives everything at once. See [local workspace and recovery details](docs/LOCAL-WORKSPACES.md).

## Languages

| Language   | Support                                                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Python     | Richest mode: generated inputs, specialized structures, recursion, complexity sampling, and deep trace panels.                    |
| JavaScript | Synchronous scripts: statements, loops, functions, recursion, classes and closures with a real call stack and Node-style console. |
| TypeScript | Types are removed with Sucrase, keeping every line in place, then traced like JavaScript; namespaces and decorators are rejected. |

Python tracing runs through Pyodide and WebAssembly inside a Web Worker.
JavaScript and TypeScript run in a separate browser worker.

## Runtime recovery

The primary Run control becomes **Stop** while a worker is loading, running a
program, checking practice cases or measuring complexity. Stop keeps source and
saved cases; unfinished execution is discarded. The next Python run starts a
fresh interpreter. A startup failure offers **Retry runtime**, which reloads and
analyzes without executing your program.

Python startup is bounded to 45 seconds. Execution uses a separate deadline;
timeouts interrupt when possible and terminate the worker if it does not respond.
The recovery work does not isolate untrusted code from app accounts; see the
[runtime and authentication migration design](docs/RUNTIME-AND-AUTH-MIGRATION.md).

## Trace and practice behavior

Line snapshots show state **before** the highlighted statement executes, in both
Python and JavaScript. Calls, returns (with the returned value) and exceptions are
separate events, and the last step shows the program's final state. JavaScript is
parsed before it runs: each statement and loop iteration is traced on its original
line, `console` output follows Node's formatting, and async functions, generators
and modules are rejected with a clear message. Traces exported by older versions,
where JavaScript steps meant "after execution", keep that label.

Practice expectations are Python literals such as `[0, 1]`, `'a b'`, `True`, or `None`.
Comparison uses the actual return value and preserves types and string whitespace;
`True`, `1`, and `1.0` are distinct. Lists/tuples compare in order, dictionaries and
sets independent of order. Custom objects, cycles, non-finite numbers and values
beyond assertion limits are unchecked. Invalid expected literals report an error.
Visualization truncation alone does not change the comparison; an incomplete run
cannot pass. “Use actual” copies a complete parseable literal and requires a rerun.

Trace import supports version 1 and 2 exports up to 20 MiB, 10,000 snapshots,
500,000 encoded values and depth 40. Invalid files leave the current session intact.
Overlarge share links should be replaced with a trace export. JS traces stop after
3,000 steps, 200,000 encoded snapshot values or 100,000 output characters and preserve the available replay.

## Privacy Model

- User code execution and trace generation happen in the browser.
- Practice cases and notebook notes are stored locally in your browser.
- AI explanations use only the selected trace step and surrounding code context,
  and you can preview and trim exactly what is sent.
- Signed-in history is stored for your account so traces can be reopened later.
  You can download it with the rest of your account data, or delete the account.
- The offline cache holds only the app and the Python runtime; API responses and
  your data are never cached by the service worker.
- Workspace sync is off until you turn it on. Only explicit revisions, tags and
  review state are uploaded; autosaves and workspaces marked local only stay on
  the device.

## Quick Start

```bash
npm install
npm run dev
```

Open the printed local URL, choose an example, or paste your own snippet.

For Python function-only snippets, Code Visualizer fills the test inputs panel
with generated literals. You can edit those inputs, change the seed, regenerate,
and run again. The folded Cases section can save inputs, generate edge cases,
compare optional expected output, rerun failures, and load any case back into
the trace. The folded Notebook section stores pattern tags, review status, and
notes locally for that exact snippet.

## Examples To Try

| Example                       | What to watch                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------- |
| Two Sum                       | Dictionary updates, generated `nums` and `target`, saved cases, and edge cases. |
| Reverse Linked List           | `prev`, `curr`, and `nxt` aliases as each `next` link flips.                    |
| Binary Tree Inorder Traversal | Recursive frames opening and closing around a rendered tree.                    |
| Binary Search                 | `lo`, `mid`, and `hi` converging on the answer.                                 |
| Loop accumulator              | Plain script execution with stdout and variable changes.                        |

## Development

```bash
npm run test
npm run build
npm run ci
```

Full deployment and operations notes live in [docs/deployment.md](docs/deployment.md).

An opt-in runner build moves Python and JS/TS execution to a separate origin.
Set `VITE_RUNNER_URL` for the app and configure the runner’s exact app-origin
allowlist as described in the deployment guide. A configured runner fails visibly
if unavailable; it never falls back to app-origin execution. Without this setting,
the existing same-origin worker mode remains active. Production isolation still
requires the staging acceptance matrix in
[the runtime migration notes](docs/RUNTIME-AND-AUTH-MIGRATION.md).

## Ownership, Use, and Attribution

Code Visualizer was created, designed, and developed by **Harsit Upadhya**.

Copyright 2026 Harsit Upadhya.

The software in this repository is available under the
[PolyForm Noncommercial License 1.0.0](LICENSE). You may use, study, modify, and
share it for permitted noncommercial purposes. Commercial or revenue-generating
use—including resale, paid access, advertising-supported hosting, incorporation
into a paid product or service, or use intended for commercial advantage—is not
licensed without prior written permission from Harsit Upadhya.

If you distribute the software or a modified version, you must include the
license and preserve the required creator and copyright notice in [NOTICE](NOTICE):

> **Code Visualizer — created by Harsit Upadhya**
>
> <https://github.com/harsit14/code_visualizer>

Original documentation, screenshots, the logo, and other visual assets are
available for noncommercial sharing and adaptation under
[CC BY-NC 4.0](CONTENT-LICENSE.md), with attribution. Third-party dependencies
and materials remain subject to their own licenses.

Because commercial use is restricted, this project is **source-available**, not
open source as defined by the Open Source Initiative. The licenses do not grant
permission to imply endorsement or ownership by anyone else.

## Local reliability and account rollout

Phones use Code / Visualize / Inputs / Inspect views with a persistent transport.
Typing saves a local draft, with visible errors and retry when browser storage
fails. Account-history uploads are opt-in under Workspace → Saving and privacy;
turning them on sends successful-run source and inputs to the signed-in account.

Verified email-code accounts and safe legacy linking are available behind an
explicit deployment flag. Follow [the managed-auth rollout guide](docs/MANAGED-AUTH-ROLLOUT.md)
before changing a hosted deployment. No live accounts have been migrated.

## Project Notes

- Custom Python class instances render as attribute tables unless they match
  recognized `TreeNode` or `ListNode` shapes.
- JavaScript and TypeScript tracing has no generated inputs, practice cases or
  complexity experiments yet; those remain Python features.
