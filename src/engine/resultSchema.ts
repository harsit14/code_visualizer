import type { Language, SessionResult } from './types';

const MAX_STEPS = 10_000;
const MAX_NODES = 500_000;
const MAX_DEPTH = 40;
type RecordValue = Record<string, unknown>;

const record = (v: unknown): v is RecordValue =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string';
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const integer = (v: unknown): v is number => number(v) && Number.isSafeInteger(v) && v >= 0;
const nullableString = (v: unknown) => v === null || str(v);
const nullableNumber = (v: unknown) => v === null || number(v);
const bool = (v: unknown) => typeof v === 'boolean';
const list = (v: unknown, check: (item: unknown) => boolean): boolean =>
  Array.isArray(v) && v.every((item) => check(item));
const optional = (v: unknown, check: (item: unknown) => boolean) => v === undefined || check(v);
const oneOf = (v: unknown, values: readonly unknown[]) => values.includes(v);

function dictionary(v: unknown, check: (item: unknown) => boolean): boolean {
  return (
    record(v) && !Object.hasOwn(v, '__proto__') && Object.values(v).every((item) => check(item))
  );
}

export function isEngineError(v: unknown): boolean {
  return (
    v === null ||
    (record(v) &&
      str(v.type) &&
      str(v.msg) &&
      optional(v.line, integer) &&
      optional(v.traceback, str))
  );
}

export function isAnalysisInfo(v: unknown): boolean {
  if (v === null) return true;
  const pointers = (item: unknown) => dictionary(item, (names) => list(names, str));
  const assignments = (item: unknown) =>
    list(
      item,
      (hint) =>
        record(hint) &&
        str(hint.target) &&
        integer(hint.line) &&
        str(hint.statement) &&
        list(hint.sources, str),
    );
  return (
    record(v) &&
    oneOf(v.mode, ['script', 'function', 'empty']) &&
    nullableString(v.defaultFunction) &&
    ['definesTreeNode', 'definesListNode', 'referencesTreeNode', 'referencesListNode'].every((k) =>
      bool(v[k]),
    ) &&
    list(
      v.diagnostics,
      (d) =>
        record(d) &&
        oneOf(d.severity, ['error', 'warning', 'info']) &&
        str(d.message) &&
        optional(d.line, integer) &&
        optional(d.column, integer),
    ) &&
    optional(v.modulePointerHints, pointers) &&
    optional(v.moduleAssignmentHints, assignments) &&
    list(
      v.functions,
      (f) =>
        record(f) &&
        str(f.name) &&
        str(f.qualname) &&
        nullableString(f.className) &&
        integer(f.line) &&
        bool(f.isGenerator) &&
        nullableString(f.docstring) &&
        nullableString(f.returns) &&
        optional(f.constructorParamCount, integer) &&
        optional(f.binding, (b) => oneOf(b, ['function', 'instance', 'class', 'static'])) &&
        optional(f.pointerHints, pointers) &&
        optional(f.assignmentHints, assignments) &&
        list(
          f.params,
          (p) =>
            record(p) &&
            str(p.name) &&
            nullableString(p.annotation) &&
            str(p.inferred) &&
            oneOf(p.source, ['hint', 'usage', 'name', 'default']) &&
            optional(p.kind, (k) =>
              oneOf(k, [
                'positional_only',
                'positional_or_keyword',
                'var_positional',
                'keyword_only',
                'var_keyword',
              ]),
            ),
        ),
    )
  );
}

