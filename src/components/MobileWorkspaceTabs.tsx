import { mobileTabs, type MobileTab } from '../app/useMobileWorkspace';
export function MobileWorkspaceTabs({
  active,
  onChange,
}: {
  active: MobileTab;
  onChange: (tab: MobileTab) => void;
}) {
  return (
    <div className="mobile-workspace-tabs" role="tablist" aria-label="Workspace view">
      {mobileTabs.map((tab, index) => (
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
                ? (index + 1) % mobileTabs.length
                : event.key === 'ArrowLeft'
                  ? (index + mobileTabs.length - 1) % mobileTabs.length
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? mobileTabs.length - 1
                      : null;
            if (next === null) return;
            event.preventDefault();
            onChange(mobileTabs[next]);
            document.getElementById(`mobile-tab-${mobileTabs[next]}`)?.focus();
          }}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}
