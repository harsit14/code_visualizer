/**
 * Compares a baseline run with the current run of (usually) edited code.
 *
 * Line numbers move between versions, so the runs are aligned by milestones
 * instead: calls, returns and exceptions keyed by function name, call depth
 * and occurrence. Inside each matched call the sequence of values every
 * variable takes is compared, so the first differing value is found even when
 * the statement that produced it moved. Printed output is compared by text.
 * Values are compared structurally with object ids removed, and shown with
 * the usual one-line formatting.
 */
import { describeStepChange } from './stepChange';
import { expandSelf, formatValue } from './trace';
import type {
  EncodedValue,
  FrameSnapshot,
  GeneratedInputInfo,
  Language,
  SessionResult,
  TraceStep,
} from './types';

export type ComparedRun = { language: Language; result: SessionResult };

export type RunOutcome =
  | { kind: 'return'; value: string }
  | { kind: 'exception'; type: string; message: string }
  | { kind: 'finished' }
  | { kind: 'stopped'; reason: string };

export type RunSummary = {
  steps: number;
  maxDepth: number;
  /** Calls per function, most frequent first. */
  calls: { name: string; count: number }[];
  output: string;
  outcome: RunOutcome;
  truncated: boolean;
  truncationReason: string | null;
  functionName: string | null;
  inputs: GeneratedInputInfo[];
};

export type DivergenceKind = 'call' | 'exception' | 'return' | 'variable' | 'output';

export type DivergenceSide = {
  /** Step to show for this side of the divergence. */
  step: number;
  /** Source line that produced the state at `step`. */
  line: number;
  /** What this run did or held at the divergence, already formatted. */
  value: string;
};

export type RunDivergence = {
  kind: DivergenceKind;
  /** Plain-language description naming the function and variable. */
  summary: string;
  func: string | null;
  variable: string | null;
  baseline: DivergenceSide;
  current: DivergenceSide;
};

export type RunComparisonVerdict = 'same' | 'same-outcome' | 'different' | 'incomplete';

export type RunComparison =
  | { comparable: false; reason: string }
  | {
      comparable: true;
      /**
       * `same`: nothing diverged. `same-outcome`: the final result and output
       * match but the runs took different paths. `different`: the runs
       * diverged and did not finish the same way. `incomplete`: nothing diverged
       * in the recorded steps, but a run was cut short by a limit.
       */
      verdict: RunComparisonVerdict;
      baseline: RunSummary;
      current: RunSummary;
      inputsDiffer: boolean;
      divergence: RunDivergence | null;
      /** Why the comparison covers only part of a run, if it does. */
      limitNote: string | null;
    };

const LANGUAGE_LABELS: Record<Language, string> = {
  python: 'Python',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
};
const MODULE = '<module>';
const PREVIEW_LIMIT = 60;
const KIND_ORDER: Record<DivergenceKind, number> = {
  call: 0,
  exception: 1,
  return: 2,
  variable: 3,
  output: 4,
};
const ADDRESS = / at 0x[0-9a-f]+/gi;

// ------------------------------------------------------------------ values

function isUnordered(value: Extract<EncodedValue, { k: 'seq' }>): boolean {
  return value.t === 'set' || value.t === 'frozenset' || value.t === 'Set';
}

