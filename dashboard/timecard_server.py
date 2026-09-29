#!/usr/bin/env python3
"""Timecard dashboard: a live local page for the tt data files.

Serves index.html and a small JSON API on 127.0.0.1 only. Reads and writes
the same files as tt (config.json, entries.jsonl, running.json), in the same
formats. Standard library only.

    python3 timecard_server.py                 # then open http://127.0.0.1:8765
    python3 timecard_server.py --init-groups   # one-time: add the two groups

Environment:
    TIMETRACK_DIR   data folder (default ~/.timetrack)
    TIMECARD_PORT   port (default 8765)
"""

import json
import os
import re
import sys
import tempfile
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

FMT = "%Y-%m-%dT%H:%M:%S"
DATA_DIR = Path(os.environ.get("TIMETRACK_DIR", "~/.timetrack")).expanduser()
PORT = int(os.environ.get("TIMECARD_PORT", "8765"))
PAGE = Path(__file__).resolve().with_name("index.html")

ALL_GROUP = "_all"
OTHER_GROUP = "_other"

# Colours handed to new tasks, one family per group, tuned for the dark ground.
PALETTES = [
    ["#6FA8C7", "#5E9C8F", "#8C9BD6", "#4F86A8", "#7FB8B0", "#6C7FB8"],
    ["#D6A15E", "#C98579", "#CDB26A", "#B7876B", "#D98E9E", "#C4A27F"],
    ["#A58FC9", "#9DB07A", "#C98FB7", "#8FA3A8"],
]

DEFAULT_CONFIG = {
    "weekly_target_hours": 40,
    "workdays": [0, 1, 2, 3, 4],
    "day_start": "08:30",
    "day_hours": 8,
    "projects": [],
}


# ---------------------------------------------------------------- reading

def parse_ts(value):
    try:
        return datetime.strptime(value, FMT)
    except (TypeError, ValueError):
        return None


def read_raw_config():
    """The config file as written, or None if it doesn't exist."""
    path = DATA_DIR / "config.json"
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return None


def load_config(warnings):
    config = dict(DEFAULT_CONFIG)
    try:
        raw = read_raw_config()
    except (OSError, ValueError) as exc:
        warnings.append(f"config.json unreadable ({exc.__class__.__name__}), using defaults")
        raw = {}
    if raw is None:
        warnings.append(f"No config.json in {DATA_DIR}, using defaults")
        raw = {}
    if not isinstance(raw, dict):
        warnings.append("config.json is not an object, using defaults")
        raw = {}

    if isinstance(raw.get("weekly_target_hours"), (int, float)):
        config["weekly_target_hours"] = raw["weekly_target_hours"]
    if isinstance(raw.get("day_hours"), (int, float)):
        config["day_hours"] = raw["day_hours"]
    if isinstance(raw.get("workdays"), list):
        config["workdays"] = [d for d in raw["workdays"] if isinstance(d, int) and 0 <= d <= 6]
    if isinstance(raw.get("day_start"), str) and parse_hhmm(raw["day_start"]) is not None:
        config["day_start"] = raw["day_start"]

    # Groups are an optional addition to tt's config. Without them, everything
    # sits in one group that uses the top-level weekly target.
    groups = []
    for g in raw.get("groups") or []:
        if isinstance(g, dict) and isinstance(g.get("id"), str) and g["id"]:
            target = g.get("weekly_target_hours")
            groups.append({
                "id": g["id"],
                "label": g.get("label") if isinstance(g.get("label"), str) else g["id"],
                "weekly_target_hours": target if isinstance(target, (int, float)) else 0,
                # "pace": false hides the ahead/behind line for a group.
                "pace": g.get("pace") is not False,
            })
    if not groups:
        groups = [{"id": ALL_GROUP, "label": "This week",
                   "weekly_target_hours": config["weekly_target_hours"], "pace": True}]
    group_ids = {g["id"] for g in groups}

    projects = []
    for p in raw.get("projects") or []:
        if isinstance(p, dict) and isinstance(p.get("id"), str) and p["id"]:
            group = p.get("group")
            if ALL_GROUP in group_ids:
                group = ALL_GROUP
            elif group not in group_ids:
                group = OTHER_GROUP
            projects.append({
                "id": p["id"],
                "label": p.get("label") if isinstance(p.get("label"), str) else p["id"],
                "color": p.get("color") if isinstance(p.get("color"), str) else None,
                "group": group,
            })
    config["groups"] = groups
    config["projects"] = projects
    return config


