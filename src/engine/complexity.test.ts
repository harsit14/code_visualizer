import { describe, expect, it } from 'vitest';
import {
  COMPLEXITY_MAX_GRID_N,
  complexityDimensions,
  complexitySizes,
  defaultComplexityDimension,
} from './complexity';
import type { FunctionInfo, ParamInfo } from './types';

const param = (name: string, inferred: string): ParamInfo => ({
  name,
  inferred,
  annotation: null,
  source: 'hint',
});

const fn = (params: ParamInfo[]): FunctionInfo => ({
  name: 'solve',
  qualname: 'solve',
  className: null,
  params,
  line: 1,
  isGenerator: false,
  docstring: null,
  returns: null,
});

describe('complexityDimensions', () => {
  it('mirrors the engine sizing rules and explains n for each choice', () => {
    const options = complexityDimensions(
      fn([
        param('k', 'int'),
        param('nums', 'list[int]'),
        param('grid', 'grid[str]'),
        param('root', 'tree'),
        param('seen', 'set[int]'),
        param('ratio', 'float'),
      ]),
    );
    expect(options.map((option) => [option.id, option.meaning])).toEqual([
      ['k', 'n = k'],
      ['nums', 'n = len(nums)'],
      ['grid', 'n = rows = columns of grid'],
      ['grid:rows', 'n = len(grid) (rows; columns fixed)'],
      ['grid:cols', 'n = len(grid[0]) (columns; rows fixed)'],
      ['root', 'n = number of nodes in root'],
      ['seen', 'n = len(seen)'],
    ]);
    expect(options.find((option) => option.id === 'grid')?.maxN).toBe(COMPLEXITY_MAX_GRID_N);
  });

  it('defaults to the first sized collection, then to an int', () => {
    expect(
      defaultComplexityDimension(complexityDimensions(fn([param('k', 'int'), param('s', 'str')])))
        ?.id,
    ).toBe('s');
    expect(defaultComplexityDimension(complexityDimensions(fn([param('n', 'int')])))?.id).toBe('n');
    expect(defaultComplexityDimension(complexityDimensions(null))).toBeNull();
  });
});

describe('complexitySizes', () => {
  it('spaces sizes geometrically between the chosen bounds', () => {
    expect(complexitySizes(4, 64, 5)).toEqual([4, 8, 16, 32, 64]);
    expect(complexitySizes(8, 1024, 8)).toEqual([8, 16, 32, 64, 128, 256, 512, 1024]);
  });

  it('never repeats sizes or goes below one', () => {
    expect(complexitySizes(2, 4, 6)).toEqual([2, 3, 4]);
    expect(complexitySizes(0, 16, 3)).toEqual([1, 4, 16]);
    expect(complexitySizes(32, 16, 4)).toEqual([32]);
  });
});
