# Storage spike

This is a throwaway project that answers one question: where can the widget read
and write your timetrack files? It builds one host app with three widget
extensions, one for each storage route:

| Widget | Sandbox | Folder it tests |
|---|---|---|
| Probe: Exception | on, with a file-access exception for `~/.timetrack/` | `~/.timetrack` |
| Probe: App Group | on, with App Group `<TEAMID>.timecard` | `~/Library/Group Containers/<TEAMID>.timecard/timetrack` |
| Probe: No Sandbox | off | `~/.timetrack` |

Each widget tests creating the folder, a plain write and read-back, the
temp-file-then-rename write that `running.json` needs, reading `config.json` and
`entries.jsonl`, and a write from a widget button click (the same path that
Start and Stop will use). Each check shows a green or red dot.

It never modifies your real files. In each folder it writes only
`.widget-probe`, `.widget-probe-atomic` and `.widget-probe-intent.log`, which
you can delete afterwards.

## Steps

1. Install XcodeGen: `brew install xcodegen`
2. Find your team ID. Open Xcode › Settings › Accounts and select your
   Apple ID. The team is listed as "(Personal Team)". If you have built anything
   with Xcode before, this prints it as `OU=XXXXXXXXXX`:

   ```
   security find-certificate -c "Apple Development" -p | openssl x509 -noout -subject
   ```

   Put it in `Spike/Signing.xcconfig`: `DEVELOPMENT_TEAM = XXXXXXXXXX`.
   If you can't find it, leave it blank and pick your team under each target's
   Signing & Capabilities tab in Xcode.
3. Generate and open the project:

   ```
   cd Spike
   xcodegen
   open TimecardSpike.xcodeproj
   ```

4. Build and run the `TimecardSpike` scheme (⌘R). The app opens a small window.
   - **If signing fails on ProbeGroup,** that answers the App Group question.
     Copy the exact error, delete the `ProbeGroup` target and its dependency line
     from `project.yml`, run `xcodegen` again and rebuild.
   - Compile errors: paste them back to me.
5. Right-click the desktop, choose Edit Widgets…, search for "Probe" and add each
   widget at large size. If a probe never appears in the gallery, that is also
   a result. Check the host app window to see whether its extension was
   embedded.
   If none appear, quit the app, copy it from the path shown in its window to
   `/Applications`, and launch it from there.
6. Click "Probe again" on each widget once. Wait a few seconds for the count to
   go up.
7. **App Group only:** from Terminal, check whether your Python CLI could share
   that folder, and note any "would like to access data from other apps" prompt:

   ```
   ls -la ~/Library/Group\ Containers/*.timecard/timetrack/
   echo test >> ~/Library/Group\ Containers/*.timecard/timetrack/cli-probe.txt
   ```

## Send back

- A screenshot of the widgets
- Any signing errors, word for word
- Any permission prompts macOS showed, and which process they named
- Optional: the log, which contains every check result:

  ```
  log show --last 10m --predicate 'subsystem == "com.kristenmedo.timecardspike"'
  ```
