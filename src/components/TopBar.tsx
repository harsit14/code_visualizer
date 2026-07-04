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
  MoreHorizontal,
  Moon,
  Palette,
  Sparkles,
  Sun,
  Upload,
} from 'lucide-react';
import { useRef } from 'react';
import { AccountMenu } from './AccountMenu';
import { HistoryMenu } from './HistoryMenu';
import { LogoMark } from './LogoMark';
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
  designMode: 'classic' | 'traced';
  onToggleDesign: () => void;
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
  onShowAllPanels: () => void;
  onTogglePanel: (id: string, visible: boolean) => void;
  panelControls: readonly PanelControl[];
  historyRefreshToken: number;
  status: RuntimeStatus;
  onOpenLanding: () => void;
};

const CUSTOM_ID = '__custom__';
const SHORTCUTS = [
  { keys: ['Cmd/Ctrl', 'Enter'], label: 'Run code' },
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
  designMode,
  onToggleDesign,
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
  onShowAllPanels,
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
        <LogoMark />
        <h1>Code Visualizer</h1>
        <span className={`status-pill status-${status.phase}`}>{status.message}</span>
      </div>

      <div className="top-actions">
        <div className="top-action-row top-action-row-primary">
          <div className="top-action-group top-action-context" aria-label="Workspace context">
            <button onClick={onOpenLanding} title="Back to the landing page" type="button">
              <ArrowLeft size={14} />
              <span className="top-action-label">Landing</span>
            </button>

            <select
              aria-label="Load example"
              className="example-select"
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
              className="language-select"
              onChange={(event) => onLanguageChange(event.target.value as Language)}
              value={language}
            >
              <option value="python">Python</option>
              <option value="javascript">JavaScript</option>
              <option value="typescript">TypeScript</option>
            </select>
          </div>
        </div>

        <div className="top-action-row top-action-row-secondary">
          <div className="top-action-group" aria-label="Workspace tools">
            <HistoryMenu onOpen={onOpenHistoryItem} refreshToken={historyRefreshToken} />
            <details className="panel-menu shortcuts-menu">
              <summary title="Show keyboard and editor shortcuts">
                <HelpCircle size={14} />
                <span className="top-action-label">Shortcuts</span>
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
                <span className="top-action-label">Panels</span>
              </summary>
              <div className="panel-menu-popover">
                <div className="panel-menu-presets" aria-label="Panel layout presets">
                  <button className="panel-menu-action" onClick={onResetLayout} type="button">
                    Beginner
                  </button>
                  <button className="panel-menu-action" onClick={onShowAllPanels} type="button">
                    Show all
                  </button>
                </div>
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
              </div>
            </details>
            <details className="panel-menu trace-actions-menu">
              <summary title="Share, import, and export traces">
                <MoreHorizontal size={14} />
                <span className="top-action-label">Actions</span>
              </summary>
              <div className="panel-menu-popover action-popover">
                <button className="panel-menu-action" onClick={onShare} type="button">
                  <Link2 size={14} />
                  <span>{shareLabel}</span>
                </button>
                <button className="panel-menu-action" onClick={onEmbed} type="button">
                  <Code2 size={14} />
                  <span>{embedLabel}</span>
                </button>
                <button
                  className="panel-menu-action"
                  disabled={!canExport}
                  onClick={onExport}
                  type="button"
                >
                  <Download size={14} />
                  <span>Export JSON</span>
                </button>
                <button
                  className="panel-menu-action"
                  disabled={!canExport}
                  onClick={onExportSvg}
                  type="button"
                >
                  <FileImage size={14} />
                  <span>Export SVG</span>
                </button>
                <button
                  className="panel-menu-action"
                  onClick={() => fileInputRef.current?.click()}
                  title={importTitle}
                  type="button"
                >
                  <Upload size={14} />
                  <span>{importLabel}</span>
                </button>
              </div>
            </details>
          </div>

          <div
            className="top-action-group top-action-appearance"
            aria-label="Appearance and account"
          >
            <details className="panel-menu appearance-menu">
              <summary title="Change visual design and color theme">
                <Palette size={14} />
                <span className="top-action-label">Appearance</span>
              </summary>
              <div className="panel-menu-popover appearance-popover">
                <button
                  aria-pressed={designMode === 'traced'}
                  className={`panel-menu-action design-toggle${
                    designMode === 'traced' ? ' design-toggle-active' : ''
                  }`}
                  onClick={onToggleDesign}
                  type="button"
                >
                  <Sparkles size={14} />
                  <span>{designMode === 'traced' ? 'Classic design' : 'Traced Light'}</span>
                </button>
                <button className="panel-menu-action" onClick={onToggleTheme} type="button">
                  {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
                  <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
                </button>
              </div>
            </details>
            <AccountMenu compact />
          </div>
        </div>

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
      </div>
    </header>
  );
}
