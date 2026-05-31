# Progress

## Current State

- Project scaffolded as Vite + React + TypeScript.
- Python execution runs client-side through Pyodide in a Web Worker.
- Pyodide assets are copied for production deploy; dev loads from `node_modules`.
- Cloudflare Pages headers are configured in `public/_headers` for cross-origin isolation.
- App has editor, Hybrid view, scope inspector, output panel, timeline scrubber, examples, and run/reset controls.
- Milestone 3 baseline is complete: traces now include scope, variable, object, and change snapshots.
- Hybrid view filters primitive values out of object boxes, draws variable-to-reference arrows, and hides loop lanes entirely when no loop index variable is present.
- Inspector/output desktop layout was tightened so two-variable alias snapshots fit without clipping at the default viewport.
- Milestone 4 baseline is complete: worker-side AST analysis emits a static program map and trace events are matched to static nodes.
- Milestone 5 baseline is complete: loop iteration context is inferred without reintroducing the removed dot/ring loop tracker.
- Milestone 6 baseline is complete: function call stack, argument, and return snapshots now drive a Function Theater view.
- Milestone 7 baseline is complete: shallow structured object entries now flow from the Python worker into Hybrid view and Inspector.
- Large-trace timeline rendering is now compacted around the current step instead of drawing every recorded event as a button.
- Milestone 8 baseline is complete: playback speed, trace JSON export, URL-hash sharing, and click-to-inspect object focus are live.
- Milestone 9 baseline is complete locally: GitHub CI, production smoke checks, direct Pyodide asset copying, deployment docs, and release checklist are in place.

## Completed Milestones

- Milestone 0: project foundation, deployable shell, examples, README, tests/build scripts.
- Milestone 1: Pyodide worker runtime, stdout/stderr/error capture, timeout handling, worker fallback.
- Milestone 2: `sys.settrace` line/call/return/exception trace events, timeline playback, source-line jump/highlight, locals inspector.
- Milestone 3 baseline: stable Python `id()` object references, variable creation/update/reference-change flags, object mutation detection, reference arrows, and object-aware inspector.
- Milestone 4 baseline: Python `ast` static model for functions, loops, branches, assignments, calls, returns, symbols, syntax diagnostics, and runtime-to-static highlighting.
- Milestone 5 baseline: active loop stack, iteration number, iterator value, and changed variables are inferred per trace step and shown through the arrow-based loop lane.
- Milestone 6 baseline: active call stack, arguments, recursive frames, call transitions, and return values are inferred per trace step and shown in Hybrid view.
- Milestone 7 baseline: list, tuple, dict, set, and simple custom object snapshots include capped shallow entries, entry counts, truncation metadata, canvas object interiors, and inspector object details.
- Milestone 8 baseline: timeline speed control, run export, shareable code links, selected object focus, and keyboard-selectable object/variable entities.
- Milestone 9 baseline: GitHub Actions CI, Cloudflare deployment docs, release checklist, Node 22 pin, production smoke script, and verified Pyodide asset layout.

## Recent UI Decisions

- Hybrid view does not render source line cards; line highlighting lives in the editor gutter.
- Loop ring visualization was removed.
- Loop is shown as arrow flow: `range(5) -> i -> total += i`, with a dashed loop-back arrow.
- Object/value display uses traced locals, not hardcoded preview thresholds.
- Stdout is final-step gated in the UI: hidden during intermediate trace steps and shown only at the last recorded step.
- Stdout/stderr trace events also carry output-length snapshots for future prefix reconstruction work.
- SVG arrowheads were reduced in size.
- Export saves a JSON trace bundle for the current run.
- Share writes a `#cv=` URL hash for the current code and copies the link when clipboard access is available.
- Clicking a reference variable or object box pauses playback and focuses that object in the Inspector.

## Important Runtime Details

