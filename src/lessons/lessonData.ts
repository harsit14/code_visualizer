/** Authored guided lessons; `engine/tests/test_lessons.py` checks every checkpoint. */
import data from './lessons.json';

export type LessonCheckpoint = {
  /** Line about to run when the learner is asked to predict. */
  line: number;
  /** Which visit to that line (1-based, counted across the whole trace). */
  visit: number;
  /** A variable, `name[key]`, or `<return>` for the frame's return value. */
  target: string;
  prompt: string;
  /** The authored answer, verified against the engine in CI. */
  expected: string;
  explanation: string;
};

export type Lesson = {
  id: string;
  title: string;
  pattern: string;
  goal: string;
  invariant: string;
  code: string;
  checkpoints: LessonCheckpoint[];
};

export const lessons: Lesson[] = data;
