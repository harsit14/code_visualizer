import { useDeferredValue, useId, useMemo, useRef, useState } from 'react';
import type { Language } from '../engine/types';
import { formatTime, type useWorkspaceLibrary } from '../app/useWorkspaceLibrary';
import {
  buildWorkspaceIndex,
  lastActivity,
  libraryTags,
  searchWorkspaces,
  type WorkspaceSort,
} from '../app/workspaceSearch';
import type { WorkspaceSummary } from '../app/workspaceStore';
import {
  addTag,
  localDate,
  MAX_TAG_LENGTH,
  reviewDue,
  SUGGESTED_TAGS,
  suggestTags,
  type WorkspaceMeta,
} from '../app/workspaceTags';

type Library = ReturnType<typeof useWorkspaceLibrary>;
const LANGUAGES: Record<Language, string> = {
  python: 'Python',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
};
/** Rendering stays quick on phones; search narrows larger libraries. */
const MAX_RESULTS = 100;
const formatDay = (time: number) =>
  new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(time);

function TagEditor({
  item,
  blocked,
  patterns,
  optionsId,
  onUpdate,
}: {
  item: WorkspaceSummary;
  blocked: boolean;
  patterns: string;
  optionsId: string;
  onUpdate: (patch: Partial<WorkspaceMeta>) => void;
}) {
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const add = (raw: string) => {
    const next = addTag(item.tags, raw);
    setProblem(next.error);
    if (next.error) return;
    setDraft('');
    if (next.tags !== item.tags) onUpdate({ tags: next.tags });
  };
  return (
    <div className="workspace-tags">
      <span className="workspace-subheading">Tags</span>
      {item.tags.length ? (
        <ul className="workspace-tag-list" aria-label={`Tags for ${item.name}`}>
          {item.tags.map((tag) => (
            <li key={tag} className="workspace-tag">
              {tag}
              <button
                type="button"
                aria-label={`Remove tag ${tag}`}
                disabled={blocked}
                onClick={() => onUpdate({ tags: item.tags.filter((other) => other !== tag) })}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="account-note">No tags yet. Tags do not create a revision.</p>
      )}
      <form
        className="workspace-tag-form"
        onSubmit={(event) => {
          event.preventDefault();
          add(draft);
        }}
      >
        <input
          type="text"
          aria-label="New tag"
          placeholder="Add a pattern tag"
          list={optionsId}
          maxLength={MAX_TAG_LENGTH + 8}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setProblem(null);
          }}
        />
        <button type="submit" disabled={blocked || !draft.trim()}>
          Add tag
        </button>
      </form>
      {problem && (
        <p className="account-note workspace-problem" role="alert">
          {problem}
        </p>
      )}
      <div className="workspace-tag-suggestions" role="group" aria-label="Suggested pattern tags">
        {suggestTags(item.tags, patterns)
          .slice(0, 6)
          .map((tag) => (
            <button
              key={tag}
              type="button"
              aria-label={`Add tag ${tag}`}
              disabled={blocked}
              onClick={() => add(tag)}
            >
              + {tag}
            </button>
          ))}
      </div>
    </div>
  );
}

export function WorkspaceLibrary({
  library,
  disabled = false,
}: {
  library: Library;
  disabled?: boolean;
}) {
  const file = useRef<HTMLInputElement>(null);
  const archive = useRef<HTMLInputElement>(null);
  const ids = useId();
  const [selectedId, setSelectedId] = useState('');
  const [followed, setFollowed] = useState(library.active?.id);
  const [revision, setRevision] = useState('');
  const [query, setQuery] = useState('');
  const [language, setLanguage] = useState<Language | ''>('');
  const [tag, setTag] = useState('');
  const [reviewOnly, setReviewOnly] = useState(false);
  const [sort, setSort] = useState<WorkspaceSort>('recent');
  const [history, setHistory] = useState(false);
  // Opening or saving another workspace selects it.
  if (followed !== library.active?.id) {
    setFollowed(library.active?.id);
    setSelectedId('');
    setRevision('');
  }
  const deferredQuery = useDeferredValue(query);
  const index = useMemo(() => buildWorkspaceIndex(library.items), [library.items]);
  const tags = useMemo(() => libraryTags(library.items), [library.items]);
  const tagFilter = tags.includes(tag) ? tag : '';
  const today = localDate();
  const results = useMemo(
    () =>
      searchWorkspaces(index, {
        query: deferredQuery,
        language,
        tag: tagFilter,
        reviewOnly,
        sort,
        today,
      }),
    [index, deferredQuery, language, tagFilter, reviewOnly, sort, today],
  );
  const selected = library.items.find((item) => item.id === (selectedId || library.active?.id));
  const blocked = disabled || library.busy;
  const requested = Number(revision || selected?.revision);
  const filtered = Boolean(query.trim() || language || tagFilter || reviewOnly);
  const clearFilters = () => {
    setQuery('');
    setLanguage('');
    setTag('');
    setReviewOnly(false);
  };
  const offer = library.offer;
  const autosave = library.autosave;
  return (
    <details
      className="panel-menu workspace-library"
      onToggle={(event) => {
        // Other tabs may have saved, tagged or autosaved since the list loaded.
        if (event.currentTarget.open) void library.refresh();
      }}
    >
      <summary
        aria-label="Open local workspace library"
        title="Named local workspaces and complete backups"
      >
        Library{library.active ? (library.dirty ? ' •' : ' ✓') : ''}
      </summary>
      <div className="panel-menu-popover workspace-popover">
        <strong className="workspace-menu-heading">Local workspace library</strong>
        <p className="account-note">
          Save revisions explicitly; a saved workspace also autosaves while you edit. Code, inputs,
          cases, notes, watches, breakpoints and the current replay stay on this device. Export a
          backup before clearing browser data.
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
        {autosave && (
          <p
            className="account-note workspace-autosave-status"
            role={autosave.alert ? 'alert' : 'status'}
          >
            <span>{autosave.text}</span>
            {autosave.retry && (
              <button type="button" onClick={() => void library.retryAutosave()}>
                Retry autosave
              </button>
            )}
          </p>
        )}
        {offer && (
          <div className="workspace-autosave-offer" role="group" aria-label="Unsaved autosave">
            <p className="account-note">
              An autosave from {formatTime(offer.info.savedAt)} has edits that were not saved as a
              revision
              {offer.info.baseRevision < offer.headRevision
                ? `. It started from revision ${offer.info.baseRevision}; revision ${offer.headRevision} is newer.`
                : '.'}
            </p>
            <div className="workspace-action-grid">
              <button
                type="button"
                disabled={blocked}
                onClick={() => void library.restoreAutosave()}
              >
                Restore autosave
              </button>
              <button
                type="button"
                disabled={blocked}
                onClick={() => void library.discardAutosave()}
              >
                Discard autosave
              </button>
            </div>
          </div>
        )}
        <section className="workspace-menu-section" aria-labelledby={`${ids}-saved`}>
          <strong className="workspace-menu-heading" id={`${ids}-saved`}>
            Saved workspaces
          </strong>
          {library.items.length === 0 ? (
            <p className="account-note workspace-empty">
              No saved workspaces yet. Name this exercise and choose Save revision; it will appear
              here with its tags and revisions.
            </p>
          ) : (
            <>
              <input
                type="search"
                className="workspace-search"
                aria-label="Search workspaces"
                placeholder="Search names, tags and code"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="workspace-filter-grid">
                <label className="workspace-field">
                  Language
                  <select value={language} onChange={(e) => setLanguage(e.target.value as '')}>
                    <option value="">All languages</option>
                    {Object.entries(LANGUAGES).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="workspace-field">
                  Tag
                  <select value={tagFilter} onChange={(e) => setTag(e.target.value)}>
                    <option value="">All tags</option>
                    {tags.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="workspace-field">
                  Sort
                  <select value={sort} onChange={(e) => setSort(e.target.value as WorkspaceSort)}>
                    <option value="recent">Recently saved</option>
                    <option value="name">Name</option>
                  </select>
                </label>
                <label className="panel-menu-item workspace-check">
                  <input
                    type="checkbox"
                    checked={reviewOnly}
                    onChange={(e) => setReviewOnly(e.target.checked)}
                  />
                  Due for review
                </label>
              </div>
              <p className="account-note" role="status">
                {results.length === library.items.length
                  ? `${library.items.length} saved`
                  : `${results.length} of ${library.items.length} match`}
              </p>
              {results.length === 0 ? (
                <div className="workspace-empty">
                  <p className="account-note">No workspaces match this search and filter.</p>
                  <button type="button" onClick={clearFilters}>
                    Clear search and filters
                  </button>
                </div>
              ) : (
                <fieldset className="workspace-results">
                  <legend className="sr-only">Choose a saved workspace</legend>
                  {results.slice(0, MAX_RESULTS).map((item) => (
                    <label key={item.id} className="workspace-result">
                      <input
                        type="radio"
                        name={`${ids}-workspace`}
                        value={item.id}
                        checked={selected?.id === item.id}
                        onChange={() => {
                          setSelectedId(item.id);
                          setRevision('');
                        }}
                      />
                      <span className="workspace-result-text">
                        <span className="workspace-result-name">
                          {item.name}
                          {item.id === library.active?.id ? ' (open)' : ''}
                        </span>
                        <span className="workspace-result-meta">
                          {[
                            item.language && LANGUAGES[item.language],
                            `r${item.revision}`,
                            formatDay(lastActivity(item)),
                            item.autosave && 'autosaved',
                            reviewDue(item, today) && 'needs review',
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                        {item.tags.length > 0 && (
                          <span className="workspace-result-tags">
                            {item.tags.map((value) => (
                              <span key={value} className="workspace-tag">
                                {value}
                              </span>
                            ))}
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
              {results.length > MAX_RESULTS && (
                <p className="account-note">
                  Showing the first {MAX_RESULTS}. Refine the search to see the rest.
                </p>
              )}
              {filtered && results.length > 0 && (
                <button type="button" onClick={clearFilters}>
                  Clear search and filters
                </button>
              )}
            </>
          )}
        </section>
        {selected && (
          <section className="workspace-menu-section" aria-labelledby={`${ids}-selected`}>
            <strong className="workspace-menu-heading" id={`${ids}-selected`}>
              {selected.name}
            </strong>
            <label className="workspace-field">
              Revision
              <input
                aria-label="Workspace revision"
                type="number"
                min={1}
                max={selected.revision}
                value={revision || selected.revision}
                onChange={(e) => setRevision(e.target.value)}
              />
            </label>
            <div className="workspace-action-grid">
              <button
                type="button"
                disabled={
                  blocked ||
                  !Number.isInteger(requested) ||
                  requested < 1 ||
                  requested > selected.revision
                }
                onClick={() => void library.open(selected.id, requested)}
              >
                Open revision
              </button>
            </div>
            <TagEditor
              key={selected.id}
              item={selected}
              blocked={blocked}
              patterns={selected.id === library.active?.id ? library.notebookPatterns : ''}
              optionsId={`${ids}-tag-options`}
              onUpdate={(patch) => void library.updateMeta(selected.id, patch)}
            />
            <div className="workspace-review">
              <span className="workspace-subheading">Review</span>
              <label className="panel-menu-item workspace-check">
                <input
                  type="checkbox"
                  checked={selected.needsReview}
                  disabled={blocked}
                  onChange={(e) =>
                    void library.updateMeta(selected.id, { needsReview: e.target.checked })
                  }
                />
                Needs review
              </label>
              <label className="workspace-field">
                Review by
                <input
                  type="date"
                  value={selected.reviewBy ?? ''}
                  disabled={blocked}
                  onChange={(e) =>
                    void library.updateMeta(selected.id, { reviewBy: e.target.value || null })
                  }
                />
              </label>
            </div>
          </section>
        )}
        <section className="workspace-menu-section" aria-labelledby={`${ids}-archive`}>
          <strong className="workspace-menu-heading" id={`${ids}-archive`}>
            Whole library
          </strong>
          <p className="account-note">
            One file with every workspace&apos;s latest revision, unsaved autosave, tags and review
            state. Import adds copies with new IDs and never runs code.
          </p>
          <label className="panel-menu-item workspace-check">
            <input
              type="checkbox"
              checked={history}
              onChange={(e) => setHistory(e.target.checked)}
            />
            Include every revision (up to 100 MB)
          </label>
          <div className="workspace-action-grid">
            <button
              type="button"
              disabled={blocked || library.items.length === 0}
              onClick={() => void library.exportArchive(history)}
            >
              Export library
            </button>
            <button type="button" disabled={blocked} onClick={() => archive.current?.click()}>
              Import library
            </button>
            <button type="button" disabled={blocked} onClick={() => void library.refresh()}>
              Refresh library
            </button>
          </div>
        </section>
        {library.notice && (
          <p className="account-note" role="status">
            {library.notice}
          </p>
        )}
        {library.error && <p role="alert">{library.error}</p>}
        <datalist id={`${ids}-tag-options`}>
          {[...new Set([...SUGGESTED_TAGS, ...tags])].map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
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
        <input
          ref={archive}
          aria-label="Import library archive file"
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const upload = e.target.files?.[0];
            if (upload) void library.importArchive(upload);
            e.target.value = '';
          }}
        />
      </div>
    </details>
  );
}
