import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Pyodide worker bundle', () => {
  it('ships every Python engine module', () => {
    const worker = readFileSync('src/engine/pyodideWorker.ts', 'utf8');
    const modules = readdirSync('engine/codeviz').filter((file) => file.endsWith('.py'));
    for (const module of modules) {
      expect(worker, `${module} is not bundled into the worker`).toContain(
        `engine/codeviz/${module}?raw`,
      );
      expect(worker).toContain(`'${module}':`);
    }
  });
});