/** Structural form without object ids, so equal values from two runs compare equal. */
function canonical(value: EncodedValue | null | undefined): unknown {
  if (!value) return null;
  switch (value.k) {
    case 'seq': {
      const items = value.items.map((item) => JSON.stringify(canonical(item)));
      // Sets have no order; a truncated preview cannot be reordered safely.
      if (isUnordered(value) && !value.truncated) items.sort();
      return ['seq', value.t, items, value.len, value.truncated];
    }
    case 'dict': {
      const entries = value.entries.map(([key, item]) =>
        JSON.stringify([canonical(key), canonical(item)]),
      );
      // Two dicts with the same entries are equal whatever order they were filled in.
      if (!value.truncated) entries.sort();
      return ['dict', value.t ?? 'dict', entries, value.len, value.truncated];
    }
    case 'tree':
      return ['tree', canonical(value.val), canonical(value.left), canonical(value.right)];
    case 'listnode':
      return [
        'listnode',
        value.nodes.map((node) => canonical(node.val)),
        value.cyclic,
        value.truncated,
      ];
    case 'obj':
      return [
        'obj',
        value.t,
        Object.entries(value.attrs).map(([name, attr]) => [name, canonical(attr)]),
      ];
    case 'ref':
      return ['ref'];
    case 'repr':
      return ['repr', value.t, value.v.replace(ADDRESS, '')];
    default:
      return value;
  }
}

function valueKey(value: EncodedValue | null | undefined): string {
  return JSON.stringify(canonical(value));
}

function preview(value: EncodedValue | null | undefined): string {
  const text = formatValue(value) || 'None';
  return text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT - 1)}…` : text;
}

// ------------------------------------------------------------------ indexing

type TimelineEntry = { key: string; value: EncodedValue; step: number };

type Invocation = {
  key: string;
  name: string;
  callStep: number;
  lastStep: number;
  endStep: number | null;
  frame: FrameSnapshot;
  timelines: Map<string, TimelineEntry[]>;
};

type Milestone = {
  kind: 'call' | 'return' | 'exception';
  key: string;
  step: number;
  invocation: Invocation;
  ret?: EncodedValue;
  exc?: { type: string; msg: string };
};

type RunIndex = {
  steps: readonly TraceStep[];
  /** A limit stopped the run, so missing milestones or output prove nothing. */
  truncated: boolean;
  milestones: Milestone[];
  maxDepth: number;
  calls: Map<string, number>;
};

function recordLocals(invocation: Invocation, frame: FrameSnapshot, step: number) {
  for (const [name, value] of Object.entries(expandSelf(frame.locals))) {
    // Function objects are definitions, not state that can diverge.
    if (value.k === 'func') continue;
    const key = valueKey(value);
    const entries = invocation.timelines.get(name);
    if (!entries) {
      invocation.timelines.set(name, [{ key, value, step }]);
    } else if (entries[entries.length - 1].key !== key) {
      entries.push({ key, value, step });
    }
  }
}

/**
 * One pass over the trace. Each call opens an invocation; frame ids can be
 * reused after a frame ends, so a call event always starts a new one. Only
 * the top frame is recorded: callers' values are picked up when they resume.
 */
function indexRun(steps: readonly TraceStep[], truncated: boolean): RunIndex {
  const milestones: Milestone[] = [];
  const calls = new Map<string, number>();
  const active = new Map<string, Invocation>();
  const occurrences = new Map<string, number>();
  let maxDepth = 0;

  steps.forEach((step, index) => {
    const depth = step.stack.length;
    maxDepth = Math.max(maxDepth, depth);
    const top = step.stack[depth - 1];
    if (!top) return;
    let invocation = active.get(top.id);
    if (step.event === 'call' || !invocation) {
      const name = top.qualname ?? top.func;
      const slot = `${name}@${depth}`;
      const occurrence = occurrences.get(slot) ?? 0;
      occurrences.set(slot, occurrence + 1);
      invocation = {
        key: `${slot}#${occurrence}`,
        name,
        callStep: index,
        lastStep: index,
        endStep: null,
        frame: top,
        timelines: new Map(),
      };
      active.set(top.id, invocation);
      milestones.push({ kind: 'call', key: `call ${invocation.key}`, step: index, invocation });
      if (step.event === 'call' && name !== MODULE) calls.set(name, (calls.get(name) ?? 0) + 1);
    }
    invocation.lastStep = index;
    if (!top.elided) recordLocals(invocation, top, index);
    if (step.event === 'return') {
      invocation.endStep = index;
      milestones.push({
        kind: 'return',
        key: `return ${invocation.key}`,
        step: index,
        invocation,
        ret: step.ret,
      });
    } else if (step.event === 'exception') {
      const exc = step.exc ?? { type: 'Exception', msg: '' };
      milestones.push({
        kind: 'exception',
        key: `raise ${exc.type} ${invocation.key}`,
        step: index,
        invocation,
        exc,
      });
    }
  });
  return { steps, truncated, milestones, maxDepth, calls };
}

