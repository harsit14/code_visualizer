import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { syncLibrary, type SyncPassResult } from './workspaceSync';
import {
  createWorkspaceSyncApi,
  WorkspaceSyncError,
  type SyncAccount,
  type WorkspaceSyncApi,
} from './workspaceSyncClient';
import {
  listSyncRecords,
  newSyncRecord,
  updateSyncRecord,
  type SyncRecord,
} from './workspaceSyncStore';
import type { WorkspaceSummary } from './workspaceStore';

const SETTINGS_KEY = 'cv-workspace-sync';
const PASS_DELAY_MS = 1500;
const POLL_MS = 2 * 60_000;

type SyncSettings = {
  enabled: boolean;
  /** The account this library syncs with; kept while signed out or switched. */
  account: SyncAccount | null;
  cursor: number;
  lastSyncedAt: number | null;
};
const OFF: SyncSettings = { enabled: false, account: null, cursor: 0, lastSyncedAt: null };

/** Why sync is or is not running, for the Library to explain. */
export type SyncMode =
  | 'static'
  | 'offline'
  | 'unavailable'
  | 'checking'
  | 'signed-out'
  | 'other-account'
  | 'ready';
export type WorkspaceSyncState = {
  kind: 'local' | 'pending' | 'syncing' | 'synced' | 'failed' | 'conflict';
  label: string;
  detail: string | null;
};

