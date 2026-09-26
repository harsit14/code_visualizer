import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  identify,
  sameIdentity,
  useWorkspaceAutosave,
  type AutosaveIdentity,
  type AutosaveState,
} from './useWorkspaceAutosave';
import { MAX_ARCHIVE_BYTES, parseLibraryArchive, type SkippedEntry } from './workspaceArchive';
import {
  MAX_WORKSPACE_BYTES,
  parseWorkspaceBackup,
  serializeWorkspace,
  type WorkspaceContent,
  type WorkspaceRevision,
} from './workspaceFormat';
import {
  discardAutosave as discardStoredAutosave,
  exportLibrary,
  importLibrary,
  listWorkspaces,
  readAutosave,
  readWorkspace,
  saveWorkspace,
  updateWorkspaceMeta,
  WorkspaceMetaConflictError,
  AutosaveConflictError,
  type AutosaveInfo,
  type WorkspaceSummary,
} from './workspaceStore';
import { EMPTY_META, localDate, type WorkspaceMeta } from './workspaceTags';

type ActiveWorkspace = Pick<WorkspaceSummary, 'id' | 'name' | 'revision'>;
/** An autosave found when opening a workspace, waiting for Restore or Discard. */
export type AutosaveOffer = {
  id: string;
  headRevision: number;
  info: AutosaveInfo;
  /** Editor state right after opening, to notice edits made before choosing. */
  opened: AutosaveIdentity;
};

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
export const formatTime = (time: number) =>
  new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(time);
const metaOf = (item?: WorkspaceMeta): WorkspaceMeta =>
  item
    ? { tags: item.tags, needsReview: item.needsReview, reviewBy: item.reviewBy }
    : { ...EMPTY_META, tags: [] };
const contentIdentity = (workspace: WorkspaceRevision): AutosaveIdentity => ({
  key: JSON.stringify({ ...workspace.content, result: null }),
  name: workspace.name,
  result: workspace.content.result,
});

