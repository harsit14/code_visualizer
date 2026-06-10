/**
 * Top bar: branding, example picker, theme toggle, share link,
 * trace export/import, and runtime status.
 */
import { Download, Link2, Moon, Sun, Upload } from 'lucide-react';
import { useRef } from 'react';
import { examples } from '../examples/examples';
import type { RuntimeStatus } from '../engine/types';

type TopBarProps = {
  exampleId: string | null;
  onExampleChange: (id: string) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onShare: () => void;
  shareLabel: string;
  canExport: boolean;
  onExport: () => void;
  onImport: (file: File) => void;
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
  canExport,
  onExport,
  onImport,
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
        <button
          onClick={() => fileInputRef.current?.click()}
          title="Import a previously exported trace"
          type="button"
        >
          <Upload size={14} />
          Import
        </button>
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
