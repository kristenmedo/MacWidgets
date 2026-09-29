# Timecard (claude.ai)

The live tracker at https://claude.ai/artifact/VyeWkAHizu5cr5MNt8BM2t.
Everything is stored in the page's own database in your Claude account, so it
works from any browser where you're signed in, and Claude can read it back.

- `timecard.html` is the published page; `app.js` is its script, kept here
  for editing and inlined into the page before publishing.
- Storage: `setup/config` (groups, tasks, working day), `timer/running`,
  `weeks/<monday>` (that week's sessions), `changes/<monday>` (change log).
- Only the owner can change records. Anyone the page is shared with can read.
