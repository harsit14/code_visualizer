import { describe, expect, it } from 'vitest';
import { runJavaScriptTrace } from '../engine/jsTraceEngine';
import {
  getLesson,
  isCorrectPrediction,
  lessons,
  resolveCheckpoints,
  type Lesson,
} from './lessons';

function lesson(code: string, checkpoints: Lesson['checkpoints']): Lesson {
  return { id: 'test', title: 'Test', pattern: 'Test', goal: '', invariant: '', code, checkpoints };
}

function checkpoint(line: number, visit: number, target: string) {
  return { line, visit, target, prompt: '', expected: '', explanation: '' };
}

describe('resolveCheckpoints', () => {
  it('asks before the line runs and reads the answer once its frame continues', () => {
    const code =
      'const ways = [1, 1, 0, 0];\nfor (let i = 2; i < 4; i++) {\n  ways[i] = ways[i - 1] + ways[i - 2];\n}';
    const steps = runJavaScriptTrace(code, 'javascript').run!.steps;
    const [first, second] = resolveCheckpoints(
      lesson(code, [checkpoint(3, 2, 'ways[3]'), checkpoint(3, 1, 'ways[2]')]),
      steps,
    );
    expect(first).toMatchObject({ index: 1, answer: '2' });
    expect(second).toMatchObject({ index: 0, answer: '3' });
    expect(steps[first.step]).toMatchObject({ event: 'line', line: 3 });
    expect(first.answerStep).toBeGreaterThan(first.step);
  });

  it('reads return values for <return> targets after nested calls finish', () => {
    const code =
      'function total(nums) {\n  if (nums.length === 0) return 0;\n  return nums[0] + total(nums.slice(1));\n}\ntotal([4, 2]);';
    const steps = runJavaScriptTrace(code, 'javascript').run!.steps;
    const resolved = resolveCheckpoints(
      lesson(code, [checkpoint(3, 1, '<return>'), checkpoint(3, 2, '<return>')]),
      steps,
    );
    expect(resolved.map((item) => item.answer)).toEqual(['6', '2']);
    expect(steps[resolved[0].answerStep]).toMatchObject({ event: 'return', func: 'total' });
  });

  it('resolves dictionary keys and skips checkpoints the trace never reaches', () => {
    const code = "const dist = new Map([['A', 0]]);\ndist.set('B', 1);\nconst done = true;";
    const steps = runJavaScriptTrace(code, 'javascript').run!.steps;
    const resolved = resolveCheckpoints(
      lesson(code, [checkpoint(2, 1, "dist['B']"), checkpoint(9, 1, 'dist')]),
      steps,
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0].answer).toBe('1');
  });
});

describe('isCorrectPrediction', () => {
  it.each([
    ['8', '8', true],
    [' 8 ', '8', true],
    ['9', '8', false],
    ["['e', 'o']", "['e', 'o']", true],
    ['["e","o"]', "['e', 'o']", true],
    ['B', "'B'", true],
    ['"B"', "'B'", true],
    ['C', "'B'", false],
    ['', '0', false],
  ])('%j for %j is %s', (prediction, answer, expected) => {
    expect(isCorrectPrediction(prediction, answer)).toBe(expected);
  });
});

describe('authored lessons', () => {
  it('cover the planned patterns with unique ids', () => {
    expect(lessons.map((item) => item.pattern)).toEqual(
      expect.arrayContaining([
        'Two pointers',
        'Sliding window',
        'Recursion',
        'BFS',
        'Dynamic programming',
      ]),
    );
    expect(new Set(lessons.map((item) => item.id)).size).toBe(lessons.length);
    expect(getLesson('lesson-bfs')?.checkpoints.length).toBeGreaterThan(0);
    expect(getLesson('two-sum')).toBeUndefined();
  });
});