// ------------------------------------------------------------------ summaries

function outcomeOf(result: SessionResult): RunOutcome {
  const run = result.run!;
  const failure = run.exception ?? run.setupError ?? null;
  if (failure) return { kind: 'exception', type: failure.type, message: failure.msg };
  if (run.truncated) return { kind: 'stopped', reason: run.truncationReason ?? 'A limit was hit.' };
  if (run.returnValue) return { kind: 'return', value: formatValue(run.returnValue) || 'None' };
  return { kind: 'finished' };
}

function outcomeKey(result: SessionResult): string {
  const run = result.run!;
  const failure = run.exception ?? run.setupError ?? null;
  if (failure) return `raise ${failure.type}: ${failure.msg}`;
  return `return ${valueKey(run.returnValue)}`;
}

function summarize(result: SessionResult, index: RunIndex): RunSummary {
  const run = result.run!;
  return {
    steps: run.steps.length,
    maxDepth: index.maxDepth,
    calls: [...index.calls]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    output: run.stdout,
    outcome: outcomeOf(result),
    truncated: run.truncated,
    truncationReason: run.truncationReason,
    functionName: run.functionName,
    inputs: run.inputs,
  };
}

/** One-line description of how a run ended. */
export function describeOutcome(outcome: RunOutcome): string {
  switch (outcome.kind) {
    case 'return':
      return `Returned ${outcome.value}`;
    case 'exception':
      return `Raised ${outcome.type}${outcome.message ? `: ${outcome.message}` : ''}`;
    case 'stopped':
      return `Stopped early: ${outcome.reason}`;
    default:
      return 'Finished';
  }
}

// ------------------------------------------------------------------ divergence

type Candidate = RunDivergence;

/** A divergence side; its line is filled in once the earliest candidate is known. */
function side(index: RunIndex, step: number, value: string): DivergenceSide {
  return { step: Math.max(0, Math.min(step, index.steps.length - 1)), line: 0, value };
}

function withLine(index: RunIndex, point: DivergenceSide): DivergenceSide {
  const line = describeStepChange(index.steps, point.step)?.line ?? index.steps[point.step]?.line;
  return { ...point, line: line ?? 0 };
}

function callLabel(invocation: Invocation): string {
  const name = invocation.name;
  if (name === MODULE) return 'the module';
  const args = Object.entries(invocation.frame.locals)
    .filter(([arg, value]) => arg !== 'self' && arg !== 'this' && value.k !== 'func')
    .slice(0, 3)
    .map(([arg, value]) => `${arg}=${preview(value)}`);
  return `${name}(${args.join(', ')})`;
}

function frameLabel(invocation: Invocation): string {
  return invocation.name === MODULE ? 'the module' : `${invocation.name}()`;
}

function milestoneAction(milestone: Milestone | undefined): string {
  if (!milestone) return 'finished';
  if (milestone.kind === 'call') return `called ${callLabel(milestone.invocation)}`;
  if (milestone.kind === 'exception') {
    return `raised ${milestone.exc!.type}${milestone.exc!.msg ? `: ${milestone.exc!.msg}` : ''}`;
  }
  return milestone.invocation.name === MODULE
    ? 'finished the module'
    : `returned ${preview(milestone.ret)} from ${callLabel(milestone.invocation)}`;
}

