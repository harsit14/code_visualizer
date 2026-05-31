import { describe, expect, it } from 'vitest';
import { DEFAULT_EXAMPLE_ID, getPythonExample, pythonExamples } from '../examples/pythonExamples';

describe('python examples', () => {
  it('ships a useful starter set', () => {
    expect(pythonExamples.length).toBeGreaterThanOrEqual(5);
    expect(pythonExamples.map((example) => example.id)).toContain(DEFAULT_EXAMPLE_ID);
  });

  it('falls back to the first example for unknown ids', () => {
    expect(getPythonExample('missing-example')).toEqual(pythonExamples[0]);
  });
});
