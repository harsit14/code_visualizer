/**
 * Guided lesson card: explains the goal, pauses at checkpoints for a
 * prediction, then reveals the real value and the invariant behind it.
 */
import { CheckCircle2, GraduationCap, XCircle } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { Lesson, LessonAnswer, ResolvedCheckpoint } from '../lessons/lessons';

type LessonCardProps = {
  lesson: Lesson;
  /** `null` until the lesson program has been run. */
  checkpoints: readonly ResolvedCheckpoint[] | null;
  step: number;
  answers: Readonly<Record<number, LessonAnswer>>;
  onAnswer: (index: number, prediction: string) => void;
  onJump: (step: number) => void;
};

function PredictionForm({
  checkpoint,
  onAnswer,
}: {
  checkpoint: ResolvedCheckpoint;
  onAnswer: (index: number, prediction: string) => void;
}) {
  const [prediction, setPrediction] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (prediction.trim()) onAnswer(checkpoint.index, prediction);
  };
  return (
    <form className="lesson-prediction" onSubmit={submit}>
      <label>
        <span>{checkpoint.checkpoint.prompt}</span>
        <input
          aria-label="Your prediction"
          autoComplete="off"
          onChange={(event) => setPrediction(event.target.value)}
          placeholder="Type a value"
          spellCheck={false}
          value={prediction}
        />
      </label>
      <div className="lesson-actions">
        <button disabled={!prediction.trim()} type="submit">
          Check
        </button>
        <button
          className="ghost-button"
          onClick={() => onAnswer(checkpoint.index, '')}
          type="button"
        >
          Show answer
        </button>
      </div>
    </form>
  );
}

export function LessonCard({
  lesson,
  checkpoints,
  step,
  answers,
  onAnswer,
  onJump,
}: LessonCardProps) {
  const total = checkpoints?.length ?? lesson.checkpoints.length;
  const answered = checkpoints?.filter((item) => answers[item.index]).length ?? 0;
  const correct = checkpoints?.filter((item) => answers[item.index]?.correct).length ?? 0;
  const current = checkpoints?.find((item) => item.step === step);
  const next =
    checkpoints?.find((item) => !answers[item.index] && item.step > step) ??
    checkpoints?.find((item) => !answers[item.index]);
  const position = current && checkpoints ? checkpoints.indexOf(current) + 1 : null;
  const answer = current ? answers[current.index] : undefined;

  return (
    <section aria-label="Guided lesson" className="lesson-card">
      <header className="lesson-header">
        <GraduationCap aria-hidden="true" size={15} />
        <span className="lesson-pattern">{lesson.pattern}</span>
        <strong>{lesson.title}</strong>
        <span className="lesson-progress">
          {answered}/{total}
        </span>
      </header>

      {!checkpoints ? (
        <p>
          {lesson.goal} Press <strong>Run</strong>, then step through the trace; you will predict{' '}
          {total} values along the way.
        </p>
      ) : current ? (
        <div className="lesson-checkpoint">
          <p className="lesson-checkpoint-label">
            Checkpoint {position} of {checkpoints.length} · line {current.checkpoint.line} has not
            run yet
          </p>
          {answer ? (
            <>
              <p className={`lesson-result ${answer.correct ? 'is-correct' : 'is-revealed'}`}>
                {answer.correct ? (
                  <CheckCircle2 aria-hidden="true" size={14} />
                ) : (
                  <XCircle aria-hidden="true" size={14} />
                )}
                {answer.correct
                  ? 'Correct: '
                  : answer.prediction
                    ? 'Not quite: it is '
                    : 'Answer: '}
                <code>{current.answer}</code>
              </p>
              <p>{current.checkpoint.explanation}</p>
              <button onClick={() => onJump(current.answerStep)} type="button">
                See it happen
              </button>
            </>
          ) : (
            <PredictionForm checkpoint={current} key={current.index} onAnswer={onAnswer} />
          )}
        </div>
      ) : (
        <>
          <p>{lesson.goal}</p>
          {checkpoints.length === 0 ? (
            <p>This run did not reach any checkpoints. Restore the lesson code and run it again.</p>
          ) : next ? (
            <button onClick={() => onJump(next.step)} type="button">
              Go to checkpoint {checkpoints.indexOf(next) + 1}
            </button>
          ) : (
            <p className="lesson-summary">
              Lesson complete: {correct} of {checkpoints.length} predictions correct.
            </p>
          )}
        </>
      )}
      <p className="lesson-invariant">
        <span>Invariant</span> {lesson.invariant}
      </p>
    </section>
  );
}