function variableCandidate(
  baseline: RunIndex,
  current: RunIndex,
  base: Invocation,
  next: Invocation,
): Candidate | null {
  let best: Candidate | null = null;
  const frame = frameLabel(next);
  for (const [name, currentEntries] of next.timelines) {
    const baseEntries = base.timelines.get(name);
    if (!baseEntries) continue;
    const shared = Math.min(baseEntries.length, currentEntries.length);
    let index = 0;
    while (index < shared && baseEntries[index].key === currentEntries[index].key) index += 1;
    if (index < shared) {
      const was = preview(baseEntries[index].value);
      const now = preview(currentEntries[index].value);
      const received = index === 0 && currentEntries[0].step === next.callStep;
      best = first(best, {
        kind: 'variable',
        summary: received
          ? `${frame} received ${name} = ${now} in the current run; the baseline received ${was}.`
          : `In ${frame}, ${name} became ${now} in the current run where the baseline had ${was}.`,
        func: next.name,
        variable: name,
        baseline: side(baseline, baseEntries[index].step, was),
        current: side(current, currentEntries[index].step, now),
      });
      continue;
    }
    if (baseEntries.length === currentEntries.length) continue;
    // One run kept changing the variable after the other stopped. That is only
    // a divergence when the shorter call really ended, not when a limit cut it.
    const longerIsCurrent = currentEntries.length > baseEntries.length;
    const shortIndex = longerIsCurrent ? baseline : current;
    const shortCall = longerIsCurrent ? base : next;
    const shortEntries = longerIsCurrent ? baseEntries : currentEntries;
    const longEntries = longerIsCurrent ? currentEntries : baseEntries;
    if (shortCall.endStep === null && shortIndex.truncated) continue;
    const kept = preview(shortEntries[shortEntries.length - 1].value);
    const went = preview(longEntries[index].value);
    const shortSide = side(shortIndex, shortCall.endStep ?? shortCall.lastStep, kept);
    const longSide = side(longerIsCurrent ? current : baseline, longEntries[index].step, went);
    best = first(best, {
      kind: 'variable',
      summary: longerIsCurrent
        ? `In ${frame}, ${name} went on to ${went} in the current run, but stayed ${kept} in the baseline.`
        : `In ${frame}, ${name} went on to ${went} in the baseline, but stayed ${kept} in the current run.`,
      func: next.name,
      variable: name,
      baseline: longerIsCurrent ? shortSide : longSide,
      current: longerIsCurrent ? longSide : shortSide,
    });
  }
  return best;
}

function earlier(a: Candidate, b: Candidate): boolean {
  if (a.current.step !== b.current.step) return a.current.step < b.current.step;
  if (a.baseline.step !== b.baseline.step) return a.baseline.step < b.baseline.step;
  return KIND_ORDER[a.kind] < KIND_ORDER[b.kind];
}

/** Orders by the current run's step, then the baseline's, then by kind. */
function first(best: Candidate | null, candidate: Candidate | null): Candidate | null {
  if (!best) return candidate;
  return candidate && earlier(candidate, best) ? candidate : best;
}

