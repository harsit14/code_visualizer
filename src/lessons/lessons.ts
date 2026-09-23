/**
 * Guided lesson checkpoints: find the trace step where each prediction is
 * asked, read the answer from the real trace, and check a learner's guess.
 */
import { parsePythonLiteral, pyEqual } from '../app/pythonLiteral';
import { expandSelf, formatValue } from '../engine/trace';
import type { EncodedValue, TraceStep } from '../engine/types';
import { lessons, type Lesson, type LessonCheckpoint } from './lessonData';

export { lessons, type Lesson, type LessonCheckpoint };

export type ResolvedCheckpoint = {
  /** Position in the lesson's authored list. */
  index: number;
  checkpoint: LessonCheckpoint;
  /** Step where the prediction is asked (the line has not run yet). */
  step: number;
  /** First step where the answer is visible. */
  answerStep: number;
  answer: string;
};

export type LessonAnswer = { prediction: string; correct: boolean };

export function getLesson(id: string | null | undefined): Lesson | undefined {
  return id ? lessons.find((lesson) => lesson.id === id) : undefined;
}

function sameLiteral(left: string, right: string): boolean {
  try {
    return pyEqual(parsePythonLiteral(left), parsePythonLiteral(right));
  } catch {
    const plain = (text: string) =>
      text
        .trim()
        .replace(/^(['"])(.*)\1$/s, '$2')
        .replace(/\s+/g, ' ');
    return plain(left) === plain(right);
  }
}

/** Resolves `name` or `name[key]` against a frame's locals. */
export function resolveTarget(
  target: string,
  locals: Record<string, EncodedValue>,
): EncodedValue | undefined {
  const match = /^([A-Za-z_]\w*)(?:\[(.+)\])?$/.exec(target.trim());
  if (!match) return undefined;
  const value = locals[match[1]];
  if (!value || match[2] === undefined) return value;
  const key = match[2].trim();
  if (value.k === 'seq') {
    const index = Number(key);
    return Number.isInteger(index) ? value.items[index] : undefined;
  }
  if (value.k === 'dict') {
    return value.entries.find(([entryKey]) => sameLiteral(formatValue(entryKey), key))?.[1];
  }
  return undefined;
}

function resolveCheckpoint(
  steps: readonly TraceStep[],
  checkpoint: LessonCheckpoint,
  index: number,
): ResolvedCheckpoint | null {
  let visits = 0;
  const step = steps.findIndex(
    (candidate) =>
      candidate.event === 'line' &&
      candidate.line === checkpoint.line &&
      ++visits === checkpoint.visit,
  );
  if (step < 0) return null;
  const frameId = steps[step].stack[steps[step].stack.length - 1]?.id;
  for (let later = step + 1; later < steps.length; later += 1) {
    const candidate = steps[later];
    const top = candidate.stack[candidate.stack.length - 1];
    if (!top || top.id !== frameId) continue;
    if (checkpoint.target === '<return>') {
      if (candidate.event !== 'return' || !candidate.ret) continue;
      return { index, checkpoint, step, answerStep: later, answer: formatValue(candidate.ret) };
    }
    if (candidate.event === 'call') continue;
    const value = resolveTarget(checkpoint.target, expandSelf(top.locals));
    return value
      ? { index, checkpoint, step, answerStep: later, answer: formatValue(value) }
      : null;
  }
  return null;
}

/** Checkpoints found in this trace, in the order a learner meets them. */
export function resolveCheckpoints(
  lesson: Lesson,
  steps: readonly TraceStep[],
): ResolvedCheckpoint[] {
  return lesson.checkpoints
    .map((checkpoint, index) => resolveCheckpoint(steps, checkpoint, index))
    .filter((item): item is ResolvedCheckpoint => item !== null)
    .sort((a, b) => a.step - b.step);
}

/** Accepts equivalent Python literals and unquoted strings such as `B` for `'B'`. */
export function isCorrectPrediction(prediction: string, answer: string): boolean {
  return prediction.trim() !== '' && sameLiteral(prediction, answer);
}
