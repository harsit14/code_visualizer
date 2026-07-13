import { FolderOpen, History, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteCodeHistory, listCodeHistory, type CodeHistoryItem } from '../app/historyClient';

type HistoryMenuProps = {
  onOpen: (item: CodeHistoryItem) => void;
  refreshToken: number;
};

export function HistoryMenu({ onOpen, refreshToken }: HistoryMenuProps) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const [items, setItems] = useState<CodeHistoryItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setItems(await listCodeHistory());
    } catch (requestError) {
      setError(errorMessage(requestError));
      setItems([]);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (detailsRef.current?.open) {
      void loadHistory();
    }
  }, [loadHistory, refreshToken]);

  const handleToggle = useCallback(() => {
    if (detailsRef.current?.open) {
      void loadHistory();
    }
  }, [loadHistory]);

  const handleDelete = useCallback(async (item: CodeHistoryItem) => {
    setBusy(true);
    setError(null);
    try {
      await deleteCodeHistory(item.id);
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }, []);

  const handleOpen = useCallback(
    (item: CodeHistoryItem) => {
      onOpen(item);
      detailsRef.current?.removeAttribute('open');
    },
    [onOpen],
  );

  return (
    <details className="panel-menu history-menu" onToggle={handleToggle} ref={detailsRef}>
      <summary aria-label="Open saved code history" title="Open saved code history">
        <History size={14} />
        <span className="top-action-label">History</span>
      </summary>
      <div className="panel-menu-popover history-popover">
        <header className="history-popover-header">
          <div>
            <strong>Saved history</strong>
            <span>
              {items.length > 0 ? `${items.length} recent runs` : 'Recent rerunnable code'}
            </span>
          </div>
          <button
            aria-label="Refresh history"
            className="icon-button history-refresh-button"
            disabled={busy}
            onClick={() => void loadHistory()}
            type="button"
          >
            <RefreshCw size={14} />
          </button>
        </header>

        {error ? (
          <p className="history-note history-note-error" role="alert">
            {error}
          </p>
        ) : null}

        {!error && busy && items.length === 0 ? (
          <p className="history-note">Loading history...</p>
        ) : null}

        {!error && !busy && items.length === 0 ? (
          <p className="history-note">Sign in and run code to save it here.</p>
        ) : null}

        {items.length > 0 ? (
          <div className="history-list">
            {items.map((item) => (
              <article className="history-item" key={item.id}>
                <button
                  className="history-item-main"
                  onClick={() => handleOpen(item)}
                  title="Open this code"
                  type="button"
                >
                  <span className="history-item-title">{item.title}</span>
                  <span className="history-item-preview">{codePreview(item.code)}</span>
                  <span className="history-item-meta">
                    <span>{languageLabel(item.language)}</span>
                    <span>{formatDate(item.lastRunAt)}</span>
                  </span>
                </button>
                <div className="history-item-actions">
                  <button
                    aria-label={`Open ${item.title}`}
                    className="icon-button"
                    onClick={() => handleOpen(item)}
                    type="button"
                  >
                    <FolderOpen size={14} />
                  </button>
                  <button
                    aria-label={`Delete ${item.title}`}
                    className="icon-button"
                    disabled={busy}
                    onClick={() => void handleDelete(item)}
                    type="button"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}

function codePreview(code: string): string {
  return (
    code
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean)
      ?.slice(0, 96) ?? 'Untitled code'
  );
}

function languageLabel(language: CodeHistoryItem['language']): string {
  if (language === 'javascript') {
    return 'JS';
  }
  if (language === 'typescript') {
    return 'TS';
  }
  return 'Python';
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'recently';
  }
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
  }).format(date);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'History request failed.';
}
