/**
 * Top bar: branding, example picker, theme toggle, share link,
 * trace export/import, layout controls, shortcuts, and runtime status.
 */
import {
  ArrowLeft,
  Code2,
  Columns3,
  Download,
  FileImage,
  HelpCircle,
  Link2,
  Moon,
  Sun,
  Upload,
} from 'lucide-react';
import { useRef } from 'react';
import { AccountMenu } from './AccountMenu';
import { HistoryMenu } from './HistoryMenu';
import type { CodeHistoryItem } from '../app/historyClient';
import { examples } from '../examples/examples';
import type { Language, RuntimeStatus } from '../engine/types';

type PanelControl = {
  id: string;
  label: string;
  visible: boolean;
};

type TopBarProps = {
  exampleId: string | null;
  onExampleChange: (id: string) => void;
  language: Language;
  onLanguageChange: (language: Language) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onShare: () => void;
  shareLabel: string;
  onEmbed: () => void;
  embedLabel: string;
  importLabel: string;
  importTitle: string;
  canExport: boolean;
  onExport: () => void;
  onExportSvg: () => void;
  onOpenHistoryItem: (item: CodeHistoryItem) => void;
  onImport: (file: File) => void;
  onResetLayout: () => void;
  onTogglePanel: (id: string, visible: boolean) => void;
  panelControls: readonly PanelControl[];
  historyRefreshToken: number;
  status: RuntimeStatus;
  onOpenLanding: () => void;
};

const CUSTOM_ID = '__custom__';
const SHORTCUTS = [
  { keys: ['←'], label: 'Step back' },
  { keys: ['→'], label: 'Step forward' },
  { keys: ['Space'], label: 'Play or pause' },
  { keys: ['Home'], label: 'Jump to start' },
  { keys: ['End'], label: 'Jump to end' },
  { keys: ['Click gutter'], label: 'Toggle breakpoint' },
  { keys: ['Right click line'], label: 'Run to line' },
];

export function TopBar({
  exampleId,
  onExampleChange,
  language,
  onLanguageChange,
  theme,
  onToggleTheme,
  onShare,
  shareLabel,
  onEmbed,
  embedLabel,
  importLabel,
  importTitle,
  canExport,
  onExport,
  onExportSvg,
  onOpenHistoryItem,
  onOpenLanding,
  onImport,
  onResetLayout,
  onTogglePanel,
  panelControls,
  historyRefreshToken,
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
        <button onClick={onOpenLanding} title="Back to the landing page" type="button">
          <ArrowLeft size={14} />
          Landing
        </button>

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

        <select
          aria-label="Language"
          onChange={(event) => onLanguageChange(event.target.value as Language)}
          value={language}
        >
          <option value="python">Python</option>
          <option value="javascript">JavaScript</option>
          <option value="typescript">TypeScript</option>
        </select>

        <button onClick={onShare} title="Copy a shareable link" type="button">
          <Link2 size={14} />
          {shareLabel}
        </button>
        <button onClick={onEmbed} title="Copy iframe embed code" type="button">
          <Code2 size={14} />
          {embedLabel}
        </button>
        <button disabled={!canExport} onClick={onExport} title="Export trace JSON" type="button">
          <Download size={14} />
          Export
        </button>
        <button
          disabled={!canExport}
          onClick={onExportSvg}
          title="Export animated trace SVG"
          type="button"
        >
          <FileImage size={14} />
          SVG
        </button>
        <button onClick={() => fileInputRef.current?.click()} title={importTitle} type="button">
          <Upload size={14} />
          {importLabel}
        </button>
        <HistoryMenu onOpen={onOpenHistoryItem} refreshToken={historyRefreshToken} />
        <details className="panel-menu shortcuts-menu">
          <summary title="Show keyboard and editor shortcuts">
            <HelpCircle size={14} />
            Shortcuts
          </summary>
          <div className="panel-menu-popover shortcuts-popover">
            {SHORTCUTS.map((shortcut) => (
              <div className="shortcut-row" key={shortcut.label}>
                <span className="shortcut-keys">
                  {shortcut.keys.map((key) => (
                    <kbd key={key}>{key}</kbd>
                  ))}
                </span>
                <span>{shortcut.label}</span>
              </div>
            ))}
          </div>
        </details>
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
        <AccountMenu compact />
      </div>
    </header>
  );
}