def parse_hhmm(value):
    try:
        h, m = value.split(":")
        h, m = int(h), int(m)
    except (AttributeError, ValueError):
        return None
    if 0 <= h <= 23 and 0 <= m <= 59:
        return h, m
    return None


def load_entries(warnings):
    path = DATA_DIR / "entries.jsonl"
    entries, bad = [], 0
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    start, end = parse_ts(obj.get("start")), parse_ts(obj.get("end"))
                except (ValueError, AttributeError):
                    start = end = None
                if start is None or end is None or end < start:
                    bad += 1
                    continue
                entries.append((str(obj.get("project", "")), start, end))
    except FileNotFoundError:
        pass
    except OSError as exc:
        warnings.append(f"entries.jsonl unreadable ({exc.__class__.__name__})")
    if bad:
        warnings.append(f"Skipped {bad} unreadable line{'s' if bad != 1 else ''} in entries.jsonl")
    return entries


def load_running(warnings):
    path = DATA_DIR / "running.json"
    try:
        obj = json.loads(path.read_text())
    except FileNotFoundError:
        return None
    except (OSError, ValueError):
        warnings.append("running.json unreadable, ignoring it")
        return None
    if not isinstance(obj, dict) or parse_ts(obj.get("start")) is None:
        warnings.append("running.json has no valid start, ignoring it")
        return None
    return {"project": str(obj.get("project", "")), "start": obj["start"]}


def overlap(start, end, lo, hi):
    return max(0.0, (min(end, hi) - max(start, lo)).total_seconds())


def build_state():
    now = datetime.now().replace(microsecond=0)
    today = now.replace(hour=0, minute=0, second=0)
    tomorrow = today + timedelta(days=1)
    week_start = today - timedelta(days=today.weekday())

    warnings = []
    if not DATA_DIR.is_dir():
        warnings.append(f"Data folder {DATA_DIR} not found")
    config = load_config(warnings)
    entries = load_entries(warnings)
    running = load_running(warnings)

    project_group = {p["id"]: p["group"] for p in config["projects"]}
    by_group = {}
    for p, s, e in entries:
        seconds = overlap(s, e, week_start, now)
        if seconds:
            g = project_group.get(p, OTHER_GROUP)
            by_group[g] = by_group.get(g, 0) + seconds
    running_group = project_group.get(running["project"], OTHER_GROUP) if running else None

    # Tasks, and time, that belong to no configured group land in "Other",
    # which only appears when something is in it.
    groups = [dict(g) for g in config["groups"]]
    in_other = any(p["group"] == OTHER_GROUP for p in config["projects"])
    if in_other or by_group.get(OTHER_GROUP) or running_group == OTHER_GROUP:
        groups.append({"id": OTHER_GROUP, "label": "Other", "weekly_target_hours": 0, "pace": False})
    for g in groups:
        g["closed_seconds"] = by_group.get(g["id"], 0)
    config["groups"] = groups
    blocks = [
        {"project": p, "start": max(s, today).strftime(FMT), "end": min(e, tomorrow).strftime(FMT)}
        for p, s, e in sorted(entries, key=lambda x: x[1])
        if e > today and s < tomorrow
    ]

    return {
        "now": now.strftime(FMT),
        "data_dir": str(DATA_DIR),
        "week_start": week_start.strftime(FMT),
        "today_blocks": blocks,
        "running": running,
        "config": config,
        "warnings": warnings,
    }


# ---------------------------------------------------------------- writing

def append_entry(project, start, end):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = DATA_DIR / "entries.jsonl"
    needs_newline = False
    if path.exists() and path.stat().st_size > 0:
        with open(path, "rb") as f:
            f.seek(-1, os.SEEK_END)
            needs_newline = f.read(1) != b"\n"
    line = json.dumps({"project": project, "start": start, "end": end}) + "\n"
    with open(path, "a", encoding="utf-8") as f:
        f.write(("\n" if needs_newline else "") + line)
        f.flush()
        os.fsync(f.fileno())


def write_running(project, start):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=DATA_DIR, prefix=".running.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump({"project": project, "start": start}, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, DATA_DIR / "running.json")
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def stop_running(now):
    running = load_running([])
    if running is None:
        return
    append_entry(running["project"], running["start"], now.strftime(FMT))
    try:
        (DATA_DIR / "running.json").unlink()
    except FileNotFoundError:
        pass


def start_project(project):
    now = datetime.now().replace(microsecond=0)
    running = load_running([])
    if running and running["project"] == project:
        return
    stop_running(now)
    write_running(project, now.strftime(FMT))


def write_config(raw):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=DATA_DIR, prefix=".config.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(raw, f, indent=2)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, DATA_DIR / "config.json")
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def slugify(label):
    slug = re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")
    return slug or "task"


