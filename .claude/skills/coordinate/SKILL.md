---
name: coordinate
description: Hand this session's remaining work to the Coordinator session, then archive this session only if nothing can be lost. Run as /coordinate, optionally followed by a note.
disable-model-invocation: true
---

Pass whatever this session has not finished to the Coordinator session, and archive this session only if no data can be lost. Extra note from me: $ARGUMENTS

1. **List what is left.** Work out in a few lines what is done, what remains, and what the Coordinator needs to carry on (repo, branch, PR link, files to read, the model the next step needs). If nothing remains, say so and skip to step 4.
2. **Hand off once.** Send one message with `send_message` to the Coordinator, session `session_0164nXb7BTrr9UUNzQEmzPKT`. Make it short and self-contained and end it with "Do not start any work until the founder says go." Send it once; if the result is unclear, check with `list_events` before sending again. Do not start the work, merge anything, publish anything, or open a pull request.
3. **Check for data loss.** Archive only if all of these are true:
   - `git status` shows no uncommitted or untracked changes, and nothing is committed but unpushed.
   - Every branch of this session is pushed, and its work is in an open or merged pull request (or the session made no changes).
   - `list_triggers` shows no pending scheduled task or check-in for this session, and no PR watch I still need.
   - The handoff message was delivered and names every open item.
   - No other session is waiting on this one.
4. **Decide.**
   - All true: call `archive_session` on this session. It can be undone with `unarchive_session`. Then say "✅ Handed to the Coordinator and archived."
   - Anything false: do not archive. Say which check failed and what I need to do (for example, "push branch X" or "merge PR Y"), then stop.
5. **Report** in three lines or fewer: what was handed over, whether this session was archived, and why or why not. Never delete branches or pull requests.