function structuralCandidate(
  baseline: RunIndex,
  current: RunIndex,
  base: Milestone | undefined,
  next: Milestone | undefined,
): Candidate | null {
  if (!base && !next) return null;
  // A run that stopped at a limit has no further milestones; that is not a difference.
  if ((!base && baseline.truncated) || (!next && current.truncated)) return null;
  const baseStep = base?.step ?? baseline.steps.length - 1;
  const nextStep = next?.step ?? current.steps.length - 1;
  const baseAction = milestoneAction(base);
  const nextAction = milestoneAction(next);
  const sides = {
    baseline: side(baseline, baseStep, baseAction),
    current: side(current, nextStep, nextAction),
  };
  const exception = next?.kind === 'exception' ? next : base?.kind === 'exception' ? base : null;
  if (exception) {
    const where = frameLabel(exception.invocation);
    const summary =
      base?.kind === 'exception' && next?.kind === 'exception'
        ? `The baseline ${baseAction} but the current run ${nextAction} in ${where}.`
        : exception === next
          ? `Only the current run raised an exception: it ${nextAction} in ${where}; the baseline ${baseAction}.`
          : `Only the baseline raised an exception: it ${baseAction} in ${where}; the current run ${nextAction}.`;
    return {
      kind: 'exception',
      summary,
      func: exception.invocation.name,
      variable: null,
      ...sides,
    };
  }
  const call = next?.kind === 'call' ? next : base?.kind === 'call' ? base : null;
  const summary =
    base?.kind === 'call' && next?.kind === 'call'
      ? `The runs made different calls: the baseline ${baseAction}; the current run ${nextAction}.`
      : call === next
        ? `Only the current run ${nextAction}; at that point the baseline ${baseAction}.`
        : call === base
          ? `Only the baseline ${baseAction}; at that point the current run ${nextAction}.`
          : `The runs took different paths: the baseline ${baseAction}; the current run ${nextAction}.`;
  return {
    kind: 'call',
    summary,
    func: call?.invocation.name ?? null,
    variable: null,
    ...sides,
  };
}

function outputLine(text: string, offset: number): { number: number; text: string | null } {
  const number = text.slice(0, offset).split('\n').length;
  if (offset >= text.length) return { number, text: null };
  const start = text.lastIndexOf('\n', offset - 1) + 1;
  const end = text.indexOf('\n', offset);
  return { number, text: text.slice(start, end < 0 ? undefined : end) };
}

function outputStep(steps: readonly TraceStep[], offset: number): number {
  const index = steps.findIndex((step) => step.stdoutLen > offset);
  return index < 0 ? steps.length - 1 : index;
}

function outputCandidate(
  baseline: RunIndex,
  current: RunIndex,
  baseText: string,
  nextText: string,
): Candidate | null {
  if (baseText === nextText) return null;
  let offset = 0;
  const shared = Math.min(baseText.length, nextText.length);
  while (offset < shared && baseText[offset] === nextText[offset]) offset += 1;
  if (offset === baseText.length && baseline.truncated) return null;
  if (offset === nextText.length && current.truncated) return null;
  const was = outputLine(baseText, offset);
  const now = outputLine(nextText, offset);
  const quote = (line: { text: string | null }) =>
    line.text === null ? 'nothing more' : `"${line.text}"`;
  return {
    kind: 'output',
    summary: `Printed output first differs on output line ${now.number}: the baseline printed ${quote(was)}, the current run printed ${quote(now)}.`,
    func: null,
    variable: null,
    baseline: side(baseline, outputStep(baseline.steps, offset), quote(was)),
    current: side(current, outputStep(current.steps, offset), quote(now)),
  };
}

function findDivergence(
  baseline: RunIndex,
  current: RunIndex,
  baseOutput: string,
  nextOutput: string,
): RunDivergence | null {
  let best: Candidate | null = null;

  best = first(best, outputCandidate(baseline, current, baseOutput, nextOutput));
  const length = Math.max(baseline.milestones.length, current.milestones.length);
  for (let index = 0; index < length; index += 1) {
    const base = baseline.milestones[index];
    const next = current.milestones[index];
    // Milestones are in step order, so nothing from here on can come first.
    if (best && next && next.step > best.current.step) break;
    if (!base || !next || base.key !== next.key) {
      best = first(best, structuralCandidate(baseline, current, base, next));
      // Past the first structural difference the runs no longer line up.
      break;
    }
    if (base.kind === 'call') {
      best = first(best, variableCandidate(baseline, current, base.invocation, next.invocation));
    } else if (base.kind === 'return' && valueKey(base.ret) !== valueKey(next.ret)) {
      const was = preview(base.ret);
      const now = preview(next.ret);
      best = first(best, {
        kind: 'return',
        summary: `${callLabel(next.invocation)} returned ${now} in the current run; the baseline returned ${was}.`,
        func: next.invocation.name,
        variable: null,
        baseline: side(baseline, base.step, was),
        current: side(current, next.step, now),
      });
    } else if (base.kind === 'exception' && base.exc!.msg !== next.exc!.msg) {
      best = first(best, structuralCandidate(baseline, current, base, next));
    }
  }

  return best
    ? {
        ...best,
        baseline: withLine(baseline, best.baseline),
        current: withLine(current, best.current),
      }
    : null;
}

