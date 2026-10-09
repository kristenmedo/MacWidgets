# CLAUDE.md

## Working efficiently: sessions and models (Kristen, 2026-10-02)

Long chats are expensive: every reply re-reads the whole history. So, in every session:

- **One piece of work per session.** The repo is the memory (this file and the project's own
  plan and decision notes). When a task is done, or a chat has run long (roughly 30+
  back-and-forths, or after a context summary), start a fresh session yourself with the
  `create_session` tool (claude-code-remote; same repo, its own branch). Give it a short,
  self-contained prompt: what's done, what's next, which files to read. If Kristen has already
  said "go", put that in the prompt so the new session starts work right away; otherwise tell it
  to wait for her. Then give Kristen its link. Don't wait for her to ask, and don't leave two
  sessions waiting on the same task.
- **Tell Kristen which model a task needs,** in one line at the start of the task, and start new
  sessions on that model:
  - **Opus:** design and architecture decisions, scoring or analysis methods, product or legal
    thinking, tricky bugs, anything where a subtle mistake would be costly or hard to spot.
  - **Sonnet (default):** building from an agreed plan, data research and extraction batches
    that have checks behind them, docs, tests, publishing, pull-request housekeeping.
  - **Haiku:** only simple lookups and mechanical edits. Not for reading data tables or
    extracting values (it misreads them).
  - Helper agents (the Agent tool) default to Sonnet unless the task is Opus-level.
- **Bundle work.** Several changes, one test run, one pull request, one publish.
- **One pull request per session (Kristen, 2026-10-09).** Every push to a pull request runs the tests on GitHub,
  and those minutes are limited. Open at most one pull request per repo per session, carrying everything the task
  changed, including its notes; small follow-ups join the open one or wait for the next session's. Push when the task
  is done and local checks pass, not after every commit. Fixes for a failing check or a review comment go on the open
  pull request. (Full rule: `RULES.md` in `kristenmedo/claude-shared`.)
- **Keep output short.** Read only the part of a file you need, and don't print whole logs.
