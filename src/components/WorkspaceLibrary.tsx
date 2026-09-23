import { useRef, useState } from 'react';
import type { useWorkspaceLibrary } from '../app/useWorkspaceLibrary';

export function WorkspaceLibrary({
  library,
  disabled = false,
}: {
  library: ReturnType<typeof useWorkspaceLibrary>;
  disabled?: boolean;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState('');
  const [revision, setRevision] = useState('');
  const selected = library.items.find((item) => item.id === selectedId);
  const blocked = disabled || library.busy;
  return (
    <details className="panel-menu workspace-library">
      <summary
        aria-label="Open local workspace library"
        title="Named local workspaces and complete backups"
      >
        Library{library.active ? (library.dirty ? ' •' : ' ✓') : ''}
      </summary>
      <div className="panel-menu-popover workspace-popover">
        <strong className="workspace-menu-heading">Local workspace library</strong>
        <p className="account-note">
          Save revisions explicitly. Code, inputs, cases, notes, watches, breakpoints and the
          current replay stay on this device. Export a backup before clearing browser data.
        </p>
        <label className="workspace-field">
          Workspace name
          <input
            type="text"
            aria-label="Workspace name"
            maxLength={120}
            value={library.name}
            onChange={(e) => library.setName(e.target.value)}
          />
        </label>
        <div className="workspace-action-grid">
          <button
            type="button"
            disabled={blocked || !library.name.trim()}
            onClick={() => void library.save()}
          >
            Save revision
          </button>
          <button
            type="button"
            disabled={blocked || !library.name.trim()}
            onClick={() => void library.save(true)}
          >
            Save as copy
          </button>
          <button
            type="button"
            disabled={blocked || !library.name.trim()}
            onClick={library.exportBackup}
          >
            Export workspace
          </button>
          <button type="button" disabled={blocked} onClick={() => file.current?.click()}>
            Restore backup
          </button>
        </div>
        <p className="account-note" role="status">
          {library.busy
            ? 'Working…'
            : library.dirty
              ? 'Unsaved workspace changes'
              : `Local saved · revision ${library.active?.revision}`}
        </p>
        <div className="workspace-menu-section">
          <label className="workspace-field">
            Saved workspaces
            <select
              aria-label="Saved workspaces"
              value={selectedId}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setRevision('');
              }}
            >
              <option value="">
                {library.items.length ? 'Choose a workspace' : 'No saved workspaces yet'}
              </option>
              {library.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · r{item.revision}
                </option>
              ))}
            </select>
          </label>
          <label className="workspace-field">
            Revision
            <input
              aria-label="Workspace revision"
              type="number"
              min={1}
              max={selected?.revision ?? 1}
              value={revision || selected?.revision || ''}
              onChange={(e) => setRevision(e.target.value)}
              disabled={!selected}
            />
          </label>
          <div className="workspace-action-grid">
            <button
              type="button"
              disabled={
                blocked ||
                !selected ||
                !Number.isInteger(Number(revision || selected.revision)) ||
                Number(revision || selected.revision) < 1 ||
                Number(revision || selected.revision) > selected.revision
              }
              onClick={() =>
                selected && void library.open(selected.id, Number(revision || selected.revision))
              }
            >
              Open revision
            </button>
            <button type="button" disabled={blocked} onClick={() => void library.refresh()}>
              Refresh library
            </button>
          </div>
        </div>
        {library.notice && (
          <p className="account-note" role="status">
            {library.notice}
          </p>
        )}
        {library.error && <p role="alert">{library.error}</p>}
        <input
          ref={file}
          aria-label="Restore workspace backup file"
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const backup = e.target.files?.[0];
            if (backup) void library.restore(backup);
            e.target.value = '';
          }}
        />
      </div>
    </details>
  );
}
