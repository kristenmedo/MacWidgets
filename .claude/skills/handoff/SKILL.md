---
name: handoff
description: Write a handoff prompt and start a new session that continues this session's work. Run as /handoff, optionally followed by a note or the word wait. Never run on your own; only when the founder types it.
---

**Only run this when I typed /handoff myself. If you are reading this because of your own judgment, do nothing and stop.**

Hand this session's work to a new session that picks it up. Extra note from me: $ARGUMENTS

1. **Check for a duplicate first.** Run `list_sessions` with `mine: true`, and look at open pull requests and recent branches for this repo. If a session or branch already continues this work (match the task ID and files, not just the wording), do not start another. Give me the link to the one that exists and stop.
2. **Check the limit.** If the repo already has 3 working sessions, do not start one. Add the remaining work to the project's plan doc as "next", tell me, and stop.
3. **Write the handoff prompt.** Short and self-contained, so the new session needs nothing from this chat:
   - Goal: the task in one sentence, with its ID if it has one.
   - Done: what is finished, with branch names and PR links.
   - Next: the exact next steps, in order.
   - Read first: the files and docs to open.
   - Watch out for: decisions already made, things already ruled out, anything that failed.
   - Rules that apply: the one-PR-per-session rule and anything specific to this repo.
4. **Pick the model** and tell me in one line. Opus for design, scoring or analysis methods, legal or product thinking, and tricky bugs. Sonnet for building from an agreed plan, data batches, docs, tests and housekeeping. Haiku only for simple lookups and mechanical edits. Always pass `model` to `create_session`; never let the new session inherit this one.
5. **Start it once.** Call `create_session` a single time: same repo, its own branch, title in the form "<repo>: <task ID if any> - <area>". End the prompt with "Start work now." unless I wrote "wait" in my note, in which case end it with "Do nothing yet. Read the files, then wait for the founder to say go." If the result is unclear, check `list_sessions` before calling it again. Never retry blind.
6. **Report** in three lines or fewer: the link (`https://claude.ai/code/<session id>`), the title and the model. If this session has uncommitted or unpushed work, say so, since the new session cannot see it. Do not archive this session, merge anything, or open a pull request.