// ------------------------------------------------------------------ entry point

function missingRunReason(result: SessionResult, label: string): string {
  if (result.status === 'timeout') {
    return `The ${label} timed out before producing a trace. Run it again to compare.`;
  }
  const error = result.error ? ` (${result.error.type}: ${result.error.msg})` : '';
  return `The ${label} stopped before producing a trace${error}. Fix it and run again to compare.`;
}

/** Compares two completed runs and finds where they first differ. */
export function compareRuns(baseline: ComparedRun, current: ComparedRun): RunComparison {
  if (baseline.language !== current.language) {
    return {
      comparable: false,
      reason: `The baseline is ${LANGUAGE_LABELS[baseline.language]} and the current run is ${LANGUAGE_LABELS[current.language]}. Only runs in the same language can be compared.`,
    };
  }
  if (!baseline.result.run) {
    return { comparable: false, reason: missingRunReason(baseline.result, 'baseline') };
  }
  if (!current.result.run) {
    return { comparable: false, reason: missingRunReason(current.result, 'current run') };
  }

  const baseRun = baseline.result.run;
  const nextRun = current.result.run;
  const baseIndex = indexRun(baseRun.steps, baseRun.truncated);
  const nextIndex = indexRun(nextRun.steps, nextRun.truncated);
  let divergence =
    baseRun.steps.length && nextRun.steps.length
      ? findDivergence(baseIndex, nextIndex, baseRun.stdout, nextRun.stdout)
      : null;

  const complete = !baseRun.truncated && !nextRun.truncated;
  const sameOutcome =
    complete &&
    outcomeKey(baseline.result) === outcomeKey(current.result) &&
    baseRun.stdout === nextRun.stdout;
  const baseSummary = summarize(baseline.result, baseIndex);
  const nextSummary = summarize(current.result, nextIndex);

  if (!divergence && complete && !sameOutcome) {
    // The traces agree but the recorded results do not (for example an empty
    // trace); report the final results so a difference is never hidden.
    const was = describeOutcome(baseSummary.outcome);
    const now = describeOutcome(nextSummary.outcome);
    divergence = {
      kind:
        baseSummary.outcome.kind === 'exception' || nextSummary.outcome.kind === 'exception'
          ? 'exception'
          : 'return',
      summary: `The runs finished differently: the baseline ${was.toLowerCase()}; the current run ${now.toLowerCase()}.`,
      func: nextRun.functionName,
      variable: null,
      baseline: side(baseIndex, baseRun.steps.length - 1, was),
      current: side(nextIndex, nextRun.steps.length - 1, now),
    };
  }

  const limitNote = complete
    ? null
    : `${
        baseRun.truncated && nextRun.truncated
          ? 'Both runs'
          : baseRun.truncated
            ? 'The baseline'
            : 'The current run'
      } stopped at a limit (${(baseRun.truncated ? baseRun : nextRun).truncationReason ?? 'too many steps'}), so only the recorded steps were compared.`;

  return {
    comparable: true,
    verdict: divergence
      ? sameOutcome
        ? 'same-outcome'
        : 'different'
      : complete
        ? 'same'
        : 'incomplete',
    baseline: baseSummary,
    current: nextSummary,
    inputsDiffer:
      JSON.stringify(baseRun.inputs.map((input) => input.literal)) !==
      JSON.stringify(nextRun.inputs.map((input) => input.literal)),
    divergence,
    limitNote,
  };
}
