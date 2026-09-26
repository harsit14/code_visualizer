/**
 * Complexity experiment choices shown before a measurement runs: which
 * inputs can grow and which sizes a range samples.
 *
 * The dimension rules mirror engine/codeviz/complexity.py (`size_dimensions`),
 * which validates the choice again and reports the `meaning` it used.
 */
import type { ComplexityAxis, ComplexitySample, FunctionInfo } from './types';

export const COMPLEXITY_MAX_N = 1024;
/** A square grid grows with n², so its largest side stays small. */
export const COMPLEXITY_MAX_GRID_N = 64;
export const SMALLEST_N_CHOICES = [2, 4, 8, 16, 32] as const;
export const LARGEST_N_CHOICES = [16, 32, 64, 128, 256, 512, 1024] as const;
export const SAMPLE_COUNT_CHOICES = [3, 4, 5, 6, 7, 8] as const;
export const DEFAULT_SMALLEST_N = 4;
export const DEFAULT_LARGEST_N = 64;
export const DEFAULT_SAMPLE_COUNT = 5;

export type ComplexityDimensionOption = {
  id: string;
  param: string;
  axis: ComplexityAxis;
  /** What n stands for, e.g. `n = len(nums)`. */
  meaning: string;
  maxN: number;
  isCollection: boolean;
};

const LENGTH_KINDS = new Set([
  'list[int]',
  'list[float]',
  'list[str]',
  'pairs',
  'str',
  'dict',
  'set[int]',
  'set[str]',
]);
const GRID_KINDS = new Set(['grid', 'grid[int]', 'grid[str]']);

function option(
  param: string,
  axis: ComplexityAxis,
  meaning: string,
  maxN = COMPLEXITY_MAX_N,
): ComplexityDimensionOption {
  return {
    id: axis === 'rows' || axis === 'cols' ? `${param}:${axis}` : param,
    param,
    axis,
    meaning,
    maxN,
    isCollection: axis !== 'value',
  };
}

/** Every way the function's inputs could grow, in parameter order. */
export function complexityDimensions(fn: FunctionInfo | null): ComplexityDimensionOption[] {
  if (!fn) return [];
  return fn.params.flatMap((param) => {
    const { name, inferred } = param;
    if (LENGTH_KINDS.has(inferred)) return [option(name, 'len', `n = len(${name})`)];
    if (GRID_KINDS.has(inferred))
      return [
        option(name, 'both', `n = rows = columns of ${name}`, COMPLEXITY_MAX_GRID_N),
        option(name, 'rows', `n = len(${name}) (rows; columns fixed)`),
        option(name, 'cols', `n = len(${name}[0]) (columns; rows fixed)`),
      ];
    if (inferred === 'tree' || inferred === 'listnode')
      return [option(name, 'nodes', `n = number of nodes in ${name}`)];
    if (inferred === 'int') return [option(name, 'value', `n = ${name}`)];
    return [];
  });
}

/** The engine's default: the first sized collection, else the first int. */
export function defaultComplexityDimension(
  options: ComplexityDimensionOption[],
): ComplexityDimensionOption | null {
  return options.find((candidate) => candidate.isCollection) ?? options[0] ?? null;
}

/** Only finished samples feed the fit; older payloads have no status. */
export function isOkSample(sample: ComplexitySample): boolean {
  return (sample.status ?? 'ok') === 'ok';
}

/** `count` geometrically spaced whole sizes from `smallest` to `largest`. */
export function complexitySizes(smallest: number, largest: number, count: number): number[] {
  const low = Math.max(1, Math.round(smallest));
  const high = Math.max(low, Math.round(largest));
  if (count <= 1 || high === low) return [high];
  const ratio = high / low;
  const sizes = new Set<number>();
  for (let index = 0; index < count; index += 1) {
    sizes.add(Math.round(low * ratio ** (index / (count - 1))));
  }
  return [...sizes].sort((a, b) => a - b);
}
