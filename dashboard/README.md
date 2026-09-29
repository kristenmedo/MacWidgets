# Timecard dashboard

A live page for the Xeneon Edge. It shows each group's week against its goal,
what's running, and today as a strip chart. Tap a task to start it and tap it
again to stop. It reads and writes the same files as `tt`, in `~/.timetrack`,
so the Stream Deck, `tt` and this page all stay in step. The page checks for
changes every 5 seconds.

## One-time setup

In Terminal:

```
cd ~/MacWidgets
git pull
cd dashboard
```

**1. Add the two groups** (Refined Science, 40 h; CU, 8 h) to your
`config.json`. Your current file is copied to `config.json.bak` first.

```
python3 timecard_server.py --init-groups
```

Existing projects without a group show up under "Other". To place one, add a
`"group"` line to it in `~/.timetrack/config.json`, e.g.

```json
{ "id": "sdtm", "label": "SDTM mapping", "color": "#6FA8C7", "group": "refined-science" }
```

**2. Start the server, now and at every login:**

```
bash install.sh
```

**3. Make it an app window.** Open `http://127.0.0.1:8765` in Safari, then
choose **File › Add to Dock…** and name it Timecard. Open the new Timecard
app, drag its window onto the Edge, and click the green button to make it
full screen there.

**4. Stream Deck.** Add a **System › Open** button that opens
`~/Applications/Timecard.app`, to flip to the tracker. For flipping back, a
**System › Hotkey** button that sends ⌘H hides it.

## Everyday use

- **+ Add task** under a group adds a task. It's saved in `config.json` with
  its own colour, and `tt start <id>` works with it too.
- To rename, recolour, regroup or remove tasks, or to change the weekly goals,
  edit `~/.timetrack/config.json`. The page picks up the change within 5 seconds.
- Starting a task while another runs stops the first one.
- The "behind pace" line spreads a group's goal over your workdays. Add
  `"pace": false` to a group in `config.json` to hide it (CU has this).

## Sessions and your records

**Sessions** (under the running timer) lists every logged session, newest
first, grouped by day. From there you can:

- **Edit** a session's task, start, end and note, or **Delete** it (asks first).
  Tapping a block in the day strip opens that session for editing.
- **+ Add session** to log time you forgot to track. It's labelled "added".
- Fix the running timer's start time, or discard it without saving.
- **Clear…** today, this week, or everything (asks twice).
- **Export CSV** of every session: date, group, task, start, end, hours,
  whether it was timed or added by hand, note, and when it was last edited.

What's kept in `~/.timetrack`:

- `entries.jsonl`: the sessions. Notes, "added" and "edited" are extra fields
  on each line.
- `audit.jsonl`: a change log. Every edit, delete, manual add, running-timer
  fix and clear is appended here with the time and the before and after
  values. The dashboard never edits or trims it.
- `entries.jsonl.bak-<date>`: a full copy saved before each Clear.

## If something's wrong

- Page says "Can't reach the timecard server": run `bash install.sh` again.
  It prints the log if the server won't start.
- Log: `~/Library/Logs/timecard.log`
- Remove it: `launchctl bootout gui/$(id -u)/com.kristenmedo.timecard` and delete
  `~/Library/LaunchAgents/com.kristenmedo.timecard.plist`.
