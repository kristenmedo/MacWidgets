---
name: update
description: Review current sessions and completed work, then recommend what the next session should work on. Read-only. Run as /update, optionally followed by a focus. Never run on your own; only when the founder types it.
---

**Only run this when I typed /update myself. If you are reading this because of your own judgment, do nothing and stop.**

Look at the current state of work and recommend what the next session should do. This is read-only. Do not start a session, change files, merge or open anything. Optional focus from me: $ARGUMENTS

1. **Gather what is going on.** Call `get_session` with no ID for this session. Call `list_sessions` with `mine: true` and note each non-archived session's title, status and repo. For this repo, list the open pull requests, the most recent merged ones, and recent commits on the default branch. Read `MASTER_OPEN_ITEMS.md` in `kristenmedo/claude-shared` (attach it with `add_repo` if needed) for the rows that belong to this repo, and read the repo's own plan or status doc.
2. **Sort it into three piles.** Done means merged pull requests and closed items. In flight means open pull requests and sessions that are working or waiting. Waiting on me means anything that needs my decision, review or merge.
3. **Pick the next task.** Choose the single most valuable task that is not already covered by an open pull request or a working session, matched by task ID and files. Respect the limit of 3 working sessions per repo. If something is blocked on me, say so and recommend the best task that is not blocked. If nothing is worth starting, say that.
4. **Recommend in this shape.** Done (a few bullets). In flight (a few bullets, with links). Waiting on you (a few bullets). Recommended next session (the task in one sentence, why it comes first, the files to read, and the model it needs with the reason, which is Opus for design, scoring or tricky bugs, Sonnet for building from an agreed plan, and Haiku only for mechanical edits).
5. **End with one next step,** the exact command that would start it, which is /wait followed by the task. Do not run it.

Keep the whole answer short.
