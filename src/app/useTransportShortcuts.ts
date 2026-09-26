import { useEffect } from 'react';

type UseTransportShortcutsOptions = {
  jumpToStep: (step: number) => void;
  run: () => Promise<void> | void;
  stepBack: () => void;
  stepForward: () => void;
  togglePlay: () => void;
  totalSteps: number;
  toggleBookmark?: () => void;
  openSearch?: () => void;
  /** P toggles presentation, Escape leaves it; editing shortcuts pause meanwhile. */
  presentation?: { active: boolean; toggle: () => void };
  /** [ and ] jump between checkpoints; Page Up/Down too while presenting (clickers). */
  previousCheckpoint?: () => void;
  nextCheckpoint?: () => void;
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
  toggleBookmark,
  openSearch,
  presentation,
  previousCheckpoint,
  nextCheckpoint,
}: UseTransportShortcutsOptions) {
  useEffect(() => {
    const presenting = presentation?.active ?? false;
    const onKeyDown = (event: KeyboardEvent) => {
      // Escape leaves presentation even from the scrubber, which counts as typing.
      if (presenting && event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        presentation?.toggle();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key === 'Enter') {
        if (presenting) return;
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
        case 'b':
        case 'B':
          if (toggleBookmark && totalSteps > 0 && !presenting) {
            event.preventDefault();
            toggleBookmark();
          }
          break;
        case '/':
          if (openSearch && totalSteps > 0 && !presenting) {
            event.preventDefault();
            openSearch();
          }
          break;
        case 'p':
        case 'P':
          if (presentation && (presenting || totalSteps > 0)) {
            event.preventDefault();
            presentation.toggle();
          }
          break;
        case '[':
        case 'PageUp':
          if (previousCheckpoint && (event.key === '[' || presenting)) {
            event.preventDefault();
            previousCheckpoint();
          }
          break;
        case ']':
        case 'PageDown':
          if (nextCheckpoint && (event.key === ']' || presenting)) {
            event.preventDefault();
            nextCheckpoint();
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    jumpToStep,
    nextCheckpoint,
    openSearch,
    presentation,
    previousCheckpoint,
    run,
    stepBack,
    stepForward,
    toggleBookmark,
    togglePlay,
    totalSteps,
  ]);
}
