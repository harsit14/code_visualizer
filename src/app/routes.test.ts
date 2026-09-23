import { describe, expect, it } from 'vitest';
import { dashboardPath, isDashboardLocation, landingPath } from './routes';
import { canWarmUpWhileIdle } from './warmup';

const at = (pathname: string, search = '', hash = '') => ({ pathname, search, hash });

describe('routes', () => {
  it('uses the build base path', () => {
    expect(landingPath).toBe('/');
    expect(dashboardPath).toBe('/app');
  });

  it.each([
    [at('/app'), true],
    [at('/app/'), true],
    [at('/', '?embed=1'), true],
    [at('/', '', '#cv=abc'), true],
    [at('/'), false],
    [at('/apple'), false],
  ])('%j opens the dashboard: %s', (location, expected) => {
    expect(isDashboardLocation(location)).toBe(expected);
  });
});

describe('canWarmUpWhileIdle', () => {
  it.each([
    [{ effectiveType: '4g', saveData: false }, true],
    [{ effectiveType: '4g', saveData: true }, false],
    [{ effectiveType: '3g' }, false],
    [undefined, false],
  ])('%j → %s', (connection, expected) => {
    expect(canWarmUpWhileIdle(connection)).toBe(expected);
  });
});
