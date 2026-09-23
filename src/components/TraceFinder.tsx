/**
 * Trace search and bookmarks: find steps by variable change, value, line,
 * function, event or printed output, and keep annotated bookmarks.
 */
import { Bookmark, BookmarkCheck, Search, X } from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  parseTraceQuery,
  searchTrace,
  TRACE_SEARCH_HELP,
  type TraceBookmark,
} from '../engine/traceSearch';
import type { TraceStep } from '../engine/types';

type TraceFinderProps = {
  steps: readonly TraceStep[];
  stdout: string;
  step: number;
  bookmarks: readonly TraceBookmark[];
  onJump: (step: number) => void;
  onToggleBookmark: (step: number) => void;
  onBookmarkNote: (step: number, note: string) => void;
  /** Changing this value opens the finder and focuses the search box. */
  openRequest?: number;
};

export function TraceFinder({
  steps,
  stdout,
  step,
  bookmarks,
  onJump,
  onToggleBookmark,
  onBookmarkNote,
  openRequest = 0,
}: TraceFinderProps) {
  const menu = useRef<HTMLDetailsElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const deferred = useDeferredValue(text);
  const query = useMemo(() => parseTraceQuery(deferred), [deferred]);
  const results = useMemo(
    () => (query ? searchTrace(steps, query, stdout) : null),
    [query, steps, stdout],
  );
  const bookmarked = bookmarks.some((bookmark) => bookmark.step === step);

  useEffect(() => {
    if (!openRequest || !menu.current) return;
    menu.current.open = true;
    input.current?.focus();
    input.current?.select();
  }, [openRequest]);

  return (
    <details className="panel-menu trace-finder" ref={menu}>
      <summary
        aria-label="Search the trace and bookmarks"
        title="Search the trace and bookmarks (/)"
      >
        <Search size={14} />
        {bookmarks.length ? <span className="trace-finder-count">{bookmarks.length}</span> : null}
      </summary>
      <div className="panel-menu-popover trace-finder-popover">
        <label className="trace-finder-field">
          <span>Find in trace</span>
          <input
            aria-describedby="trace-finder-help"
            aria-label="Search the trace"
            onChange={(event) => setText(event.target.value)}
            placeholder="total = 6, line 12, return…"
            ref={input}
            spellCheck={false}
            type="search"
            value={text}
          />
        </label>
        <p className="trace-finder-help" id="trace-finder-help">
          {TRACE_SEARCH_HELP}
        </p>
        {results ? (
          <div className="trace-finder-results" role="region" aria-label="Search results">
            <p className="trace-finder-status" role="status">
              {results.total === 0
                ? 'No matching steps.'
                : results.total > results.hits.length
                  ? `Showing ${results.hits.length} of ${results.total} matching steps.`
                  : `${results.total} matching step${results.total === 1 ? '' : 's'}.`}
            </p>
            <ul>
              {results.hits.map((hit) => (
                <li key={hit.step}>
                  <button
                    aria-current={hit.step === step ? 'step' : undefined}
                    className="trace-finder-hit"
                    onClick={() => onJump(hit.step)}
                    type="button"
                  >
                    <span className="trace-finder-step">Step {hit.step}</span>
                    <span className="trace-finder-line">L{hit.line}</span>
                    <span className="trace-finder-detail">{hit.detail}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="trace-finder-bookmarks">
          <button
            aria-pressed={bookmarked}
            className="trace-finder-bookmark-toggle"
            disabled={steps.length === 0}
            onClick={() => onToggleBookmark(step)}
            title="Bookmark the current step (B)"
            type="button"
          >
            {bookmarked ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
            {bookmarked ? `Remove bookmark on step ${step}` : `Bookmark step ${step}`}
          </button>
          {bookmarks.length ? (
            <ul aria-label="Bookmarked steps">
              {bookmarks.map((bookmark) => (
                <li className="trace-finder-bookmark" key={bookmark.step}>
                  <button
                    aria-current={bookmark.step === step ? 'step' : undefined}
                    className="trace-finder-hit"
                    onClick={() => onJump(bookmark.step)}
                    type="button"
                  >
                    <span className="trace-finder-step">Step {bookmark.step}</span>
                    <span className="trace-finder-line">L{steps[bookmark.step]?.line}</span>
                  </button>
                  <input
                    aria-label={`Note for step ${bookmark.step}`}
                    maxLength={500}
                    onChange={(event) => onBookmarkNote(bookmark.step, event.target.value)}
                    placeholder="Add a note"
                    value={bookmark.note}
                  />
                  <button
                    aria-label={`Remove bookmark on step ${bookmark.step}`}
                    className="icon-button"
                    onClick={() => onToggleBookmark(bookmark.step)}
                    type="button"
                  >
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="trace-finder-help">
              Bookmarks mark confusing steps; notes are saved with workspace revisions.
            </p>
          )}
        </div>
      </div>
    </details>
  );
}