- User code is compiled as `<user_code>`.
- Trace events are filtered to user frames only.
- Trace event cap is currently `2500`.
- Timeout is `5000ms`.
- SharedArrayBuffer interrupt path is preferred when available; worker restart fallback exists.
- Each trace event stores locals, stdout/stderr prefixes, line, function name, depth, event type, current scope, visible objects, and inferred changes.
- Static analysis is produced from Python `ast` during each run; it currently covers modules, functions, loops, branches, assignments, calls, returns, symbols, and syntax diagnostics.
- Loop visualization should stay arrow/variable based; separate ring/dot trackers were intentionally removed.
- Loop context is inferred in TypeScript from static loop nodes plus runtime line/scope snapshots.
- Function Theater should make calls/recursion readable through stack frames, not by adding source-line cards back into the Hybrid view.
- Timeline dot/range scrubbing now pauses playback before jumping so selected trace steps stay selected.
- Large traces keep the full range slider but window the clickable event rail with skipped-count gaps.
- Object snapshots include shallow entries for list, tuple, dict, set, and simple custom-object attributes, capped at six entries with truncation metadata.
- Hybrid object boxes show compact interiors; Inspector shows the readable object table.
- Playback speed options are `0.5x`, `1x`, `2x`, and `4x`.
- Shared links restore code from a base64url `#cv=` payload on page load.
- Trace exports include `exportedAt`, code, current step, selected example, and the full normalized run result.
- Production builds copy Pyodide runtime files directly to `dist/assets/pyodide/`.
- CI runs typecheck, lint, tests, build, and production smoke checks on pushes to `main` and pull requests.

## Verification

Last verified:

- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run build`
- `npm run smoke`
- `npm run ci`
- `npm run format`

Browser verified:

- Loop example returns `stdout: 10`.
- Timeline has real trace events.
- Editor gutter highlights and jumps to executed lines.
- List alias example shows one list object, two reference arrows, and a point-in-time mutation marker after `same.append(4)`.
- Recursive factorial shows a static program map with function/branch/return nodes, and line 2 highlights the matching `if` node.
- Loop accumulator shows static loop and loop-body assignment nodes, and line 3 highlights the `total += i` node while the loop lane appears.
- Loop lane now shows trace-derived loop source, iteration number, iterator value, and changed variable, e.g. `for i -> iter 2 -> i 1 -> total update 1`.
- Non-loop alias example still shows zero loop lanes while retaining object reference arrows.
- Recursive factorial shows stacked function frames and return transition, e.g. `factorial(n=1) -> return 1`.
- Timeline dots can be clicked during playback without autoplay immediately overriding the selected step.
- Error example focuses `ZeroDivisionError`.
- Infinite loop times out.
- Stdout is hidden at intermediate steps and shown at the final recorded step.
- A 245-step loop/list trace showed 26 rendered timeline buttons with a `219 skipped` gap instead of 245 buttons.
- A 120-item list trace showed object entries in both Hybrid view (`[0] -> 0`, `[1] -> 1`) and Inspector, with `120 items+` truncation metadata.
- Milestone 8 browser pass on list alias verified object focus, selected variable/object styling, `4x` speed selection, URL hash sharing, final-step stdout, and JSON export download.
- Production preview served required COOP/COEP headers, reported `crossOriginIsolated: true`, loaded Pyodide from `/assets/pyodide/`, and produced final stdout `10` for the loop example.

## Known Notes

- Vite production build prints Pyodide browser-compatibility warnings, but build succeeds.
- Object serialization is shallow-structured for common containers and simple custom attributes; recursive expansion/click-to-expand is still future work.
- Mutation markers are point-in-time change indicators, not persistent badges.
- Static map is currently produced on run, not continuously while typing.
- Loop iteration inference is heuristic for now; `for` loops work best, while `while`, break/continue, and deeply nested loop polish remain future work.
- Function Theater currently shows the most recent four stack frames; larger call stacks need scrolling/virtualization or a compressed stack view.
- Export is trace JSON only for now; visualization SVG/PNG export is still future work.
- Share hash is compact base64url JSON, not compressed yet.
- The app is deployment-ready, but the actual live Cloudflare Pages URL still requires connecting the GitHub repository in the user's Cloudflare account.
- Mobile layout is intentionally deferred.

## Next Work

- Continue Milestone 6: improve deep-recursion compression, return-value arrows back to caller, and exception unwinding visuals.
- Continue Milestone 5 later: improve `while`, break/continue, and nested-loop visuals.
- Continue Milestone 7 later: add click-to-expand nested objects and better custom class renderers.
- Continue timeline polish later: add event filters/search and optional virtualized detailed event list.
- Continue Milestone 8 later: add visualization SVG/PNG export, compressed share payloads, and selected-entity detail drawers.
- External launch step: push to GitHub, connect Cloudflare Pages, and run the release checklist against the live URL.
- Post-MVP candidates: JavaScript adapter, guided explanations, export to image/video, and mobile layout.