def add_task(group_id, label):
    """Add a project to config.json under a group. Returns an error or None."""
    label = " ".join(label.split())
    if not label:
        return "Task name is empty"
    if len(label) > 60:
        return "Task name is too long"
    raw = read_raw_config()
    if raw is None:
        raw = dict(DEFAULT_CONFIG)
    if not isinstance(raw, dict):
        return "config.json is not an object"
    groups = [g for g in raw.get("groups") or [] if isinstance(g, dict)]
    index = next((i for i, g in enumerate(groups) if g.get("id") == group_id), None)
    if index is None and not (group_id == ALL_GROUP and not groups):
        return f"Unknown group {group_id!r}"

    projects = raw.setdefault("projects", [])
    if not isinstance(projects, list):
        return "projects in config.json is not a list"
    taken = {p.get("id") for p in projects if isinstance(p, dict)}
    base = slugify(label)
    task_id, n = base, 2
    while task_id in taken:
        task_id, n = f"{base}-{n}", n + 1

    palette = PALETTES[min(index or 0, len(PALETTES) - 1)]
    used = {str(p.get("color", "")).upper() for p in projects if isinstance(p, dict)}
    siblings = sum(1 for p in projects if isinstance(p, dict) and p.get("group") == group_id)
    color = next((c for c in palette if c.upper() not in used), palette[siblings % len(palette)])
    task = {"id": task_id, "label": label, "color": color}
    if group_id != ALL_GROUP:
        task["group"] = group_id
    projects.append(task)
    write_config(raw)
    return None


def init_groups():
    """One-time setup: add the Refined Science and CU groups to config.json."""
    raw = read_raw_config()
    if raw is None:
        raw = dict(DEFAULT_CONFIG)
    if raw.get("groups"):
        print("config.json already has groups; nothing changed.")
        return 0
    config_path = DATA_DIR / "config.json"
    if config_path.exists():
        backup = DATA_DIR / "config.json.bak"
        backup.write_bytes(config_path.read_bytes())
        print(f"Backed up the old config to {backup}")
    raw["groups"] = [
        {"id": "refined-science", "label": "Refined Science", "weekly_target_hours": 40},
        {"id": "cu", "label": "CU", "weekly_target_hours": 8, "pace": False},
    ]
    write_config(raw)
    print(f"Added Refined Science (40 h) and CU (8 h) to {config_path}")
    ungrouped = [p.get("id") for p in raw.get("projects") or [] if isinstance(p, dict) and not p.get("group")]
    if ungrouped:
        print("These existing projects have no group yet and will show under Other: " + ", ".join(map(str, ungrouped)))
        print('Add  "group": "refined-science"  or  "group": "cu"  to each one in config.json to place it.')
    return 0


# ---------------------------------------------------------------- http

class Handler(BaseHTTPRequestHandler):
    def send_body(self, status, body, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, status, obj):
        self.send_body(status, json.dumps(obj).encode(), "application/json")

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            try:
                self.send_body(200, PAGE.read_bytes(), "text/html; charset=utf-8")
            except OSError:
                self.send_json(500, {"error": f"missing {PAGE.name}"})
        elif self.path == "/api/state":
            self.send_json(200, build_state())
        else:
            self.send_json(404, {"error": "not found"})

    def do_POST(self):
        # A custom header can't be sent cross-site without a CORS preflight,
        # which this server never grants, so other web pages can't click for you.
        if self.headers.get("X-Timecard") != "1":
            self.send_json(403, {"error": "forbidden"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            body = {}

        try:
            if self.path == "/api/start":
                project = body.get("project") if isinstance(body, dict) else None
                known = {p["id"] for p in load_config([])["projects"]}
                if project not in known:
                    self.send_json(400, {"error": f"unknown project {project!r}"})
                    return
                start_project(project)
            elif self.path == "/api/stop":
                stop_running(datetime.now().replace(microsecond=0))
            elif self.path == "/api/tasks":
                if not isinstance(body, dict):
                    body = {}
                error = add_task(str(body.get("group", "")), str(body.get("label", "")))
                if error:
                    self.send_json(400, {"error": error})
                    return
            else:
                self.send_json(404, {"error": "not found"})
                return
        except OSError as exc:
            self.send_json(500, {"error": f"write failed: {exc}"})
            return
        self.send_json(200, build_state())

    def log_message(self, fmt, *args):
        pass


def main():
    if sys.argv[1:] == ["--init-groups"]:
        return init_groups()
    server = HTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Timecard on http://127.0.0.1:{PORT}  (data: {DATA_DIR})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
