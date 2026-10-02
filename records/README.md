# Timecard

A time tracker for Refined Science and CU, laid out for the Xeneon Edge
(2560×720) and published as a private page in your Claude account:
https://claude.ai/artifact/VyeWkAHizu5cr5MNt8BM2t

Everything is saved in the page's own storage in your Claude account. It opens
in any browser signed in to that account, and Claude can read and maintain the
records from a conversation. Using the page doesn't use any Claude usage.

## Using it

- **Start:** tap a task key. **Pause** and **Resume** keep one session, adding a
  stretch of work each time. **Stop** ends it.
- **Stop at an earlier time…** ends a timer you forgot, at the time you pick.
  The timer panel warns you when one has been running since an earlier day, for
  three hours, or an hour past the end of your working day.
- Under the timer: today's time per task, and a bar filling towards your working day.
- **Sessions:** every session by day. Resume, Edit (each stretch, with ✕ to
  remove one), Move to another task, or Delete, with Undo for a few seconds.
  **+ Add session** for time you didn't track. **Export…** for a CSV of any date
  range and a full backup. **Clear…** removes today, this week or everything.
- **Tasks:** rename, recolour, move between groups, set due dates, complete or
  reopen tasks, and change each group's weekly goal.
- **Weeks:** totals by day, group and task for this or any past week, with an
  export of that week.
- **History:** every change to recorded time (edits, deletions, sessions added
  by hand, timer fixes, task and goal changes), newest first.

A full backup is one JSON file with tasks, all sessions and the whole change
log. The page reminds you when you haven't made one in a week. Claude can
restore from it if ever needed.

## Files

- `template.html`: the page's layout and styles, with a `/*APP_JS*/` marker.
- `app.js`: the page's script.
- `build.py`: puts the two together into `timecard.html`, the file that gets
  published. Run it after any change.
- `tests/`: browser tests against an in-memory stand-in for the page's storage
  and a controllable clock.

```
python3 records/build.py
NODE_PATH=$(npm root -g) node records/tests/run.js [screenshot-folder]
```

## Storage

| Path | Holds |
|---|---|
| `setup/config` | groups and weekly goals, tasks (name, colour, group, due, completed), working day |
| `setup/meta` | date of the last full backup |
| `timer/running` | the running or paused timer, and the session it belongs to |
| `weeks/<monday>` | that week's sessions; each has `start`, `end` and optional `stretches`, `note`, `source`, `edited` |
| `changes/<monday>` | the change log for edits made that week |
| `locks/<name>` | short leases so two open copies of the page don't overwrite each other |

Times are local, `YYYY-MM-DDTHH:MM:SS`. Only the page's owner can change
records; anyone it's shared with can read them.
