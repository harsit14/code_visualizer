import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MAX_WORKSPACE_BYTES,
  parseWorkspace,
  serializeWorkspace,
  type WorkspaceContent,
  type WorkspaceRevision,
} from './workspaceFormat';
import {
  listWorkspaces,
  readWorkspace,
  saveWorkspace,
  type WorkspaceSummary,
} from './workspaceStore';

export function useWorkspaceLibrary(
  content: WorkspaceContent,
  onRestore: (content: WorkspaceContent) => void,
  onSaved: () => void,
  enabled = true,
) {
  const [items, setItems] = useState<WorkspaceSummary[]>([]);
  const [active, setActive] = useState<WorkspaceSummary | null>(null);
  const [name, setName] = useState('Untitled workspace');
  const [saved, setSaved] = useState<{ key: string; result: WorkspaceContent['result'] } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  // Avoid serializing a potentially large trace on every playback step.
  const key = useMemo(() => JSON.stringify({ ...content, result: null }), [content]);
  const dirty =
    !saved || saved.key !== key || saved.result !== content.result || name !== active?.name;
  const latest = useRef({ content, key, name });
  latest.current = { content, key, name };
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const rows = await listWorkspaces();
      if (mounted.current) {
        setItems(rows);
        setError(null);
      }
    } catch {
      if (mounted.current)
        setError(
          'Local workspace storage is unavailable. Retry or export a backup to keep your work.',
        );
    }
  }, []);
  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);
  useEffect(() => {
    if (!enabled || !active || !dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active, dirty, enabled]);

  const confirmReplace = useCallback(
    () =>
      !dirty ||
      window.confirm(
        'Replace the current workspace? Unsaved changes to cases, notes and replay will be lost. Save a revision or export a backup first to keep them.',
      ),
    [dirty],
  );

  /** Stop tracking the open workspace; the next save creates a new one. */
  const detach = useCallback(() => {
    setActive(null);
    setSaved(null);
    setName('Untitled workspace');
    setError(null);
    setNotice('');
  }, []);

  const perform = useCallback(async (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      await action();
    } catch (error) {
      if (mounted.current)
        setError(
          error instanceof Error
            ? error.message
            : 'Workspace action failed. Retry or export a backup.',
        );
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);

  const save = (copy = false) =>
    perform(async () => {
      const snapshot = latest.current;
      const workspace = await saveWorkspace(
        snapshot.name,
        snapshot.content,
        copy ? undefined : (active ?? undefined),
      );
      if (!mounted.current) return;
      setActive(workspace);
      setSaved({ key: snapshot.key, result: snapshot.content.result });
      setName((current) => (current === snapshot.name ? workspace.name : current));
      onSaved();
      setNotice(`Revision ${workspace.revision} saved on this device.`);
      await refresh();
    });

  const apply = (
    workspace: WorkspaceRevision,
    head: WorkspaceSummary,
    previous: typeof latest.current,
  ) => {
    if (!mounted.current) return;
    if (
      latest.current.key !== previous.key ||
      latest.current.content.result !== previous.content.result ||
      latest.current.name !== previous.name
    ) {
      throw new Error(
        'The editor changed while loading. Your current work was kept; retry when ready.',
      );
    }
    onRestore(workspace.content);
    setActive(head);
    setName(workspace.name);
    // Restoring an older revision stays dirty; Save appends after the latest head.
    setSaved(
      workspace.revision === head.revision
        ? {
            key: JSON.stringify({ ...workspace.content, result: null }),
            result: workspace.content.result,
          }
        : null,
    );
    setNotice(
      `Opened revision ${workspace.revision}. ${workspace.revision < head.revision ? 'Save to create a new revision; newer revisions are preserved.' : 'Replay is ready without running code.'}`,
    );
  };

  const open = (id: string, revision: number) => {
    if (!confirmReplace()) return Promise.resolve();
    return perform(async () => {
      const previous = latest.current;
      const heads = await listWorkspaces();
      const head = heads.find((item) => item.id === id);
      if (!head) throw new Error('Workspace is no longer available. Refresh the library.');
      const workspace = await readWorkspace(id, revision);
      apply(workspace, head, previous);
      if (mounted.current) setItems(heads);
    });
  };

  const restore = (file: File) => {
    return perform(async () => {
      if (file.size > MAX_WORKSPACE_BYTES)
        throw new Error('Workspace backups must be no larger than 25 MB.');
      const previous = latest.current;
      const imported = parseWorkspace(await file.text());
      if (!mounted.current) return;
      if (
        latest.current.key !== previous.key ||
        latest.current.content.result !== previous.content.result ||
        latest.current.name !== previous.name
      ) {
        throw new Error(
          'The editor changed while reading the backup. Your current work was kept; retry when ready.',
        );
      }
      if (!confirmReplace()) return;
      // Imported identity never overwrites a local workspace with the same ID.
      const workspace = await saveWorkspace(imported.name, imported.content);
      apply(workspace, workspace, previous);
      await refresh();
    });
  };

  const exportBackup = () => {
    setError(null);
    try {
      const text = serializeWorkspace({
        id: active?.id ?? crypto.randomUUID(),
        name,
        revision: active?.revision ?? 1,
        savedAt: Date.now(),
        content,
      });
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'workspace'}.cvworkspace.json`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(
        'Backup download requested with current changes and replay. Keep the file safe; it contains your code and notes.',
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Backup export failed.');
    }
  };

  return {
    active,
    items,
    name,
    setName,
    dirty,
    busy,
    error,
    notice,
    refresh,
    save,
    open,
    restore,
    exportBackup,
    confirmReplace,
    detach,
  };
}
