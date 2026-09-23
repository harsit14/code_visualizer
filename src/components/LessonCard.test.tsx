// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Lesson, ResolvedCheckpoint } from '../lessons/lessons';
import { LessonCard } from './LessonCard';

afterEach(cleanup);

const lesson: Lesson = {
  id: 'lesson-test',
  title: 'Sliding window: best sum',
  pattern: 'Sliding window',
  goal: 'Find the best window.',
  invariant: 'window is the sum of the last k items.',
  code: '',
  checkpoints: [
    {
      line: 3,
      visit: 1,
      target: 'window',
      prompt: 'What is window?',
      expected: '8',
      explanation: '2 + 1 + 5.',
    },
    {
      line: 6,
      visit: 1,
      target: 'window',
      prompt: 'After sliding?',
      expected: '7',
      explanation: '8 + 1 - 2.',
    },
  ],
};

const checkpoints: ResolvedCheckpoint[] = [
  { index: 0, checkpoint: lesson.checkpoints[0], step: 2, answerStep: 3, answer: '8' },
  { index: 1, checkpoint: lesson.checkpoints[1], step: 6, answerStep: 7, answer: '7' },
];

function renderCard(props: Partial<Parameters<typeof LessonCard>[0]> = {}) {
  const handlers = { onAnswer: vi.fn(), onJump: vi.fn() };
  render(
    <LessonCard
      answers={{}}
      checkpoints={checkpoints}
      lesson={lesson}
      step={0}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe('LessonCard', () => {
  it('introduces the lesson before it runs', () => {
    renderCard({ checkpoints: null });
    expect(screen.getByRole('region', { name: 'Guided lesson' }).textContent).toContain(
      'you will predict 2 values',
    );
    expect(screen.getByText('0/2')).toBeTruthy();
  });

  it('asks for a prediction at a checkpoint and submits it', () => {
    const { onAnswer } = renderCard({ step: 2 });
    expect(screen.getByText('Checkpoint 1 of 2 · line 3 has not run yet')).toBeTruthy();
    const input = screen.getByRole('textbox', { name: 'Your prediction' });
    fireEvent.change(input, { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(onAnswer).toHaveBeenCalledWith(0, '8');
    fireEvent.click(screen.getByRole('button', { name: 'Show answer' }));
    expect(onAnswer).toHaveBeenCalledWith(0, '');
  });

  it('reveals the real value, the explanation and the step that shows it', () => {
    const { onJump } = renderCard({ step: 6, answers: { 1: { prediction: '9', correct: false } } });
    expect(screen.getByText(/Not quite: it is/)).toBeTruthy();
    expect(screen.getByText('8 + 1 - 2.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'See it happen' }));
    expect(onJump).toHaveBeenCalledWith(7);
  });

  it('points to the next checkpoint and summarizes a finished lesson', () => {
    const { onJump } = renderCard({ step: 3, answers: { 0: { prediction: '8', correct: true } } });
    fireEvent.click(screen.getByRole('button', { name: 'Go to checkpoint 2' }));
    expect(onJump).toHaveBeenCalledWith(6);
    cleanup();
    renderCard({
      step: 7,
      answers: {
        0: { prediction: '8', correct: true },
        1: { prediction: '', correct: false },
      },
    });
    expect(screen.getByText('Lesson complete: 1 of 2 predictions correct.')).toBeTruthy();
  });
});
