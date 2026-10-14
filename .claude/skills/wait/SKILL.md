---
name: wait
description: Start the next session for the next task and have it wait for my go. Run as /wait, optionally followed by the task.
disable-model-invocation: true
---

Start the next session and have it wait for me to say "go". The next task is: $ARGUMENTS

If no task was given, work it out from the project's plan doc, `MASTER_OPEN_ITEMS.md` or what this session left undone, and state it in one sentence.

1. **Check for a duplicate first.** Run `list_sessions` with `mine: true`, and look at open pull requests and recent branches for this repo. If a session or branch already covers the same task (match the task ID and files, not just the wording), do not start another. Give me the link to the one that exists and stop.
2. **Check the limit.** If the repo already has 3 working sessions, do not start one. Add the task to the plan doc as "next", tell me, and stop.
3. **Pick the model** and tell me in one line. Opus for design, scoring or analysis methods, legal or product thinking, and tricky bugs. Sonnet for building from an agreed plan, data batches, docs, tests and housekeeping. Haiku only for simple lookups and mechanical edits. Always pass `model` to `create_session`; never let the new session inherit this one.
4. **Start it once.** Call `create_session` a single time: same repo, its own branch, title in the form "<repo>: <task ID if any> - <area>". Make the prompt short and self-contained: what is done, what the next task is, which files to read, and this sentence at the end: "Do nothing yet. Read the files, then wait for the founder to say go." If the result is unclear, check `list_sessions` before calling it again. Never retry blind.
5. **Give me the link** (`https://claude.ai/code/<session id>`), the title and the model. Do not start the task, merge anything, or open a pull request.
