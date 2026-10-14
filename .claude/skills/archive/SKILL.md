---
name: archive
description: Evaluate whether the current work is safe to archive and give a concise yes/no recommendation. Does not archive anything.
disable-model-invocation: true
---

Evaluate whether the current work is safe to archive. Recommend only. Do not archive anything.

Check for:
- Uncommitted or unpushed changes (`git status`, unpushed commits).
- An open PR: not merged, failing checks, unresolved review comments, or a pending question for me.
- Unfinished work: TODOs, half-done steps, or follow-up work with no home (a new session, or a note in the project's plan).
- Anything still set to fire later: scheduled check-ins, triggers, queued phases, or waiting on CI or a deploy.

Answer in this form:
- **Yes** or **No** on the first line.
- Then at most 3 short bullets with the reasons. If No, list what must be resolved first.
