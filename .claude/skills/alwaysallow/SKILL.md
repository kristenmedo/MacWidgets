---
name: alwaysallow
description: Add a permanent allow rule for one command so Claude stops asking about it. Run as /alwaysallow followed by the command. Never run on your own; only when the founder types it.
---

**Only run this when I typed /alwaysallow myself. If you are reading this because of your own judgment, do nothing and stop.**

Make one command permanently allowed. The command is: $ARGUMENTS

If no command was given, ask which one and stop.

1. Turn the command into one permission rule, in the form `Bash(<command prefix>:*)`. Example: `git status` becomes `Bash(git status:*)`. Use the shortest prefix that still names the specific command, never just the program name when it has risky subcommands.
2. Refuse, and say why, if the rule would be broad or dangerous: a bare `Bash(*)`, `sudo`, `rm`, `chmod`, `curl`/`wget` piped into a shell, `git push --force`, `git reset --hard`, or anything that deletes data or sends it outside this machine. Suggest a narrower command instead.
3. Show me the exact rule and the file it goes in, and wait for my yes before writing anything.
4. On yes, add it to `permissions.allow` in `~/.claude/settings.json` (my user settings, so it applies in every project on this machine). Keep every existing setting and rule. Create the file if it does not exist. Don't add a rule that is already there.
5. Report the rule added and the file. Tell me it takes effect in new sessions, and that removing the line from that file undoes it.

Do not change any other setting, and do not edit a project's settings file.