function readSettings(): SyncSettings {
  try {
    const value = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<SyncSettings>;
    const account = value?.account;
    if (
      typeof value?.enabled === 'boolean' &&
      typeof value.cursor === 'number' &&
      (account === null || (typeof account?.id === 'string' && typeof account.email === 'string'))
    ) {
      return {
        enabled: value.enabled,
        account: account ? { id: account.id, email: account.email } : null,
        cursor: value.cursor,
        lastSyncedAt: typeof value.lastSyncedAt === 'number' ? value.lastSyncedAt : null,
      };
    }
  } catch {
    /* unreadable settings mean sync is off */
  }
  return OFF;
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** Local revisions or tags not yet in the library's account. */
function needsUpload(item: WorkspaceSummary, record: SyncRecord | undefined, account: string) {
  if (!record) return true;
  if (record.localOnly || (record.account && record.account !== account)) return false;
  return item.revision > record.remoteRevision || item.metaRevision !== record.localMetaRevision;
}

/** Runs sync passes while the library is opted in and signed in to its account. */
export function useWorkspaceSync({
  items,
  refresh,
  activeId = null,
  accounts,
  known,
  online,
  allowed = true,
  api: injectedApi,
  delayMs = PASS_DELAY_MS,
  pollMs = POLL_MS,
}: {
  items: WorkspaceSummary[];
  refresh: () => Promise<void>;
  /** The workspace open in this tab, to explain when sync moved its head. */
  activeId?: string | null;
  /** The host offers accounts; `known` is false until it has answered. */
  accounts: boolean;
  known: boolean;
  online: boolean;
  /** False in embeds, where the Library is not shown. */
  allowed?: boolean;
  api?: WorkspaceSyncApi;
  delayMs?: number;
  pollMs?: number;
}) {
  const api = useMemo(() => injectedApi ?? createWorkspaceSyncApi(), [injectedApi]);
  const [settings, setSettings] = useState(readSettings);
  const [records, setRecords] = useState<Map<string, SyncRecord>>(() => new Map());
  /** undefined while unknown, null when signed out. */
  const [user, setUser] = useState<SyncAccount | null | undefined>(undefined);
  const [userCheck, setUserCheck] = useState(0);
  const [unavailable, setUnavailable] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'syncing' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const settingsRef = useRef(settings);
  const running = useRef<AbortController | null>(null);
  const queued = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const mounted = useRef(true);
  const latest = useRef({ activeId, refresh });
  latest.current = { activeId, refresh };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      running.current?.abort();
      window.clearTimeout(timer.current);
    };
  }, []);

  const mode: SyncMode =
    known && !accounts
      ? 'static'
      : !online
        ? 'offline'
        : unavailable
          ? 'unavailable'
          : user === undefined
            ? 'checking'
            : user === null
              ? 'signed-out'
              : settings.enabled && settings.account && settings.account.id !== user.id
                ? 'other-account'
                : 'ready';
  const active = allowed && mode === 'ready' && settings.enabled && settings.account !== null;
  const modeRef = useRef({ active, user });
  modeRef.current = { active, user };

  const updateSettings = useCallback((change: (previous: SyncSettings) => SyncSettings) => {
    const next = change(settingsRef.current);
    settingsRef.current = next;
    setSettings(next);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      /* the choice lasts for this visit */
    }
  }, []);

  const reloadRecords = useCallback(async () => {
    try {
      const rows = await listSyncRecords();
      if (mounted.current) setRecords(new Map(rows.map((row) => [row.id, row])));
    } catch {
      /* the Library already reports unavailable storage */
    }
  }, []);
  const hosted = allowed && !(known && !accounts);
  useEffect(() => {
    if (hosted) void reloadRecords();
  }, [hosted, items, reloadRecords]);

  // While another account is signed in, new work is held on this device, so it is
  // not uploaded to the library's account when that account signs back in.
  const holding = allowed && mode === 'other-account';
  useEffect(() => {
    if (!holding) return;
    const unattached = items.filter((item) => {
      const record = records.get(item.id);
      return !record || (!record.localOnly && !record.account);
    });
    if (!unattached.length) return;
    void Promise.all(
      unattached.map((item) =>
        updateSyncRecord(item.id, (current) =>
          current?.localOnly || current?.account
            ? null
            : { ...(current ?? newSyncRecord(item.id, null)), localOnly: true, held: true },
        ),
      ),
    ).then(reloadRecords, () => {});
  }, [holding, items, records, reloadRecords]);

  const recheckAccount = useCallback(() => {
    running.current?.abort();
    running.current = null;
    setUser(undefined);
    setUserCheck((value) => value + 1);
  }, []);
  useEffect(() => {
    if (!allowed || !accounts || !online) return;
    const controller = new AbortController();
    api
      .currentAccount(controller.signal)
      .then((account) => {
        if (!controller.signal.aborted) setUser(account);
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        if (reason instanceof WorkspaceSyncError && reason.code === 'static_host') {
          setUnavailable(true);
        }
        setUser(null);
      });
    return () => controller.abort();
  }, [accounts, allowed, api, online, userCheck]);

  // Sign-in, sign-out and account changes, here or in another tab, stop any pass at once.
  useEffect(() => {
    const storage = (event: StorageEvent) => {
      if (event.key === 'cv-account-change') recheckAccount();
      if (event.key === SETTINGS_KEY) {
        settingsRef.current = readSettings();
        setSettings(settingsRef.current);
      }
    };
    window.addEventListener('cv-account-changed', recheckAccount);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener('cv-account-changed', recheckAccount);
      window.removeEventListener('storage', storage);
    };
  }, [recheckAccount]);

  const report = useCallback((result: SyncPassResult) => {
    const messages = [...result.notices];
    if (result.pulled) {
      messages.push(
        `Added ${plural(result.pulled, 'workspace')} from your account. Nothing was run; open one to replay it.`,
      );
    }
    const { activeId: open } = latest.current;
    if (open && result.changed.includes(open)) {
      messages.push(
        'The open workspace has a newer revision from sync. Reopen it from the Library before saving, or save your edits as a copy.',
      );
    }
    if (messages.length) setNotice(messages.join(' '));
  }, []);

  const schedule = useRef<(delay?: number) => void>(() => {});
  const runPass = useCallback(async () => {
    const current = settingsRef.current;
    if (!modeRef.current.active || !current.account) return;
    if (running.current) {
      queued.current = true;
      return;
    }
    const controller = new AbortController();
    running.current = controller;
    const account = current.account.id;
    // Refreshing the list also clears Library errors, so it waits for real changes.
    let libraryChanged = true;
    setPhase('syncing');
    setError(null);
    try {
      const pass = () =>
        syncLibrary({ api, account, cursor: current.cursor, signal: controller.signal });
      // One pass at a time across tabs, where the browser supports it.
      const result = navigator.locks
        ? await navigator.locks.request('cv-workspace-sync', { signal: controller.signal }, pass)
        : await pass();
      libraryChanged = result.libraryChanged;
      if (controller.signal.aborted || !mounted.current) return;
      report(result);
      const stopped = result.stopped;
      if (stopped?.code === 'sync_unavailable' || stopped?.code === 'static_host') {
        setUnavailable(true);
        setPhase('idle');
      } else if (stopped?.code === 'account_mismatch' || stopped?.code === 'signed_out') {
        setPhase('idle');
        recheckAccount();
      } else if (stopped) {
        setPhase('failed');
        setError(stopped.message);
        if (stopped.retryAfterMs) schedule.current(stopped.retryAfterMs);
      } else {
        updateSettings((previous) =>
          previous.account?.id === account
            ? { ...previous, cursor: result.cursor, lastSyncedAt: Date.now() }
            : previous,
        );
        setPhase(result.failed ? 'failed' : 'idle');
        setError(
          result.failed
            ? `${plural(result.failed, 'workspace')} could not sync. Select one to see why.`
            : null,
        );
      }
    } catch (reason) {
      if (controller.signal.aborted || !mounted.current) return;
      setPhase('failed');
      setError(reason instanceof Error ? reason.message : 'Sync failed. Retry when ready.');
    } finally {
      if (running.current === controller) running.current = null;
      if (mounted.current) {
        // An aborted pass settles quietly unless a newer pass already started.
        if (controller.signal.aborted && !running.current) setPhase('idle');
        await reloadRecords();
        if (libraryChanged) await latest.current.refresh();
      }
      if (queued.current) {
        queued.current = false;
        schedule.current(0);
      }
    }
  }, [api, recheckAccount, reloadRecords, report, updateSettings]);

  schedule.current = (delay = delayMs) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void runPass(), delay);
  };

  const pendingKey = useMemo(() => {
    const account = settings.account?.id;
    if (!account) return '';
    return items
      .filter((item) => needsUpload(item, records.get(item.id), account))
      .map((item) => `${item.id}:${item.revision}:${item.metaRevision}`)
      .join(',');
  }, [items, records, settings.account]);

  useEffect(() => {
    if (active) schedule.current(0);
    else {
      window.clearTimeout(timer.current);
      running.current?.abort();
    }
  }, [active, settings.account?.id]);
  useEffect(() => {
    if (active && pendingKey) schedule.current();
  }, [active, pendingKey]);
  useEffect(() => {
    if (!active) return;
    const visible = () => {
      if (document.visibilityState === 'visible') schedule.current(0);
    };
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void runPass();
    }, pollMs);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [active, pollMs, runPass]);

  const enable = useCallback(async () => {
    const account = modeRef.current.user;
    if (!account) return;
    // Work held while this account was signed in elsewhere joins it on a switch.
    const switching = settingsRef.current.account?.id !== account.id;
    const held = switching ? items.filter((item) => records.get(item.id)?.held) : [];
    const fresh =
      held.length +
      items.filter((item) => {
        const record = records.get(item.id);
        return !record?.localOnly && !record?.account;
      }).length;
    const others = items.filter((item) => {
      const record = records.get(item.id);
      return record?.account && record.account !== account.id;
    }).length;
    const question = [
      `Sync this library with ${account.email}?`,
      fresh
        ? `${plural(fresh, 'workspace')} on this device will be uploaded to that account: code, inputs, cases, notes and replay.`
        : 'Nothing on this device needs uploading yet.',
      'Workspaces marked Keep local only stay here, and autosaves are never uploaded.',
      others
        ? `${plural(others, 'workspace')} synced with another account stay on this device and are not uploaded to this one.`
        : '',
    ]
      .filter(Boolean)
      .join(' ');
    if (!window.confirm(question)) return;
    setUnavailable(false);
    setNotice('');
    await Promise.all(
      held.map((item) =>
        updateSyncRecord(item.id, (current) =>
          current?.held ? { ...current, localOnly: false, held: false } : null,
        ),
      ),
    );
    await reloadRecords();
    updateSettings((previous) =>
      previous.account?.id === account.id
        ? { ...previous, enabled: true, account }
        : { enabled: true, account, cursor: 0, lastSyncedAt: null },
    );
  }, [items, records, reloadRecords, updateSettings]);

  const disable = useCallback(() => {
    running.current?.abort();
    updateSettings((previous) => ({ ...previous, enabled: false }));
    setPhase('idle');
    setError(null);
    setNotice(
      'Sync is off. Copies already in your account stay there; this device keeps its workspaces.',
    );
  }, [updateSettings]);

  const setLocalOnly = useCallback(
    async (id: string, localOnly: boolean) => {
      await updateSyncRecord(id, (current) =>
        localOnly
          ? { ...(current ?? newSyncRecord(id, null)), localOnly: true, issue: null }
          : current && { ...current, localOnly: false, held: false },
      );
      await reloadRecords();
    },
    [reloadRecords],
  );

  const dismissIssue = useCallback(
    async (id: string) => {
      await updateSyncRecord(id, (current) => current && { ...current, issue: null });
      await reloadRecords();
    },
    [reloadRecords],
  );

  const removeFromAccount = useCallback(
    async (item: WorkspaceSummary) => {
      const account = settingsRef.current.account;
      if (!account || !modeRef.current.active) return;
      if (
        !window.confirm(
          `Remove “${item.name}” from ${account.email}? Its revisions are deleted from the account. Other devices keep their copies as local only, and so does this one.`,
        )
      )
        return;
      setError(null);
      try {
        await api.removeWorkspace(account.id, item.id);
      } catch (reason) {
        if (!(reason instanceof WorkspaceSyncError && reason.code === 'missing')) {
          setError(reason instanceof Error ? reason.message : 'Could not remove the workspace.');
          return;
        }
      }
      await updateSyncRecord(item.id, (current) => ({
        ...(current ?? newSyncRecord(item.id, account.id)),
        localOnly: true,
        remoteRevision: 0,
        metaVersion: 0,
        localMetaRevision: -1,
        issue: null,
      }));
      await reloadRecords();
      setNotice(`“${item.name}” was removed from your account and stays on this device.`);
    },
    [api, reloadRecords],
  );

  const statusOf = useCallback(
    (item: WorkspaceSummary): WorkspaceSyncState => {
      const record = records.get(item.id);
      const account = settings.account;
      if (record?.held) {
        return {
          kind: 'local',
          label: 'Local only',
          detail:
            'Saved while a different account was signed in, so it stays on this device. Clear Keep local only to sync it.',
        };
      }
      if (record?.localOnly) return { kind: 'local', label: 'Local only', detail: null };
      if (!settings.enabled || !account) {
        return { kind: 'local', label: 'Local only', detail: 'Library sync is off.' };
      }
      if (record?.account && record.account !== account.id) {
        return {
          kind: 'local',
          label: 'Local only',
          detail: 'Synced with another account, so it is not uploaded to this one.',
        };
      }
      if (record?.issue?.kind === 'conflict') {
        return { kind: 'conflict', label: 'Conflict', detail: record.issue.message };
      }
      if (record?.issue?.kind === 'failed') {
        return { kind: 'failed', label: 'Sync failed', detail: record.issue.message };
      }
      if (!needsUpload(item, record, account.id)) {
        return { kind: 'synced', label: 'Synced', detail: null };
      }
      if (active && phase === 'syncing') {
        return { kind: 'syncing', label: 'Syncing…', detail: null };
      }
      return {
        kind: 'pending',
        label: 'Waiting to sync',
        detail: active ? null : 'Sync resumes when you are online and signed in to its account.',
      };
    },
    [active, phase, records, settings.account, settings.enabled],
  );

  return {
    mode,
    enabled: settings.enabled,
    /** The account the library syncs with. */
    account: settings.account,
    /** The signed-in account, once known. */
    user: user ?? null,
    phase,
    error,
    notice,
    lastSyncedAt: settings.lastSyncedAt,
    statusOf,
    isLocalOnly: (id: string) => records.get(id)?.localOnly ?? false,
    /** True when the library's account holds a copy that Remove from account would delete. */
    inAccount: (id: string) => {
      const record = records.get(id);
      return !!record && record.account === settings.account?.id && record.remoteRevision > 0;
    },
    enable,
    disable,
    syncNow: () => void runPass(),
    setLocalOnly,
    dismissIssue,
    removeFromAccount,
  };
}

export type WorkspaceSyncView = ReturnType<typeof useWorkspaceSync>;
