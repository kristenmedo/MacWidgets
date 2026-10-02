#!/usr/bin/env python3
"""Builds timecard.html (the published page) from template.html and app.js."""
from pathlib import Path

here = Path(__file__).resolve().parent
template = (here / "template.html").read_text()
script = (here / "app.js").read_text()
if template.count("/*APP_JS*/") != 1:
    raise SystemExit("template.html must contain /*APP_JS*/ exactly once")
(here / "timecard.html").write_text(template.replace("/*APP_JS*/", script.rstrip() + "\n"))
print("Built timecard.html")
