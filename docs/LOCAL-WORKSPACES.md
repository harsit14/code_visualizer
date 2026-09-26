# Local workspaces and backups

Open **Library**, enter a workspace name, then choose **Save revision**. This
creates a stable workspace ID in this browser's IndexedDB. Later saves append
immutable revisions to that ID. Changing the name and saving renames its latest
entry while preserving earlier revisions. **Save as copy** creates another ID.

A revision contains code, language, selected function, input drafts, random seed,
practice cases and their current verdicts, notebook notes/patterns/review status,
watched variable names, breakpoint lines, trace bookmarks with their notes, the
current trace and playback position. Backups written before bookmarks existed
restore with no bookmarks.
Replay opens paused without executing the saved program. Once a workspace is
saved or restored, source edits keep its cases and notebook even while the source
has a syntax error; editing resets case verdicts. Existing source-keyed practice
storage is read normally until the first workspace save, so a current exercise
can be captured without deleting its legacy records.

Revisions are **explicit**; a saved workspace also [autosaves](#autosave) into a
separate slot that never becomes a revision on its own. The Library indicator
shows unsaved changes or a check mark for the saved revision. Close/reload warns
when a named workspace has unsaved changes, subject to browser support. The single
code draft continues to save while typing; that draft does not contain the rest of
a workspace. After a reload, use **Library → Saved workspaces → Open revision** to
resume a saved exercise.
Loading examples or changing language/function can reset exercise state, so save
a revision before replacing it. Loading an example, draft, history item or trace,
or changing language, asks before replacing an open workspace. After confirmation
the Library detaches from it: pending edits are written to its autosave slot one
last time, the next save creates a new workspace, and practice cases/notes return
to the normal per-source storage without overwriting it.

Select a saved workspace and its revision number to open an earlier state.
Saving that state appends a new revision after the latest head; it does not erase
newer revisions. If another tab has saved since this tab opened the workspace,
the save is rejected visibly. Save as a copy to retain your edits, or refresh and
open the newer revision. Head metadata and revision content commit in the same
transaction. A failed/aborted write leaves the last committed revision intact.

**Export workspace** requests a `.cvworkspace.json` download containing the
current exercise, including unsaved changes and the current replay, plus its tags
and review state. Check your browser's downloads and keep the file somewhere safe.
Each file contains one complete exercise snapshot; it does not contain every
revision in the library, layout/theme preferences, account credentials, AI
conversation or complexity experiments. Open a different revision and export it
to keep that snapshot too, or use [Export library](#whole-library-archives).
Export remains available if IndexedDB is unavailable, within the file limits.

**Restore backup** validates a version 1 or 2 file before changing the editor,
then saves it under a new local ID. A backup cannot overwrite an existing
workspace by reusing its ID. Invalid, future-version or oversized files leave the
current exercise intact. Edits made while a file is being read also prevent
replacement. Files are limited to 25 MB, source and individual text fields to
200,000 characters, and cases to 500; nested trace limits also apply. A full or
disabled browser store causes a visible error; retry saving or export the current
exercise.

Workspace files are version 2. Version 2 adds an optional top-level `meta` object
(`tags`, `needsReview`, `reviewBy`) beside the unchanged `workspace` object.
Version 1 files still restore, with no tags; `meta` in a version 1 file is
ignored. Stored revisions omit `meta` because tags belong to the workspace, not
to a revision.

## Tags, review and search

Select a workspace in **Saved workspaces** to see its tags and review state.
Tags are trimmed, lowercased and whitespace-collapsed, so `Sliding  Window` and
`sliding window` are the same tag. Common spellings are merged: `two-pointer`
becomes `two pointers`, `dynamic programming` becomes `dp`, and
`breadth-first search` becomes `bfs`. A tag holds letters, numbers, spaces and
`_ + # . / ' -`, starts with a letter or number, and has at most 32 characters.
A workspace has at most 12 tags. Suggested pattern tags are two pointers, sliding
window, binary search, BFS, DFS, DP, heap, recursion, hash map, stack, graph and
greedy. Patterns named in the open exercise's notebook are suggested first.
Custom tags are allowed.

**Needs review** flags a workspace to revisit. **Review by** sets a date; on
and after that local date the workspace also counts as due for review.

Tags and review state are workspace metadata. Changing them never creates a code
revision, never changes the editor and does not mark the open workspace unsaved.
Each edit is checked against the metadata version this tab last read. When
another tab changed them first, the edit is rejected, the list reloads and the
change can be applied again.

The search box matches every typed word against the name, tags and source code of
the latest revision. Filters narrow by language, tag and **Due for review**. Sort
by **Recently saved** or **Name**. Recently saved counts autosaves, so a
workspace being edited stays near the top. The Library reads one head record per
workspace when it opens; each head carries the latest source for search. It then
builds a lowercase in-memory index, so typing does not read IndexedDB. Up to 100
matches are listed; refine the search to reach the rest.

## Autosave

While a saved workspace is open, edits to its code, inputs, cases, notes,
watches, breakpoints, bookmarks, replay or name are autosaved 1.5 seconds after
the last change. They go to one replaceable **autosave slot** per workspace. The
slot is not a revision: **Save revision** still creates an immutable revision,
and that save clears the slot when the slot holds this tab's autosave. Untitled
drafts are never autosaved; the separate code draft covers them. A saved
workspace with an empty name waits until it has one.

The status bar and Library show the autosave state: **Autosave pending…**,
**Autosaving…**, **Autosaved 14:02**, **Autosave failed — retry** (with a retry
button; the next edit also retries) or **Autosave stopped** after a conflict.
Pending edits are written when the page is hidden or closed, as drafts are.
They are also written when the workspace is replaced by an example, draft,
history item, trace or language change. Page-hide writes are best effort,
because a browser may end a closing page before IndexedDB commits. Hiding the
tab, for example by switching apps on a phone, is more reliable.

When an opened workspace has an autosave, the Library offers **Restore
autosave** or **Discard autosave**. Autosave pauses until you choose. Restoring
replaces the editor with the autosaved state without running code. It keeps the
workspace unsaved until you choose Save revision. Restoring asks first if you
edited since opening. Discarding asks for confirmation and deletes only that
autosave. If the autosave started from an older revision than the latest one,
the offer says so.

Concurrency uses the same optimistic checks as revisions. Every autosave records
the head revision it started from and gets a new token. A write succeeds only if
the head is still that revision and the slot still holds the token this tab last
wrote or restored. A stale tab cannot replace a newer revision or another tab's
newer autosave. Its autosave stops with a visible message; reopen the workspace
to review the other change, or save a copy. An explicit save from a tab that did
not write the current autosave keeps that autosave, so it can be restored or
discarded later. Restore and discard fail visibly if another tab changed the
slot meanwhile.

## Whole-library archives

**Export library** requests one `code-visualizer-library-YYYY-MM-DD.cvlibrary.json`
file. It contains every workspace's latest revision, its autosave when one holds
unsaved edits, and its tags and review state. **Include every revision** adds all
earlier revisions while the archive stays within 100 MB; beyond that, the export
falls back to latest revisions only and says so. Pending autosave edits of the
open workspace are written first, so the archive includes them. Damaged stored
records are left out and counted. The format is:

```json
{
  "format": "code-visualizer-library",
  "version": 1,
  "exportedAt": 1790000000000,
  "history": false,
  "workspaces": [
    {
      "meta": { "tags": ["bfs"], "needsReview": false, "reviewBy": null },
      "revisions": [{ "id": "…", "name": "…", "revision": 3, "savedAt": 0, "content": {} }],
      "autosave": null
    }
  ]
}
```

Each `revisions` and `autosave` item is the same `workspace` object used by
single backups and is validated the same way.

**Import library** reads and validates the whole file before writing anything.
Archives are limited to 100 MB, 1,000 workspaces and 10,000 revisions. Files that
are not version 1 library archives, including single workspace backups, are
rejected. A workspace that fails validation is skipped by name with the reason;
the others still import. A workspace whose latest name, save time and source
already match a library workspace is skipped as a duplicate, so importing the
same archive twice is harmless. Every imported workspace gets a new ID. Its
revisions are renumbered from 1 in their original order, so a latest-only archive
imports as revision 1. All workspaces are written in one IndexedDB transaction:
if any write fails, none are kept. Import never runs saved code, and it does not
change the editor or the open workspace. The Library reports how many workspaces
and revisions were imported and how many were skipped.

## Account sync

Account sync is **off by default**. Signed in on a deployment with accounts,
open **Library → Account sync** and choose **Sync this library with my
account**. A confirmation says which account, how many workspaces will be
uploaded and that uploads include code, inputs, cases, notes and replay. Until
then nothing in the library leaves the browser. Turning sync off stops it; copies
already in the account stay there.

What syncs: every saved revision (immutable and numbered as on this device),
the workspace name, and tags and review state. What never syncs: autosave slots,
the code draft, and workspaces marked **Keep local only**. Keep local only is in
each workspace's details and works whether library sync is on or off. For a
workspace already in the account, **Remove from account** deletes its revisions
there and leaves a tombstone; this device, and every other device that synced it,
keeps its copy as local only. A revision larger than 2 MB syncs without its
replay (cases, notes and code still sync); if it is still larger, that workspace
reports Sync failed and stays on this device.

Each workspace shows its state in the list and in its details: **Local only**,
**Waiting to sync**, **Syncing…**, **Synced**, **Sync failed** (with **Retry
sync**), or **Conflict** (with **Dismiss**). The open workspace's state follows
"Local saved · revision N". The Account sync section shows the last sync time,
**Sync now**, or why sync is paused.

A pass runs when sync is turned on, a second or two after a save or tag edit,
when the tab becomes visible, every two minutes while visible, and on **Sync
now**. It first lists what changed in the account since the last pass, then:

- Pulls workspaces that are new to this device, and newer revisions and tags of
  workspaces with no local changes, into IndexedDB. Every revision is validated
  with the same parser as backup files. Pulled code is never run: it opens
  paused, like any saved revision, and runs only when you choose Run. At most the
  newest 50 revisions of a workspace are fetched in one pass; older ones stay in
  the account.
- Uploads local revisions the account lacks, in order, each against the account's
  current head. The account accepts a revision only when its head is the
  revision before it. A retry after a lost acknowledgement sends the same
  revision number and content, which the account recognises as already stored,
  so nothing is duplicated.
- Uploads tag and review edits with their own version check. When both sides
  changed them, they are merged: every tag from both (up to 12), needs review if
  either set it, and the earlier review date.

**Conflicts never overwrite either side.** When this device and another both
saved new revisions of a workspace, the local head stays as it is. The account's
latest version is saved here as a new, local-only workspace named "… (from
another device)", and the Library says so. The local head is then uploaded after
the account's revisions, so both devices end with the same latest revision and
the other device keeps its own revisions in history. If the local head was not
numbered above the account's, it is repeated as a new revision after them; the
local revisions it passed over stay on this device only. A workspace removed from
the account on another device becomes local only here, with a notice.

**Accounts never mix.** The library records the account it syncs with, and each
workspace records the account it was synced with. Every request states that
account, and the server refuses it if the signed-in account differs, so a
sign-in in another tab cannot redirect uploads. On sign-out or an account change,
the current pass stops. While signed out, nothing syncs. While a different
account is signed in, nothing is uploaded or downloaded, and workspaces saved
then are held as local only, so they do not reach the library's account later.
**Sync with … instead** asks before attaching the library to the signed-in
account. Only workspaces never synced, including those held while it was signed
in, are uploaded; workspaces synced with the previous account stay on this
device and are never uploaded to the new one. Signing back in to the library's account
resumes sync.

Sync is not offered on static hosts, which have no accounts. Offline, the Library
says sync resumes on reconnection, and saving still works locally. If the
server's database lacks migration 0005, the Library says sync is not available
yet. One pass runs at a time, across tabs where the browser supports Web Locks.
The library's setting is in `localStorage` (`cv-workspace-sync`); per-workspace
sync state is in IndexedDB. Server details are in
[deployment](deployment.md#workspace-sync).

## Storage schema

The IndexedDB database `cv-workspaces-v1` is at schema version 3. Version 2 adds
tags, review state, language, latest source and autosave information to each
workspace head. It also adds an `autosaves` store, keyed by workspace ID. Version
3 adds a `sync` store, keyed by workspace ID, with each workspace's account,
Keep local only choice, last synced revision and tag version, and any sync
problem. The upgrades run once when the new version first opens. They keep every
head and revision; version 2 fills search fields from each latest revision, and
a damaged revision upgrades with empty search text. Tabs still running the
previous version cannot open the upgraded database, so reload them.

Workspace files and browser storage contain source, inputs, notes and recorded
values in plain text. Library operations do not upload them to an account unless
[account sync](#account-sync) is turned on.
Opening a workspace disables automatic account-history uploads for that session;
users may opt back in explicitly. Sharing a runnable link or requesting an AI
explanation retains its existing, separate data behavior. Browser storage is
specific to the app origin and browser profile, and can be cleared or evicted.
Use downloaded backups for data you want to keep independently of the browser.

## Validation

Unit/integration coverage checks complete round trips, invalid nested trace and
practice fields, version/size limits, transaction aborts, concurrent tab conflicts,
old-revision recovery, unique identities on restore, detaching a replaced
workspace, storage failure/retry,
exports with unavailable IndexedDB, and edits during asynchronous file reads.
Session tests verify restored replay does not run code and notes/cases survive a
syntax edit, and that leaving a workspace resumes per-source storage without
overwriting it. Local Chromium checks covered saving and reopening a Two Sum
exercise after reload, including an assertion, notes, a watch and replay position;
valid file restore and invalid-version rejection; and the Library at 390 × 844.
The browser stalled at a later confirmation dialog during the older-revision
check; that path is covered by the automated tests. The browser download event
was not observed; export payload/download wiring is covered by a component test.
Real Safari/Firefox, browser eviction and actual disk-full behavior remain untested.

Tag, search, autosave and archive coverage uses fake-indexeddb and Testing
Library. It checks tag normalization and limits, and version 1 and 2 backups. It
checks the schema 1 → 2 upgrade, including a damaged revision, and metadata edits
that neither create revisions nor overwrite another tab's change. Autosave
checks cover debounce, fold-on-save, page-hide and replace flushes, untitled
drafts, restore and discard offers, and failure and retry. They also cover stale
tabs against a newer revision or autosave. Archive checks cover history and
latest-only exports and fresh-ID renumbered imports. They also cover duplicate
and invalid skips, file limits, and an aborted import that leaves no workspace.
Component tests cover search, filters, sorting, the empty state, tag editing and
the autosave offer. These features have not yet been checked in a real browser.

Account sync is tested at three levels. PGlite runs migration 0005 and checks
identical re-pushes, conflicts, tombstones and revival, per-account bounds,
the export bound, `delete_account` removing synced workspaces (with and without
managed accounts), idempotent re-application and browser-role access. Worker
tests cover sign-in, the account header, cross-user isolation, 409 conflicts,
invalid and oversized payloads, rate limits, a missing migration, and the account
export and deletion. Client tests drive the sync pass against the real Worker
handler with fake-indexeddb as two devices: first sync and pull, pulling newer
revisions and tags, conflicts that keep both versions, a retry after a lost
acknowledgement, account switches, Keep local only and autosaves, removal on
another device, tag merges and a missing migration. Hook and component tests
cover the opt-in confirmation, held workspaces, paused states and the per-workspace
controls. Sync has not been checked against a real Supabase project or in a real
browser.
