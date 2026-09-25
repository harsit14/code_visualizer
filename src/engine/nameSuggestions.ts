/**
 * "Did you mean …?" hints for JavaScript ReferenceErrors, matching the hints
 * the Python engine adds to NameError and AttributeError messages.
 */

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const NOT_DEFINED = /^([A-Za-z_$][\w$]*) is not defined$/;
// Same threshold as the Python engine's difflib cutoff.
const MIN_SIMILARITY = 0.75;

/** Edit distance where swapping two adjacent characters counts as one edit. */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/** The most similar candidate, or null when none is close enough. */
export function closestName(name: string, candidates: Iterable<string>): string | null {
  let best: string | null = null;
  let bestScore = MIN_SIMILARITY;
  for (const candidate of new Set(candidates)) {
    if (candidate === name || candidate.startsWith('__') || !IDENTIFIER.test(candidate)) {
      continue;
    }
    const longest = Math.max(name.length, candidate.length);
    // Cheap rejection: the length gap alone is already too many edits.
    if (1 - Math.abs(name.length - candidate.length) / longest < bestScore) continue;
    const score = 1 - editDistance(name, candidate) / longest;
    if (score > bestScore || (score === bestScore && best === null)) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/** Names reachable through the global object, including inherited ones. */
export function globalNames(): string[] {
  const names: string[] = [];
  for (
    let current: object | null = globalThis;
    current && current !== Object.prototype;
    current = Object.getPrototypeOf(current)
  ) {
    names.push(...Object.getOwnPropertyNames(current));
  }
  return names;
}

/** Adds a suggestion to a ReferenceError message when a close name exists. */
export function withNameSuggestion<T extends { type: string; msg: string }>(
  info: T,
  candidates: () => Iterable<string>,
): T {
  if (info.type !== 'ReferenceError' || info.msg.includes('Did you mean')) return info;
  const missing = NOT_DEFINED.exec(info.msg)?.[1];
  if (!missing) return info;
  const suggestion = closestName(missing, candidates());
  return suggestion ? { ...info, msg: `${info.msg}. Did you mean '${suggestion}'?` } : info;
}
