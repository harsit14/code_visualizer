import { useEffect } from 'react';

type UseTransportShortcutsOptions = {
  jumpToStep: (step: number) => void;
  run: () => Promise<void> | void;
  stepBack: () => void;
  stepForward: () => void;
  togglePlay: () => void;
  totalSteps: number;
};

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable ||
      Boolean(target.closest('.cm-editor')))
  );
}

export function useTransportShortcuts({
  jumpToStep,
  run,
  stepBack,
  stepForward,
  togglePlay,
  totalSteps,
}: UseTransportShortcutsOptions) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key === 'Enter') {
        event.preventDefault();
        void run();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) {
        return;
      }
      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          stepBack();
          break;
        case 'ArrowRight':
          event.preventDefault();
          stepForward();
          break;
        case ' ':
        case 'Spacebar':
          event.preventDefault();
          togglePlay();
          break;
        case 'Home':
          event.preventDefault();
          jumpToStep(0);
          break;
        case 'End':
          event.preventDefault();
          jumpToStep(totalSteps - 1);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [jumpToStep, run, stepBack, stepForward, togglePlay, totalSteps]);
}
