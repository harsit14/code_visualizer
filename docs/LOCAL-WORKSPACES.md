# Local workspaces and backups

Open **Library**, enter a workspace name, then choose **Save revision**. This
creates a stable workspace ID in this browser's IndexedDB. Later saves append
immutable revisions to that ID. Changing the name and saving renames its latest
entry while preserving earlier revisions. **Save as copy** creates another ID.

A revision contains code, language, selected function, input drafts, random seed,
practice cases and their current verdicts, notebook notes/patterns/review status,
watched variable names, breakpoint lines, the current trace and playback position.
Replay opens paused without executing the saved program. Once a workspace is
saved or restored, source edits keep its cases and notebook even while the source
has a syntax error; editing resets case verdicts. Existing source-keyed practice
storage is read normally until the first workspace save, so a current exercise
can be captured without deleting its legacy records.

Saves are **explicit**. The Library indicator shows unsaved changes or a check
mark for the saved revision. Close/reload warns when a named workspace has unsaved
changes, subject to browser support. The single code draft continues to save
while typing; that draft does not contain the rest of a workspace. After a reload,
use **Library → Saved workspaces → Open revision** to resume a saved exercise.
Loading examples or changing language/function can reset exercise state, so save
a revision before replacing it. Loading an example, draft, history item or trace,
or changing language, asks before replacing an open workspace. After confirmation
the Library detaches from it: the next save creates a new workspace, and practice
cases/notes return to the normal per-source storage without overwriting it.

Select a saved workspace and its revision number to open an earlier state.
Saving that state appends a new revision after the latest head; it does not erase
newer revisions. If another tab has saved since this tab opened the workspace,
the save is rejected visibly. Save as a copy to retain your edits, or refresh and
open the newer revision. Head metadata and revision content commit in the same
transaction. A failed/aborted write leaves the last committed revision intact.

**Export workspace** requests a `.cvworkspace.json` download containing the
current exercise, including unsaved changes and the current replay. Check your
browser's downloads and keep the file somewhere safe. Each file contains one
complete exercise snapshot; it does not contain every revision in the library,
layout/theme preferences, account credentials, AI conversation or complexity
experiments. Open a different revision and export it to keep that snapshot too.
Export remains available if IndexedDB is unavailable, within the file limits.

**Restore backup** validates a version 1 file before changing the editor, then
saves it under a new local ID. A backup cannot overwrite an existing workspace by
reusing its ID. Invalid, future-version or oversized files leave the current
exercise intact. Edits made while a file is being read also prevent replacement.
Files are limited to 25 MB, source and individual text fields to 200,000
characters, and cases to 500; nested trace limits also apply. A full or disabled
browser store causes a visible error; retry saving or export the current exercise.

Workspace files and browser storage contain source, inputs, notes and recorded
values in plain text. Library operations do not upload them to an account.
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
