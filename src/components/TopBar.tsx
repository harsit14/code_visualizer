/**
 * Top bar: branding, example picker, theme toggle, share link,
 * trace export/import, and runtime status.
 */
import { Columns3, Download, Link2, Moon, Sun, Upload } from 'lucide-react';
import { useRef } from 'react';
import { examples } from '../examples/examples';
import type { RuntimeStatus } from '../engine/types';

type PanelControl = {
  id: string;
  label: string;
  visible: boolean;
};

type TopBarProps = {
  exampleId: string | null;
  onExampleChange: (id: string) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onShare: () => void;
  shareLabel: string;
  importLabel: string;
  importTitle: string;
  canExport: boolean;
  onExport: () => void;
  onImport: (file: File) => void;
  onResetLayout: () => void;
  onTogglePanel: (id: string, visible: boolean) => void;
  panelControls: readonly PanelControl[];
  status: RuntimeStatus;
};

const CUSTOM_ID = '__custom__';

export function TopBar({
  exampleId,
  onExampleChange,
  theme,
  onToggleTheme,
  onShare,
  shareLabel,
  importLabel,
  importTitle,
  canExport,
  onExport,
  onImport,
  onResetLayout,
  onTogglePanel,
  panelControls,
  status,
}: TopBarProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const categories = [...new Set(examples.map((example) => example.category))];

  return (
    <header className="top-bar">
      <div className="brand">
        <span className="brand-mark">⟢</span>
        <h1>Code Visualizer</h1>
        <span className={`status-pill status-${status.phase}`}>{status.message}</span>
      </div>

      <div className="top-actions">
        <select
          aria-label="Load example"
          onChange={(event) => onExampleChange(event.target.value)}
          value={exampleId ?? CUSTOM_ID}
        >
          <option disabled value={CUSTOM_ID}>
            Custom code
          </option>
          {categories.map((category) => (
            <optgroup key={category} label={category}>
              {examples
                .filter((example) => example.category === category)
                .map((example) => (
                  <option key={example.id} value={example.id}>
                    {example.title}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>

        <button onClick={onShare} title="Copy a shareable link" type="button">
          <Link2 size={14} />
          {shareLabel}
        </button>
        <button disabled={!canExport} onClick={onExport} title="Export trace JSON" type="button">
          <Download size={14} />
          Export
        </button>
        <button onClick={() => fileInputRef.current?.click()} title={importTitle} type="button">
          <Upload size={14} />
          {importLabel}
        </button>
        <details className="panel-menu">
          <summary title="Show, hide, and reset panels">
            <Columns3 size={14} />
            Panels
          </summary>
          <div className="panel-menu-popover">
            {panelControls.map((panel) => (
              <label className="panel-menu-item" key={panel.id}>
                <input
                  checked={panel.visible}
                  onChange={(event) => onTogglePanel(panel.id, event.target.checked)}
                  type="checkbox"
                />
                <span>{panel.label}</span>
              </label>
            ))}
            <button className="panel-menu-reset" onClick={onResetLayout} type="button">
              Reset layout
            </button>
          </div>
        </details>
        <input
          accept="application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              onImport(file);
            }
            event.target.value = '';
          }}
          ref={fileInputRef}
          type="file"
        />
        <button
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          className="icon-button"
          onClick={onToggleTheme}
          type="button"
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>
    </header>
  );
}
