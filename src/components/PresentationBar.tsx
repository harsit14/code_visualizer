/**
 * Presentation header: replaces the top bar while presenting. Shows the
 * current checkpoint's caption in a live region, checkpoint navigation, a
 * theme switch for projectors and the way out.
 */
import { ChevronLeft, ChevronRight, Moon, Sun, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { Checkpoint, CheckpointNavigation } from '../engine/traceCheckpoints';
import { LogoMark } from './LogoMark';

type PresentationBarProps = {
  checkpoints: readonly Checkpoint[];
  navigation: CheckpointNavigation;
  onJump: (step: number) => void;
  onExit: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
};

export function PresentationBar({
  checkpoints,
  navigation,
  onJump,
  onExit,
  theme,
  onToggleTheme,
}: PresentationBarProps) {
  const region = useRef<HTMLElement>(null);
  const current = navigation.current === null ? null : checkpoints[navigation.current];
  const next = navigation.next === null ? null : checkpoints[navigation.next];

  // The toggle that opened presentation is gone; keep keyboard focus nearby.
  useEffect(() => {
    region.current?.focus();
  }, []);

  const go = (index: number | null) => {
    if (index !== null) onJump(checkpoints[index].step);
  };

  return (
    <section aria-label="Presentation" className="presentation-bar" ref={region} tabIndex={-1}>
      <div className="presentation-brand">
        <LogoMark />
        <strong>Presenting</strong>
        <span className="presentation-brand-hint">Esc exits</span>
      </div>

      <div className="presentation-caption">
        <div
          aria-atomic="true"
          aria-live="polite"
          className="presentation-caption-live"
          role="status"
        >
          {current ? (
            <>
              <span className="presentation-caption-label">
                Checkpoint {navigation.current! + 1} of {checkpoints.length} · step {current.step}
              </span>
              <span className="presentation-caption-text">
                {current.note || 'No note for this checkpoint.'}
              </span>
            </>
          ) : null}
        </div>
        {current ? null : (
          <p className="presentation-caption-hint">
            {checkpoints.length === 0
              ? 'No checkpoints yet. Exit, bookmark steps in trace search and flag them as checkpoints.'
              : next
                ? `Between checkpoints. Next: checkpoint ${navigation.next! + 1} at step ${next.step}.`
                : 'After the last checkpoint.'}
          </p>
        )}
      </div>

      <div className="presentation-actions">
        {/* aria-disabled keeps focus on the button at either end of the list. */}
        <button
          aria-disabled={navigation.previous === null}
          aria-keyshortcuts="["
          onClick={() => go(navigation.previous)}
          title="Previous checkpoint ([ or Page Up)"
          type="button"
        >
          <ChevronLeft size={16} />
          <span className="presentation-action-label">Previous checkpoint</span>
        </button>
        <button
          aria-disabled={navigation.next === null}
          aria-keyshortcuts="]"
          onClick={() => go(navigation.next)}
          title="Next checkpoint (] or Page Down)"
          type="button"
        >
          <span className="presentation-action-label">Next checkpoint</span>
          <ChevronRight size={16} />
        </button>
        <button
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="presentation-theme"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          type="button"
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button
          aria-keyshortcuts="Escape"
          aria-label="Exit presentation"
          className="presentation-exit"
          onClick={onExit}
          title="Leave presentation mode (Esc)"
          type="button"
        >
          <X size={16} />
          Exit
        </button>
      </div>
    </section>
  );
}
