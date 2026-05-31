import { Pause, Play, StepBack, StepForward } from 'lucide-react';
import type { PythonTraceEvent } from '../../languages/python/runtimeTypes';

type TimelineScrubberProps = {
  currentStep: number;
  events: PythonTraceEvent[];
  isPlaying: boolean;
  onChange: (step: number) => void;
  onPlaybackSpeedChange: (speed: number) => void;
  onTogglePlayback: () => void;
  playbackSpeed: number;
  totalSteps: number;
};

type TimelineRailItem =
  | {
      index: number;
      type: 'event';
    }
  | {
      key: string;
      label: string;
      type: 'gap';
    };

const MAX_VISIBLE_EVENT_DOTS = 72;
const EVENT_WINDOW_RADIUS = 24;
const PLAYBACK_SPEEDS = [0.5, 1, 2, 4];

function getEventLabel(event: PythonTraceEvent | undefined, index: number) {
  if (!event) {
    return index === 0 ? 'ready' : 'event';
  }

  if (event.type === 'line') {
    return `line ${event.line ?? '?'}`;
  }

  if (event.type === 'call') {
    return `call ${event.functionName}`;
  }

  if (event.type === 'return') {
    return `return ${event.functionName}`;
  }

  if (event.type === 'exception') {
    return event.exception?.name ?? 'exception';
  }

  return 'trace cap';
}

function getTimelineRailItems(totalSteps: number, currentStep: number): TimelineRailItem[] {
  if (totalSteps <= MAX_VISIBLE_EVENT_DOTS) {
    return Array.from({ length: totalSteps }, (_, index) => ({
      index,
      type: 'event' as const,
    }));
  }

  const lastStep = totalSteps - 1;
  const windowStart = Math.max(1, currentStep - EVENT_WINDOW_RADIUS);
  const windowEnd = Math.min(lastStep - 1, currentStep + EVENT_WINDOW_RADIUS);
  const items: TimelineRailItem[] = [{ index: 0, type: 'event' }];

  if (windowStart > 1) {
    items.push({
      key: `gap-start-${windowStart}`,
      label: `${windowStart - 1} skipped`,
      type: 'gap',
    });
  }

  for (let index = windowStart; index <= windowEnd; index += 1) {
    items.push({ index, type: 'event' });
  }

  if (windowEnd < lastStep - 1) {
    items.push({
      key: `gap-end-${windowEnd}`,
      label: `${lastStep - windowEnd - 1} skipped`,
      type: 'gap',
    });
  }

  items.push({ index: lastStep, type: 'event' });
  return items;
}

export function TimelineScrubber({
  currentStep,
  events,
  isPlaying,
  onChange,
  onPlaybackSpeedChange,
  onTogglePlayback,
  playbackSpeed,
  totalSteps,
}: TimelineScrubberProps) {
  const lastStep = totalSteps - 1;
  const canScrub = events.length > 0;
  const railItems = getTimelineRailItems(totalSteps, currentStep);

  return (
    <footer className="timeline-shell" aria-label="Execution timeline">
      <div className="timeline-controls">
        <button
          className="round-button"
          disabled={!canScrub || currentStep === 0}
          onClick={() => onChange(Math.max(currentStep - 1, 0))}
          title="Previous step"
          type="button"
        >
          <StepBack size={18} />
        </button>
        <button
          className="round-button play"
          disabled={!canScrub}
          onClick={onTogglePlayback}
          title={isPlaying ? 'Pause trace playback' : 'Play trace'}
          type="button"
        >
          {isPlaying ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button
          className="round-button"
          disabled={!canScrub || currentStep === lastStep}
          onClick={() => onChange(Math.min(currentStep + 1, lastStep))}
          title="Next step"
          type="button"
        >
          <StepForward size={18} />
        </button>
      </div>

      <div className="speed-control" aria-label="Playback speed">
        {PLAYBACK_SPEEDS.map((speed) => (
          <button
            className={speed === playbackSpeed ? 'speed-option is-active' : 'speed-option'}
            disabled={!canScrub}
            key={speed}
            onClick={() => onPlaybackSpeedChange(speed)}
            title={`Play at ${speed}x speed`}
            type="button"
          >
            {speed}x
          </button>
        ))}
      </div>

      <div className="timeline-main">
        <input
          aria-label="Execution step"
          className="timeline-range"
          disabled={!canScrub}
          max={lastStep}
          min={0}
          onChange={(event) => onChange(Number(event.target.value))}
          type="range"
          value={currentStep}
        />
        <div className="event-rail">
          {railItems.map((item) =>
            item.type === 'gap' ? (
              <span className="event-gap" key={item.key}>
                {item.label}
              </span>
            ) : (
              <button
                className={[
                  'event-dot',
                  item.index === currentStep ? 'is-current' : '',
                  events[item.index]?.type ? `event-${events[item.index].type}` : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                disabled={!canScrub}
                key={item.index}
                onClick={() => onChange(item.index)}
                title={`Step ${item.index + 1}: ${getEventLabel(events[item.index], item.index)}`}
                type="button"
              >
                <span>{getEventLabel(events[item.index], item.index)}</span>
              </button>
            ),
          )}
        </div>
      </div>
    </footer>
  );
}
