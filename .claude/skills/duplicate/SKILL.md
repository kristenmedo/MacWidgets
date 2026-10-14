---
name: duplicate
description: Check whether this session duplicates another one, and if so stop and archive one without losing any work. Run as /duplicate, optionally followed by the other session link.
disable-model-invocation: true
---

Check whether this session is a duplicate of another one, and if it is, remove one so no work is lost. If I gave a session link or ID after the command, treat it as the suspected twin: $ARGUMENTS

1. **Identify this session.** Call `get_session` with no ID. Note its repo, branch, title and the task it is on.
2. **Look for a twin.** Call `list_sessions` with `mine: true` and look at sessions that are not archived. Also check open pull requests and recent branches in this repo. Two sessions are duplicates when they are on the same task, matched by task ID, branch, pull request and files, not just similar wording.
3. **If there is no twin,** say Not a duplicate and give the one-line reason. Stop.
4. **If there is a twin, compare the two.** For each, find: commits that are not on the default branch, whether they are pushed, any open pull request, uncommitted changes (run `git status` here; for the other session read its latest messages with `list_events`), and any scheduled check-in or trigger set for it (`list_triggers`). Keep the one with more unique work. If equal, keep the one that has the open pull request, then the older one.
5. **Protect the work.** Do not remove either session if the one to remove has anything the keeper lacks: uncommitted or unpushed changes, commits or a pull request of its own, a pending trigger or phase, or an unanswered question for me. Show me the comparison and ask me what to do.
6. **If the one to remove has nothing unique:**
   - If it is another session, call `interrupt_session` on it, then `archive_session`. Archiving can be undone with `unarchive_session`. There is no permanent delete, so say that.
   - If it is this session, stop all work and tell me to archive this one, with the link to the one to keep. A session cannot safely archive itself.
7. **Report in a few lines:** which two sessions, which one was kept and why, which one was removed, and the links. Never delete branches or pull requests, and never act if you are unsure it is a duplicate. Ask me instead.
