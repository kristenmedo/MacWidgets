# Plan and decision notes

What CLAUDE.md calls "the project's own plan and decision notes." Short, updated
as things change — not a changelog (git log is that).

## dashboard/ (Timecard dashboard, Xeneon Edge)

Done:
- Local Python/stdlib server (`timecard_server.py`) + `index.html`, reading and
  writing `~/.timetrack` so it stays in step with the `tt` CLI and Stream Deck.
- Sessions view (add/edit/delete/clear, CSV export, change log), running-timer
  start/stop/edit, task add/edit, weekly goals and pace line.
- `install.sh` runs it as a login item; `~/Library/Logs/timecard.log` for
  troubleshooting.
- `test_timecard_server.py`: 38 unittest cases over the data-mutating paths
  (add/edit/delete/clear sessions, start/stop/edit the running timer, add
  tasks, CSV export), run against a throwaway temp dir. All passing.

Open questions:
- No tests yet for `index.html`'s client-side JS, only the server.

What's next:
- Nothing queued. Pick up the next item from a repo review when one exists,
  or whatever Kristen asks for.

## records/ (Timecard records page, claude.ai artifact)

Done:
- `template.html` + `app.js`, built by `build.py` into `timecard.html`, the
  file actually published as the claude.ai artifact.
- Sessions (resume/edit/move/delete with undo), Tasks, Weeks, History, CSV
  and full JSON export/backup, with a weekly-backup reminder.
- Browser tests in `records/tests/` (`mockdb.js` stand-in storage + a
  controllable clock, run via `run.js`).

Open questions:
- None recorded.

What's next:
- Nothing queued.

## Native widget spike — superseded, but the decision was never written down

`Spike/` (added in 986f388, "Add storage spike: three probe widgets for the
data-location question") was a throwaway Xcode project testing three ways a
native macOS widget could read/write `~/.timetrack`: a sandboxed app with a
file-access exception, a sandboxed app using an App Group container, and an
unsandboxed app. `SPIKE.md` describes the three probes and how to run them,
but never recorded which one(s) worked, or any signing errors / permission
prompts the run produced.

The folder was deleted in daf017d ("Add Stop at, History, Weeks, backups,
task editing and Undo"), whose commit message says only "Removed the
superseded native-widget spike and Mac dashboard" — no reasoning beyond that.
That commit also deleted `dashboard/`, which the very next merge (5a85548)
restored because another session had just added tests for it; the merge kept
Spike's deletion.

So, as of this file: `Spike/` is gone from the repo, and nothing records
**why** a native widget was dropped in favor of the `records/` claude.ai page,
or what the three probes actually showed before that decision was made. This
is the open decision for Kristen (or a future session) to resolve:
- Confirm the native-widget idea is shelved for good (the `records/` page
  covers the need) rather than just deferred.
- If it's only deferred, note here what, if anything, the spike run showed
  about the App Group / sandbox-exception / no-sandbox routes, so a future
  attempt doesn't start from zero.
- Either way, nothing further to clean up in the repo — the folder itself is
  already gone.
