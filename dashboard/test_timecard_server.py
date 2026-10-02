#!/usr/bin/env python3
"""Tests for timecard_server.py's data-mutating paths: add/edit/delete/clear
sessions, start/stop/edit the running timer, add tasks, and export. These are
the paths that touch real time data, so each test runs against a throwaway
temp directory (never ~/.timetrack) and checks the file contents afterward.

    python3 -m unittest dashboard/test_timecard_server.py -v
"""

import csv
import io
import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import timecard_server as ts


def fmt(dt):
    return dt.strftime(ts.FMT)


class DataDirTestCase(unittest.TestCase):
    """Points ts.DATA_DIR at a fresh temp directory for each test."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._orig_data_dir = ts.DATA_DIR
        ts.DATA_DIR = Path(self._tmp.name)

    def tearDown(self):
        ts.DATA_DIR = self._orig_data_dir
        self._tmp.cleanup()

    # -- helpers --------------------------------------------------------

    def write_config(self, config):
        (ts.DATA_DIR / "config.json").write_text(json.dumps(config))

    def write_entries(self, entries):
        lines = [json.dumps(e) for e in entries]
        (ts.DATA_DIR / "entries.jsonl").write_text(
            "".join(line + "\n" for line in lines)
        )

    def entry_lines(self):
        return ts.read_entry_lines()

    def audit_records(self):
        path = ts.DATA_DIR / "audit.jsonl"
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]

    def session_id_for(self, index):
        return ts.line_id(index, self.entry_lines()[index])


# ------------------------------------------------------------------ tasks

class AddTaskTests(DataDirTestCase):
    def test_add_task_with_no_config_uses_all_group(self):
        error = ts.add_task(ts.ALL_GROUP, "Write tests")
        self.assertIsNone(error)
        config = ts.read_raw_config()
        self.assertEqual(len(config["projects"]), 1)
        task = config["projects"][0]
        self.assertEqual(task["id"], "write-tests")
        self.assertEqual(task["label"], "Write tests")
        self.assertNotIn("group", task)  # ALL_GROUP tasks aren't tagged

    def test_add_task_unknown_group_fails(self):
        self.write_config({"groups": [{"id": "refined-science", "label": "RS"}]})
        error = ts.add_task("not-a-group", "Thing")
        self.assertEqual(error, "Unknown group 'not-a-group'")
        config = ts.read_raw_config()
        self.assertEqual(config.get("projects", []), [])

    def test_add_task_dedupes_ids(self):
        self.write_config({"groups": [{"id": "g", "label": "G"}]})
        ts.add_task("g", "Report")
        ts.add_task("g", "Report")
        config = ts.read_raw_config()
        ids = [p["id"] for p in config["projects"]]
        self.assertEqual(ids, ["report", "report-2"])

    def test_add_task_rejects_empty_or_long_labels(self):
        self.write_config({"groups": [{"id": "g", "label": "G"}]})
        self.assertEqual(ts.add_task("g", "   "), "Task name is empty")
        self.assertEqual(ts.add_task("g", "x" * 61), "Task name is too long")

    def test_add_task_assigns_group_specific_colour(self):
        self.write_config({"groups": [{"id": "g", "label": "G"}]})
        ts.add_task("g", "First")
        ts.add_task("g", "Second")
        colors = [p["color"] for p in ts.read_raw_config()["projects"]]
        self.assertEqual(len(colors), len(set(colors)))  # no duplicate colours


# --------------------------------------------------------------- sessions

class SessionMutationTests(DataDirTestCase):
    def setUp(self):
        super().setUp()
        self.write_config({"projects": [{"id": "sdtm", "label": "SDTM"}]})
        self.write_entries([
            {"project": "sdtm", "start": "2024-01-01T09:00:00", "end": "2024-01-01T10:00:00"},
        ])

    def test_add_session_appends_entry_with_manual_source(self):
        ts.add_session("sdtm", "2024-01-01T11:00", "2024-01-01T12:00", "catch-up")
        lines = self.entry_lines()
        self.assertEqual(len(lines), 2)
        added = json.loads(lines[1])
        self.assertEqual(added["source"], "manual")
        self.assertEqual(added["note"], "catch-up")
        self.assertEqual(self.audit_records()[-1]["action"], "add")

    def test_add_session_rejects_end_before_start(self):
        with self.assertRaises(ts.UserError):
            ts.add_session("sdtm", "2024-01-01T12:00", "2024-01-01T11:00", "")

    def test_add_session_rejects_future_end(self):
        far_future = fmt(datetime.now() + timedelta(days=1))[:16]
        with self.assertRaises(ts.UserError):
            ts.add_session("sdtm", "2024-01-01T11:00", far_future, "")

    def test_add_session_rejects_unknown_project(self):
        with self.assertRaises(ts.UserError):
            ts.add_session("not-a-task", "2024-01-01T11:00", "2024-01-01T12:00", "")

    def test_update_session_edits_fields_and_audits(self):
        sid = self.session_id_for(0)
        ts.update_session(sid, "sdtm", "2024-01-01T09:00", "2024-01-01T10:30", "extended")
        lines = self.entry_lines()
        obj = json.loads(lines[0])
        self.assertEqual(obj["end"], "2024-01-01T10:30:00")
        self.assertEqual(obj["note"], "extended")
        self.assertIn("edited", obj)
        record = self.audit_records()[-1]
        self.assertEqual(record["action"], "edit")
        self.assertEqual(record["after"]["note"], "extended")

    def test_update_session_noop_does_not_audit(self):
        sid = self.session_id_for(0)
        # Same values back, to the minute: should not count as a change.
        ts.update_session(sid, "sdtm", "2024-01-01T09:00", "2024-01-01T10:00", "")
        self.assertEqual(self.audit_records(), [])

    def test_update_session_keeps_seconds_when_minute_unchanged(self):
        self.write_entries([
            {"project": "sdtm", "start": "2024-01-01T09:00:17", "end": "2024-01-01T10:00:42"},
        ])
        sid = self.session_id_for(0)
        # Note-only edit; start/end minute fields match the original minute.
        ts.update_session(sid, "sdtm", "2024-01-01T09:00", "2024-01-01T10:00", "note")
        obj = json.loads(self.entry_lines()[0])
        self.assertEqual(obj["start"], "2024-01-01T09:00:17")
        self.assertEqual(obj["end"], "2024-01-01T10:00:42")

    def test_update_session_rejects_end_before_start(self):
        sid = self.session_id_for(0)
        with self.assertRaises(ts.UserError):
            ts.update_session(sid, "sdtm", "2024-01-01T10:00", "2024-01-01T09:00", "")

    def test_update_session_stale_id_rejected(self):
        with self.assertRaises(ts.UserError) as ctx:
            ts.update_session("0-0000000000", "sdtm", "2024-01-01T09:00", "2024-01-01T10:00", "")
        self.assertEqual(ctx.exception.status, 409)

    def test_delete_session_removes_line_and_audits(self):
        sid = self.session_id_for(0)
        ts.delete_session(sid)
        self.assertEqual(self.entry_lines(), [])
        self.assertEqual(self.audit_records()[-1]["action"], "delete")

    def test_delete_session_stale_id_rejected(self):
        with self.assertRaises(ts.UserError):
            ts.delete_session("99-deadbeefde")

    def test_delete_session_with_multiple_lines_removes_only_target(self):
        self.write_entries([
            {"project": "sdtm", "start": "2024-01-01T09:00:00", "end": "2024-01-01T10:00:00"},
            {"project": "sdtm", "start": "2024-01-02T09:00:00", "end": "2024-01-02T10:00:00"},
        ])
        sid = self.session_id_for(1)
        ts.delete_session(sid)
        remaining = [json.loads(l) for l in self.entry_lines()]
        self.assertEqual(len(remaining), 1)
        self.assertEqual(remaining[0]["start"], "2024-01-01T09:00:00")


class ClearSessionsTests(DataDirTestCase):
    def setUp(self):
        super().setUp()
        self.write_config({"projects": [{"id": "sdtm", "label": "SDTM"}]})
        self.now = datetime.now().replace(microsecond=0)
        self.today = self.now.replace(hour=9, minute=0, second=0)
        self.last_week = self.today - timedelta(days=8)
        self.write_entries([
            {"project": "sdtm", "start": fmt(self.last_week), "end": fmt(self.last_week + timedelta(hours=1))},
            {"project": "sdtm", "start": fmt(self.today), "end": fmt(self.today + timedelta(hours=1))},
        ])

    def test_clear_today_keeps_older_entries(self):
        ts.clear_sessions("today")
        remaining = [json.loads(l) for l in self.entry_lines()]
        self.assertEqual(len(remaining), 1)
        self.assertEqual(remaining[0]["start"], fmt(self.last_week))

    def test_clear_all_removes_everything_and_backs_up(self):
        ts.clear_sessions("all")
        self.assertEqual(self.entry_lines(), [])
        backups = list(ts.DATA_DIR.glob("entries.jsonl.bak-*"))
        self.assertEqual(len(backups), 1)
        backed_up = [json.loads(l) for l in backups[0].read_text().splitlines() if l.strip()]
        self.assertEqual(len(backed_up), 2)

    def test_clear_audits_removed_entries(self):
        ts.clear_sessions("all")
        record = self.audit_records()[-1]
        self.assertEqual(record["action"], "clear")
        self.assertEqual(record["scope"], "all")
        self.assertEqual(len(record["removed"]), 2)

    def test_clear_rejects_unknown_scope(self):
        with self.assertRaises(ts.UserError):
            ts.clear_sessions("yesterday")

    def test_clear_with_nothing_matching_scope_leaves_entries_untouched(self):
        # A backup is still taken (clear_sessions backs up before it knows
        # whether the scope matches anything), but nothing is rewritten or
        # audited when there's nothing to remove.
        self.write_entries([
            {"project": "sdtm", "start": fmt(self.last_week), "end": fmt(self.last_week + timedelta(hours=1))},
        ])
        before = (ts.DATA_DIR / "entries.jsonl").read_text()
        ts.clear_sessions("today")
        self.assertEqual((ts.DATA_DIR / "entries.jsonl").read_text(), before)
        self.assertEqual(self.audit_records(), [])


# ---------------------------------------------------------------- running

class RunningTimerTests(DataDirTestCase):
    def setUp(self):
        super().setUp()
        self.write_config({"projects": [{"id": "sdtm", "label": "SDTM"}, {"id": "other", "label": "Other task"}]})

    def test_start_task_writes_running_file(self):
        ts.start_task("sdtm")
        running = json.loads((ts.DATA_DIR / "running.json").read_text())
        self.assertEqual(running["project"], "sdtm")
        self.assertFalse((ts.DATA_DIR / "entries.jsonl").exists())

    def test_start_task_unknown_project_rejected(self):
        with self.assertRaises(ts.UserError):
            ts.start_task("not-a-task")
        self.assertFalse((ts.DATA_DIR / "running.json").exists())

    def test_starting_second_task_stops_first_into_an_entry(self):
        ts.start_task("sdtm")
        ts.start_task("other")
        lines = self.entry_lines()
        self.assertEqual(len(lines), 1)
        self.assertEqual(json.loads(lines[0])["project"], "sdtm")
        running = json.loads((ts.DATA_DIR / "running.json").read_text())
        self.assertEqual(running["project"], "other")

    def test_starting_same_task_again_is_a_noop(self):
        ts.start_task("sdtm")
        first = (ts.DATA_DIR / "running.json").read_text()
        ts.start_task("sdtm")
        self.assertEqual((ts.DATA_DIR / "running.json").read_text(), first)
        self.assertFalse((ts.DATA_DIR / "entries.jsonl").exists())

    def test_stop_running_with_nothing_running_is_a_noop(self):
        ts.stop_running(datetime.now())
        self.assertFalse((ts.DATA_DIR / "entries.jsonl").exists())

    def test_update_running_changes_project_and_audits(self):
        ts.start_task("sdtm")
        start = json.loads((ts.DATA_DIR / "running.json").read_text())["start"]
        ts.update_running("other", start[:16])
        running = json.loads((ts.DATA_DIR / "running.json").read_text())
        self.assertEqual(running["project"], "other")
        self.assertEqual(self.audit_records()[-1]["action"], "edit-running")

    def test_update_running_future_start_rejected(self):
        ts.start_task("sdtm")
        far_future = fmt(datetime.now() + timedelta(days=1))[:16]
        with self.assertRaises(ts.UserError):
            ts.update_running("sdtm", far_future)

    def test_update_running_with_nothing_running_rejected(self):
        with self.assertRaises(ts.UserError) as ctx:
            ts.update_running("sdtm", "2024-01-01T09:00")
        self.assertEqual(ctx.exception.status, 409)

    def test_discard_running_removes_file_without_an_entry(self):
        ts.start_task("sdtm")
        ts.discard_running()
        self.assertFalse((ts.DATA_DIR / "running.json").exists())
        self.assertFalse((ts.DATA_DIR / "entries.jsonl").exists())
        self.assertEqual(self.audit_records()[-1]["action"], "discard-running")

    def test_discard_running_with_nothing_running_is_a_noop(self):
        ts.discard_running()
        self.assertEqual(self.audit_records(), [])


# ----------------------------------------------------------------- export

class ExportCsvTests(DataDirTestCase):
    def test_export_includes_group_label_and_falls_back_to_other(self):
        self.write_config({
            "groups": [{"id": "g", "label": "Group One"}],
            "projects": [{"id": "sdtm", "label": "SDTM", "group": "g"}],
        })
        self.write_entries([
            {"project": "sdtm", "start": "2024-01-01T09:00:00", "end": "2024-01-01T11:30:00"},
            {"project": "deleted-task", "start": "2024-01-02T09:00:00", "end": "2024-01-02T10:00:00"},
        ])
        rows = list(csv.reader(io.StringIO(ts.export_csv())))
        header, row1, row2 = rows[0], rows[1], rows[2]
        self.assertEqual(header[:3], ["date", "group", "task"])
        self.assertEqual(row1[1:3], ["Group One", "SDTM"])
        self.assertEqual(row1[6], "2.50")  # hours
        self.assertEqual(row2[1:3], ["Other", "deleted-task"])  # unknown task falls back


# ------------------------------------------------------------------ config

class ConfigLoadingTests(DataDirTestCase):
    def test_load_config_defaults_when_missing(self):
        config = ts.load_config([])
        self.assertEqual(config["weekly_target_hours"], 40)
        self.assertEqual(config["groups"][0]["id"], ts.ALL_GROUP)

    def test_load_config_warns_on_malformed_json(self):
        (ts.DATA_DIR / "config.json").write_text("{not json")
        warnings = []
        ts.load_config(warnings)
        self.assertTrue(warnings)

    def test_load_config_assigns_unknown_group_projects_to_other(self):
        self.write_config({
            "groups": [{"id": "g", "label": "G"}],
            "projects": [{"id": "orphan", "label": "Orphan", "group": "missing"}],
        })
        config = ts.load_config([])
        self.assertEqual(config["projects"][0]["group"], ts.OTHER_GROUP)


class InitGroupsTests(DataDirTestCase):
    def test_init_groups_adds_groups_and_backs_up_existing_config(self):
        self.write_config({"projects": [{"id": "sdtm", "label": "SDTM"}]})
        ts.init_groups()
        config = ts.read_raw_config()
        ids = [g["id"] for g in config["groups"]]
        self.assertEqual(ids, ["refined-science", "cu"])
        self.assertTrue((ts.DATA_DIR / "config.json.bak").exists())

    def test_init_groups_is_a_noop_if_groups_already_exist(self):
        self.write_config({"groups": [{"id": "g", "label": "G"}]})
        ts.init_groups()
        config = ts.read_raw_config()
        self.assertEqual([g["id"] for g in config["groups"]], ["g"])


if __name__ == "__main__":
    unittest.main()
