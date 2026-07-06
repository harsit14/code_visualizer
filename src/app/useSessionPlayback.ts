import { useCallback, useEffect, useState } from 'react';

export type PlaybackSpeed = number; // steps per second

export function useSessionPlayback(totalSteps: number) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(2);
  const [selectedFrameIndex, setSelectedFrameIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!playing || totalSteps <= 1) {
      return;
    }
    const timer = window.setInterval(
      () => {
        setStep((current) => {
          if (current >= totalSteps - 1) {
            setPlaying(false);
            return current;
          }
          return current + 1;
        });
      },
      Math.max(40, Math.round(1000 / speed)),
    );
    return () => window.clearInterval(timer);
  }, [playing, speed, totalSteps]);

  const resetPlayback = useCallback(() => {
    setStep(0);
    setPlaying(false);
    setSelectedFrameIndex(null);
  }, []);

  const jumpToStep = useCallback(
    (nextStep: number) => {
      setPlaying(false);
      setStep(Math.max(0, Math.min(nextStep, Math.max(totalSteps - 1, 0))));
    },
    [totalSteps],
  );

  const stepForward = useCallback(() => jumpToStep(step + 1), [jumpToStep, step]);
  const stepBack = useCallback(() => jumpToStep(step - 1), [jumpToStep, step]);
  const togglePlay = useCallback(() => {
    if (totalSteps <= 1) {
      return;
    }
    setPlaying((current) => {
      if (!current && step >= totalSteps - 1) {
        setStep(0);
      }
      return !current;
    });
  }, [step, totalSteps]);

  return {
    jumpToStep,
    playing,
    resetPlayback,
    selectedFrameIndex,
    setPlaying,
    setSelectedFrameIndex,
    setSpeed,
    setStep,
    speed,
    step,
    stepBack,
    stepForward,
    togglePlay,
  };
}
