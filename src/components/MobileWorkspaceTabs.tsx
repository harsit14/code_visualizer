import { mobileTabs, type MobileTab } from '../app/useMobileWorkspace';
export function MobileWorkspaceTabs({
  active,
  onChange,
  tabs = mobileTabs,
}: {
  active: MobileTab;
  onChange: (tab: MobileTab) => void;
  tabs?: readonly MobileTab[];
}) {
  return (
    <div
      className="mobile-workspace-tabs"
      role="tablist"
      aria-label="Workspace view"
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
    >
      {tabs.map((tab, index) => (
        <button
          key={tab}
          id={`mobile-tab-${tab}`}
          type="button"
          role="tab"
          aria-selected={active === tab}
          aria-controls="workspace-content"
          tabIndex={active === tab ? 0 : -1}
          onClick={() => onChange(tab)}
          onKeyDown={(event) => {
            const next =
              event.key === 'ArrowRight'
                ? (index + 1) % tabs.length
                : event.key === 'ArrowLeft'
                  ? (index + tabs.length - 1) % tabs.length
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? tabs.length - 1
                      : null;
            if (next === null) return;
            event.preventDefault();
            onChange(tabs[next]);
            document.getElementById(`mobile-tab-${tabs[next]}`)?.focus();
          }}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}
