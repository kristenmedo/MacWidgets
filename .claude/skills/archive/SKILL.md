---
name: archive
description: Check whether the current work is safe to archive, and archive this session automatically if every check is clear. Run as /archive.
disable-model-invocation: true
---

Check whether this session is safe to archive. If every check is clear, archive it right away. Do not ask me first; typing /archive is my go.

Check for:
- Uncommitted or unpushed changes (`git status`, unpushed commits).
- Pull requests: any from this session still open, not merged, failing or still-running checks, unresolved review comments, or a pending question for me.
- Unfinished work: TODOs, half-done steps, or follow-up work with no home (a new session, a note in the project's plan, or a handoff to the Coordinator).
- Anything still set to fire later: scheduled check-ins (`list_triggers`), queued phases, or waiting on CI or a deploy.

Then:
- **All clear:** call `archive_session` on this session (it can be undone with `unarchive_session`). Reply "✅ Archived." and at most 2 short bullets on what was checked.
- **Anything not clear:** do not archive. Reply "**Not archived.**" and list at most 3 short bullets saying what must be resolved first. If the only blocker is a check that is still running, say so; I will run /archive again when it finishes.

Never delete branches or pull requests, merge anything, or start new work.
