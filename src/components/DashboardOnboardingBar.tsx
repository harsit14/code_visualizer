import { Highlighter, Play, SlidersHorizontal, X } from 'lucide-react';

type DashboardOnboardingBarProps = {
  onDismiss: () => void;
};

const cues = [
  { icon: Play, label: 'Run', text: 'Start a trace from the primary Run button.' },
  { icon: SlidersHorizontal, label: 'Scrub', text: 'Replay each recorded step after code runs.' },
  { icon: Highlighter, label: 'Follow', text: 'Watch the highlighted line move through the code.' },
];

export function DashboardOnboardingBar({ onDismiss }: DashboardOnboardingBarProps) {
  return (
    <aside className="dashboard-onboarding" aria-label="Dashboard orientation">
      <div className="dashboard-onboarding-cues">
        {cues.map((cue) => {
          const Icon = cue.icon;
          return (
            <span className="dashboard-onboarding-cue" key={cue.label}>
              <Icon size={14} />
              <strong>{cue.label}</strong>
              <span>{cue.text}</span>
            </span>
          );
        })}
      </div>
      <button
        aria-label="Dismiss dashboard orientation"
        className="icon-button dashboard-onboarding-dismiss"
        onClick={onDismiss}
        type="button"
      >
        <X size={14} />
      </button>
    </aside>
  );
}
