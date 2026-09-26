import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkspaceContent } from './workspaceFormat';
import {
  AutosaveConflictError,
  autosaveWorkspace,
  WorkspaceConflictError,
  type AutosaveInfo,
} from './workspaceStore';

export const AUTOSAVE_DELAY_MS = 1500;

export type AutosaveSnapshot = { content: WorkspaceContent; key: string; name: string };
export type AutosaveState =
  | { phase: 'idle' | 'saving' }
  | { phase: 'saved'; savedAt: number }
  | { phase: 'failed' | 'conflict'; message: string };
/** What was last stored; compared by reference for the (large) trace. */
export type AutosaveIdentity = {
  key: string;
  name: string;
  result: WorkspaceContent['result'];
};
type Session = {
  target: { id: string; revision: number };
  /** Token of the autosave this tab last wrote or restored; null when the slot should be empty. */
  token: string | null;
  baseline: AutosaveIdentity | null;
  ended: boolean;
  /** Set after a conflict: this tab must not write again until the workspace is reopened. */
  stopped: boolean;
};

export const identify = (snapshot: AutosaveSnapshot): AutosaveIdentity => ({
  key: snapshot.key,
  name: snapshot.name,
  result: snapshot.content.result,
});
export const sameIdentity = (a: AutosaveIdentity | null, snapshot: AutosaveSnapshot) =>
  !!a && a.key === snapshot.key && a.name === snapshot.name && a.result === snapshot.content.result;

/**
 * Debounced writes of an open workspace into its single autosave slot. Writes and
 * explicit saves share one queue, so an autosave never races the revision it precedes.
 */
export function useWorkspaceAutosave(
  snapshot: AutosaveSnapshot,
  {
    enabled,
    paused,
    delayMs = AUTOSAVE_DELAY_MS,
    onSaved,
  }: {
    enabled: boolean;
    /** A restore offer is pending; writing would replace the autosave being offered. */
    paused: boolean;
    delayMs?: number;
    onSaved: (id: string, info: AutosaveInfo) => void;
  },
) {
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const mounted = useRef(true);
  const session = useRef<Session | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const [state, setState] = useState<AutosaveState>({ phase: 'idle' });
  const [tracked, setTracked] = useState<{ on: boolean; baseline: AutosaveIdentity | null }>({
    on: false,
    baseline: null,
  });

  const enqueue = useCallback(
    (s: Session | null, snap: AutosaveSnapshot, final = false): Promise<unknown> => {
      const skip = (target: Session) =>
        target.stopped ||
        (target.ended && !final) ||
        pausedRef.current ||
        !snap.name.trim() ||
        sameIdentity(target.baseline, snap);
      if (!s || skip(s)) return chain.current;
      const current = () => mounted.current && session.current === s;
      const run = chain.current.then(async () => {
        // An earlier queued write may already have stored this snapshot.
        if (skip(s)) return;
        if (current()) setState({ phase: 'saving' });
        try {
          const info = await autosaveWorkspace(snap.name, snap.content, s.target, s.token);
          s.token = info.token;
          s.baseline = identify(snap);
          if (!mounted.current) return;
          onSavedRef.current(s.target.id, info);
          if (current()) {
            setState({ phase: 'saved', savedAt: info.savedAt });
            setTracked({ on: true, baseline: s.baseline });
          }
        } catch (error) {
          const conflict =
            error instanceof AutosaveConflictError || error instanceof WorkspaceConflictError;
          if (conflict) s.stopped = true;
          if (current())
            setState({
              phase: conflict ? 'conflict' : 'failed',
              message: error instanceof Error ? error.message : 'Autosave failed.',
            });
        }
      });
      chain.current = run;
      return run;
    },
    [],
  );

  const flush = useCallback(() => enqueue(session.current, latest.current), [enqueue]);

  /** Tracks a workspace whose stored state matches `baseline` (after open, save or restore). */
  const start = useCallback(
    (
      target: { id: string; revision: number },
      baseline: AutosaveIdentity | null,
      token: string | null,
    ) => {
      if (session.current) session.current.ended = true;
      session.current = { target, token, baseline, ended: false, stopped: false };
      setState({ phase: 'idle' });
      setTracked({ on: true, baseline });
    },
    [],
  );

  /** Stores pending edits of the open workspace one last time, then stops tracking it. */
  const stop = useCallback(() => {
    const s = session.current;
    if (!s) return;
    void enqueue(s, latest.current, true);
    s.ended = true;
    session.current = null;
    setState({ phase: 'idle' });
    setTracked({ on: false, baseline: null });
  }, [enqueue]);

  /** Runs `work` after queued autosaves; autosaves requested meanwhile wait for it. */
  const exclusive = useCallback(<T>(work: () => Promise<T>): Promise<T> => {
    const run = chain.current.then(work);
    chain.current = run.catch(() => undefined);
    return run;
  }, []);

  const token = useCallback(() => session.current?.token ?? null, []);

  useEffect(() => {
    mounted.current = true;
    const hide = () => void flush();
    const visibility = () => {
      if (document.visibilityState === 'hidden') hide();
    };
    window.addEventListener('pagehide', hide);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      mounted.current = false;
      void enqueue(session.current, latest.current, true);
      window.removeEventListener('pagehide', hide);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [enqueue, flush]);

  const changed = tracked.on && !sameIdentity(tracked.baseline, snapshot);
  const needsName = changed && !snapshot.name.trim();
  const waiting = changed && enabled && !paused && !needsName && state.phase !== 'conflict';
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(() => void flush(), delayMs);
    return () => window.clearTimeout(timer);
  }, [waiting, snapshot.key, snapshot.name, snapshot.content.result, delayMs, flush]);

  return {
    state,
    /** Edits exist that the slot does not hold yet. */
    pending: waiting,
    needsName,
    start,
    stop,
    flush,
    exclusive,
    token,
  };
}