function download(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function describeSkipped(skipped: SkippedEntry[]) {
  const shown = skipped
    .slice(0, 3)
    .map((entry) => `“${entry.name}” (${entry.reason})`)
    .join('; ');
  return skipped.length > 3 ? `${shown}; and ${skipped.length - 3} more` : shown;
}

/** Status text for the autosave slot, shown beside the draft and revision status. */
export function describeAutosave(
  autosave: { state: AutosaveState; pending: boolean; needsName: boolean },
  offer: AutosaveOffer | null,
): { text: string; alert: boolean; retry: boolean } | null {
  const { state } = autosave;
  if (offer)
    return {
      text: 'Autosave paused: restore or discard the earlier autosave in Library',
      alert: false,
      retry: false,
    };
  if (state.phase === 'conflict')
    return { text: `Autosave stopped. ${state.message}`, alert: true, retry: false };
  if (state.phase === 'failed')
    return { text: 'Autosave failed — retry', alert: true, retry: true };
  if (state.phase === 'saving') return { text: 'Autosaving…', alert: false, retry: false };
  if (autosave.needsName)
    return { text: 'Autosave waits for a workspace name', alert: false, retry: false };
  if (autosave.pending) return { text: 'Autosave pending…', alert: false, retry: false };
  if (state.phase === 'saved')
    return { text: `Autosaved ${formatTime(state.savedAt)}`, alert: false, retry: false };
  return null;
}

export function useWorkspaceLibrary(
  content: WorkspaceContent,
  onRestore: (content: WorkspaceContent) => void,
  onSaved: () => void,
  enabled = true,
  { autosaveDelayMs }: { autosaveDelayMs?: number } = {},
) {
  const [items, setItems] = useState<WorkspaceSummary[]>([]);
  const [active, setActive] = useState<ActiveWorkspace | null>(null);
  const [name, setName] = useState('Untitled workspace');
  const [saved, setSaved] = useState<{ key: string; result: WorkspaceContent['result'] } | null>(
    null,
  );
  const [offer, setOffer] = useState<AutosaveOffer | null>(null);
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
  const autosave = useWorkspaceAutosave(latest.current, {
    enabled,
    paused: offer !== null,
    delayMs: autosaveDelayMs,
    onSaved: (id, info) =>
      setItems((list) => list.map((item) => (item.id === id ? { ...item, autosave: info } : item))),
  });

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

  const { start: startAutosave, stop: stopAutosave } = autosave;
  /** Stop tracking the open workspace; the next save creates a new one. */
  const detach = useCallback(() => {
    // Pending edits still reach the autosave slot, so reopening can offer them.
    stopAutosave();
    setActive(null);
    setSaved(null);
    setOffer(null);
    setName('Untitled workspace');
    setError(null);
    setNotice('');
  }, [stopAutosave]);

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
    perform(() =>
      autosave.exclusive(async () => {
        const snapshot = latest.current;
        const workspace = await saveWorkspace(
          snapshot.name,
          snapshot.content,
          copy ? undefined : (active ?? undefined),
          copy
            ? { meta: metaOf(items.find((item) => item.id === active?.id)) }
            : { autosaveToken: autosave.token() },
        );
        if (!mounted.current) return;
        const { id, revision } = workspace;
        setActive({ id, name: workspace.name, revision });
        setSaved({ key: snapshot.key, result: snapshot.content.result });
        setName((current) => (current === snapshot.name ? workspace.name : current));
        startAutosave({ id, revision }, identify({ ...snapshot, name: workspace.name }), null);
        // An offer for this workspace stays: another tab's autosave is still in its slot.
        setOffer((current) => (current?.id === id ? { ...current, headRevision: revision } : null));
        onSaved();
        setNotice(`Revision ${workspace.revision} saved on this device.`);
        await refresh();
      }),
    );

  const edited = (previous: typeof latest.current) =>
    latest.current.key !== previous.key ||
    latest.current.content.result !== previous.content.result ||
    latest.current.name !== previous.name;

  const apply = (
    workspace: WorkspaceRevision,
    head: ActiveWorkspace & { autosave?: AutosaveInfo | null },
    previous: typeof latest.current,
  ) => {
    if (!mounted.current) return;
    if (edited(previous)) {
      throw new Error(
        'The editor changed while loading. Your current work was kept; retry when ready.',
      );
    }
    onRestore(workspace.content);
    setActive({ id: head.id, name: head.name, revision: head.revision });
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
    const opened = contentIdentity(workspace);
    startAutosave({ id: head.id, revision: head.revision }, opened, null);
    setOffer(
      head.autosave
        ? { id: head.id, headRevision: head.revision, info: head.autosave, opened }
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

  /** Re-reads the head after another tab changed its autosave, so the offer stays accurate. */
  const reconcileOffer = async (id: string) => {
    const heads = await listWorkspaces();
    if (!mounted.current) return;
    setItems(heads);
    const head = heads.find((item) => item.id === id);
    setOffer((current) =>
      current?.id === id && head?.autosave ? { ...current, info: head.autosave } : null,
    );
  };

  const restoreAutosave = () => {
    const pendingOffer = offer;
    if (!pendingOffer) return Promise.resolve();
    if (
      !sameIdentity(pendingOffer.opened, latest.current) &&
      !window.confirm('Replace your edits since opening with the autosave?')
    )
      return Promise.resolve();
    return perform(async () => {
      const previous = latest.current;
      const found = await readAutosave(pendingOffer.id);
      if (!found || found.info.token !== pendingOffer.info.token) {
        await reconcileOffer(pendingOffer.id);
        throw new AutosaveConflictError();
      }
      if (!mounted.current) return;
      if (edited(previous)) {
        throw new Error(
          'The editor changed while loading. Your current work was kept; retry when ready.',
        );
      }
      onRestore(found.workspace.content);
      setName(found.workspace.name);
      // `saved` keeps the opened revision, so the restored edits show as unsaved.
      startAutosave(
        { id: pendingOffer.id, revision: pendingOffer.headRevision },
        contentIdentity(found.workspace),
        found.info.token,
      );
      setOffer(null);
      setNotice(
        `Restored the autosave from ${formatTime(found.info.savedAt)}. Save to keep it as revision ${pendingOffer.headRevision + 1}.`,
      );
    });
  };

  const discardAutosave = () => {
    const pendingOffer = offer;
    if (
      !pendingOffer ||
      !window.confirm(
        `Discard the autosave from ${formatTime(pendingOffer.info.savedAt)}? Its unsaved changes will be deleted from this device.`,
      )
    )
      return Promise.resolve();
    return perform(async () => {
      try {
        await discardStoredAutosave(pendingOffer.id, pendingOffer.info.token);
      } catch (error) {
        if (error instanceof AutosaveConflictError) await reconcileOffer(pendingOffer.id);
        throw error;
      }
      if (!mounted.current) return;
      setOffer(null);
      setItems((list) =>
        list.map((item) => (item.id === pendingOffer.id ? { ...item, autosave: null } : item)),
      );
      setNotice('Autosave discarded. Your next edit starts a new autosave.');
    });
  };

  /** Tags and review state change the workspace's metadata, never its revisions. */
  const updateMeta = (id: string, patch: Partial<WorkspaceMeta>) =>
    perform(async () => {
      const item = items.find((entry) => entry.id === id);
      if (!item) throw new Error('Workspace is no longer available. Refresh the library.');
      try {
        const updated = await updateWorkspaceMeta(id, item.metaRevision, {
          ...metaOf(item),
          ...patch,
        });
        if (mounted.current)
          setItems((list) => list.map((entry) => (entry.id === id ? updated : entry)));
      } catch (error) {
        if (error instanceof WorkspaceMetaConflictError) await refresh();
        throw error;
      }
    });

  const restore = (file: File) => {
    return perform(async () => {
      if (file.size > MAX_WORKSPACE_BYTES)
        throw new Error('Workspace backups must be no larger than 25 MB.');
      const previous = latest.current;
      const { workspace: imported, meta } = parseWorkspaceBackup(await file.text());
      if (!mounted.current) return;
      if (edited(previous)) {
        throw new Error(
          'The editor changed while reading the backup. Your current work was kept; retry when ready.',
        );
      }
      if (!confirmReplace()) return;
      // Imported identity never overwrites a local workspace with the same ID.
      const workspace = await saveWorkspace(imported.name, imported.content, undefined, { meta });
      apply(workspace, workspace, previous);
      await refresh();
    });
  };

  const exportBackup = () => {
    setError(null);
    try {
      const text = serializeWorkspace(
        {
          id: active?.id ?? crypto.randomUUID(),
          name,
          revision: active?.revision ?? 1,
          savedAt: Date.now(),
          content,
        },
        metaOf(items.find((item) => item.id === active?.id)),
      );
      download(
        text,
        `${name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'workspace'}.cvworkspace.json`,
      );
      setNotice(
        'Backup download requested with current changes and replay. Keep the file safe; it contains your code and notes.',
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Backup export failed.');
    }
  };

  const exportArchive = (includeHistory: boolean) =>
    perform(async () => {
      // Pending edits of the open workspace belong in the archive too.
      await autosave.flush();
      const result = await exportLibrary(includeHistory);
      if (!result.workspaces) throw new Error('There are no saved workspaces to export yet.');
      download(result.text, `code-visualizer-library-${localDate()}.cvlibrary.json`);
      if (!mounted.current) return;
      setNotice(
        [
          `Library download requested: ${plural(result.workspaces, 'workspace')}, ${plural(result.revisions, 'revision')}, ${plural(result.autosaves, 'autosave')}.`,
          includeHistory && !result.history
            ? 'Every revision would exceed 100 MB, so each workspace has only its latest revision.'
            : '',
          result.damaged ? `${plural(result.damaged, 'damaged record')} left out.` : '',
          'Keep the file safe; it contains your code and notes.',
        ]
          .filter(Boolean)
          .join(' '),
      );
    });

  /** Adds an archive's workspaces under new IDs; the editor and open workspace are untouched. */
  const importArchive = (file: File) =>
    perform(async () => {
      if (file.size > MAX_ARCHIVE_BYTES)
        throw new Error('Library archives must be no larger than 100 MB.');
      const { entries, skipped } = parseLibraryArchive(await file.text());
      if (!entries.length)
        throw new Error(`Nothing was imported. Invalid workspaces: ${describeSkipped(skipped)}.`);
      const result = await importLibrary(entries);
      await refresh();
      if (!mounted.current) return;
      const skippedCount = skipped.length + result.duplicates;
      setNotice(
        [
          `Imported ${plural(result.imported, 'workspace')} with ${plural(result.revisions, 'revision')}. No code was run.`,
          skippedCount
            ? `Skipped ${skippedCount}: ${result.duplicates} already in the library, ${skipped.length} invalid${skipped.length ? ` — ${describeSkipped(skipped)}` : ''}.`
            : '',
        ]
          .filter(Boolean)
          .join(' '),
      );
    });

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
    offer,
    restoreAutosave,
    discardAutosave,
    autosave: describeAutosave(autosave, offer),
    autosaveState: autosave.state,
    retryAutosave: autosave.flush,
    updateMeta,
    exportArchive,
    importArchive,
    /** Pattern notes of the open exercise, used to rank tag suggestions. */
    notebookPatterns: content.notebook.patterns,
  };
}