export function validateSessionResult(result: unknown, language: Language): SessionResult {
  if (
    !record(result) ||
    !oneOf(result.status, ['ok', 'error', 'timeout']) ||
    !oneOf(result.mode, ['script', 'function', 'empty']) ||
    !isAnalysisInfo(result.analysis) ||
    !isEngineError(result.error) ||
    !optional(result.durationMs, number) ||
    !optional(result.pyodideVersion, str)
  ) {
    throw new Error('Invalid trace result or analysis.');
  }
  let nodes = 0;
  const value = (v: unknown, depth = 0): boolean => {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH || !record(v)) return false;
    const child = (c: unknown) => value(c, depth + 1);
    const id = () => integer(v.id);
    switch (v.k) {
      case 'none':
        return true;
      case 'num':
        return str(v.t) && str(v.v);
      case 'str':
        return str(v.v) && bool(v.truncated) && optional(v.len, integer);
      case 'seq':
        return id() && str(v.t) && integer(v.len) && bool(v.truncated) && list(v.items, child);
      case 'dict':
        return (
          id() &&
          optional(v.t, str) &&
          integer(v.len) &&
          bool(v.truncated) &&
          list(
            v.entries,
            (entry) => Array.isArray(entry) && entry.length === 2 && entry.every(child),
          )
        );
      case 'tree':
        return (
          id() &&
          child(v.val) &&
          (v.left === null || child(v.left)) &&
          (v.right === null || child(v.right))
        );
      case 'listnode':
        return (
          id() &&
          bool(v.cyclic) &&
          bool(v.truncated) &&
          list(v.nodes, (n) => record(n) && integer(n.id) && child(n.val))
        );
      case 'func':
        return str(v.name);
      case 'obj':
        return id() && str(v.t) && str(v.preview) && dictionary(v.attrs, child);
      case 'ref':
        return id();
      case 'repr':
        return str(v.t) && str(v.v) && optional(v.id, integer);
      default:
        return false;
    }
  };
  const run = result.run;
  if (run !== null) {
    if (
      !record(run) ||
      !Array.isArray(run.steps) ||
      run.steps.length > MAX_STEPS ||
      !nullableString(run.functionName) ||
      !nullableNumber(run.seed) ||
      !list(run.inputs, (i) => record(i) && str(i.name) && str(i.type) && str(i.literal)) ||
      !(run.returnValue === null || value(run.returnValue)) ||
      !isEngineError(run.exception) ||
      !optional(run.setupError, isEngineError) ||
      !str(run.stdout) ||
      !str(run.stderr) ||
      !integer(run.opCount) ||
      !optional(run.runtimeMs, number) ||
      !optional(run.memoryMb, nullableNumber) ||
      !optional(run.memoryIsEstimate, bool) ||
      !bool(run.truncated) ||
      !nullableString(run.truncationReason) ||
      !optional(
        run.assessment,
        (a) =>
          record(a) &&
          oneOf(a.status, ['pass', 'fail', 'invalid', 'inconclusive', 'unscored']) &&
          nullableString(a.message) &&
          nullableString(a.actualLiteral) &&
          nullableString(a.expected),
      )
    ) {
      throw new Error('Invalid or oversized trace run. The current workspace was kept.');
    }
    for (const [index, s] of run.steps.entries()) {
      if (
        !record(s) ||
        s.i !== index ||
        !oneOf(s.event, ['call', 'line', 'return', 'exception']) ||
        !optional(s.phase, (p) => oneOf(p, ['before', 'after', 'event'])) ||
        !integer(s.line) ||
        !str(s.func) ||
        !integer(s.stdoutLen) ||
        s.stdoutLen > run.stdout.length ||
        !dictionary(s.globals, value) ||
        !optional(s.ret, value) ||
        !optional(s.exc, (e) => e !== null && isEngineError(e)) ||
        !list(
          s.stack,
          (f) =>
            record(f) &&
            str(f.id) &&
            str(f.func) &&
            integer(f.line) &&
            dictionary(f.locals, value) &&
            optional(f.qualname, str) &&
            optional(f.elided, bool),
        )
      ) {
        throw new Error(
          `Invalid trace snapshot at step ${index + 1}. The current workspace was kept.`,
        );
      }
      s.phase ??= s.event === 'line' ? (language === 'python' ? 'before' : 'after') : 'event';
    }
    run.runtimeMs ??= 0;
    run.memoryMb ??= null;
  }
  result.durationMs ??= 0;
  return result as SessionResult;
}
