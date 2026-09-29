"use strict";

// ---------------------------------------------------------------- store
//
// setup/config    {groups:[{id,label,target,pace}], tasks:[{id,label,color,group}],
//                  day_start, day_hours, workdays}
// timer/running   {project, start}            present only while a timer runs
// weeks/<monday>  {week, sessions:[{id, project, start, end, note?, source?, edited?}]}
// changes/<monday> {week, entries:[{at, action, before?, after?, ...}]}
//
// Times are naive local "YYYY-MM-DDTHH:MM:SS", the same format tt used.

let db = null;
let downloads = null;
let config = null;
let configLoaded = false;
let running = null;
let weeks = {};            // monday key -> sessions array
let weeksLoaded = false;
let storeError = "";
let writeChain = Promise.resolve();

let adding = null;          // group id whose add-task box is open
let addDraft = "";
let view = "tasks";         // "tasks" or "sessions"
let sessEdit = null;        // session id being edited, "new", or "running"
let sessConfirm = null;     // session id (or "running") awaiting delete confirmation
let clearMode = false;
let clearArmed = null;
let sessError = "";
let sessMove = null;        // session id (or "running") whose Move picker is open
let linksMode = false;      // Stream Deck links panel
let completing = null;      // task id whose "Complete" date box is open (Tasks view)
let runningLoaded = false;
let toastTimer = null;

// Stream Deck keys open this page's link with a command after "#":
//   #start-<task id>   start that task (does nothing if it's already running)
//   #stop              stop whatever is running
const PAGE_URL = "https://claude.ai/artifact/VyeWkAHizu5cr5MNt8BM2t";
let pendingCmd = null;
let actionError = "";

const DEFAULTS = {day_start: "08:30", day_hours: 8, workdays: [0, 1, 2, 3, 4]};
const PALETTES = [
  ["#0A84FF", "#30D158", "#64D2FF", "#7D7AFF", "#00C7BE", "#5AC8FA"],
  ["#FF9F0A", "#FF453A", "#FFD60A", "#FF375F", "#FF6B35", "#E5B96B"],
  ["#BF5AF2", "#A2D95A", "#FF7EB6", "#AC8E68"],
];

// ---------------------------------------------------------------- time helpers

function pad(n) { return String(n).padStart(2, "0"); }

function fmt(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function parseTs(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s || "");
  if (!m) return null;
  return new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
}

function mondayOf(d) {
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() - ((day.getDay() + 6) % 7));
}

function weekKey(d) {
  const m = mondayOf(d);
  return `${m.getFullYear()}-${pad(m.getMonth() + 1)}-${pad(m.getDate())}`;
}

function dayKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toInput(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
}

function hm(seconds) {
  const mins = Math.max(0, Math.floor(seconds / 60));
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${pad(m)}m`;
}

function clock(d) {
  let h = d.getHours();
  const m = pad(d.getMinutes());
  const ap = h < 12 ? "am" : "pm";
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}

// ---------------------------------------------------------------- derived state

function allSessions() {
  const out = [];
  for (const [key, list] of Object.entries(weeks)) {
    for (const s of list) if (parseTs(s.start) && parseTs(s.end)) out.push({...s, week: key});
  }
  out.sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0));
  return out;
}

// Builds the same shape the Edge dashboard drew from, out of the stored docs.
function buildState(now) {
  const cfg = config || {};
  const groups = (Array.isArray(cfg.groups) ? cfg.groups : [])
    .filter(g => g && typeof g.id === "string")
    .map(g => ({
      id: g.id,
      label: typeof g.label === "string" ? g.label : g.id,
      weekly_target_hours: typeof g.target === "number" ? g.target : 0,
      pace: g.pace !== false,
    }));
  const ids = new Set(groups.map(g => g.id));
  const projects = (Array.isArray(cfg.tasks) ? cfg.tasks : [])
    .filter(t => t && typeof t.id === "string")
    .map(t => ({
      id: t.id,
      label: typeof t.label === "string" ? t.label : t.id,
      color: typeof t.color === "string" ? t.color : null,
      group: ids.has(t.group) ? t.group : "_other",
      due: typeof t.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.due) ? t.due : "",
      completed: typeof t.completed === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.completed) ? t.completed : "",
    }));
  // Completed tasks stay known (for names and colours in history) but leave the keys.
  const active = projects.filter(p => !p.completed);
  const projectGroup = {};
  for (const p of projects) projectGroup[p.id] = p.group;

  const weekStart = mondayOf(now);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const byGroup = {};
  const blocks = [];
  const sessions = allSessions();
  for (const s of sessions) {
    const a = parseTs(s.start), b = parseTs(s.end);
    const secs = Math.max(0, (Math.min(b, now) - Math.max(a, weekStart)) / 1000);
    if (secs > 0) {
      const g = projectGroup[s.project] || "_other";
      byGroup[g] = (byGroup[g] || 0) + secs;
    }
    if (b > today && a < tomorrow) {
      blocks.push({id: s.id, project: s.project, start: new Date(Math.max(a, today)), end: new Date(Math.min(b, tomorrow))});
    }
  }
  blocks.sort((x, y) => x.start - y.start);

  const runGroup = running ? (projectGroup[running.project] || "_other") : null;
  if (active.some(p => p.group === "_other") || byGroup._other || runGroup === "_other") {
    groups.push({id: "_other", label: "Other", weekly_target_hours: 0, pace: false});
  }
  for (const g of groups) g.closed_seconds = byGroup[g.id] || 0;

  return {
    config: {
      groups, projects, active,
      day_start: typeof cfg.day_start === "string" && /^\d{1,2}:\d{2}$/.test(cfg.day_start) ? cfg.day_start : DEFAULTS.day_start,
      day_hours: typeof cfg.day_hours === "number" ? cfg.day_hours : DEFAULTS.day_hours,
      workdays: Array.isArray(cfg.workdays) ? cfg.workdays.filter(d => Number.isInteger(d)) : DEFAULTS.workdays,
    },
    running,
    weekStart,
    blocks,
    sessions,
  };
}

let S = null;   // the state of the current render

function projectMap() {
  const map = {};
  for (const p of S.config.projects) map[p.id] = p;
  return map;
}
function groupOf(id) { const p = projectMap()[id]; return p ? p.group : "_other"; }
function colorOf(id) { const p = projectMap()[id]; return (p && p.color) || "#8E8E93"; }
function labelOf(id) { const p = projectMap()[id]; return p ? p.label : id; }
function groupLabel(id) {
  const g = S.config.groups.find(g => g.id === groupOf(id));
  return g ? g.label : "";
}

// timer/running holds the current task. While running, `start` is when the
// current stretch began; `carried` is the time from earlier stretches of the
// same task before a pause (each already saved as its own session). While
// paused, `paused: true` and `paused_at` replace `start`.
function runningInfo(now) {
  const r = S.running;
  if (!r) return null;
  const carried = typeof r.carried === "number" ? r.carried : 0;
  if (r.paused) {
    return {id: r.project, paused: true, start: null, pausedAt: parseTs(r.paused_at), elapsed: carried, weekPart: 0, carried};
  }
  const start = parseTs(r.start);
  if (!start) return null;
  return {
    id: r.project,
    paused: false,
    start,
    carried,
    elapsed: carried + (now - start) / 1000,
    weekPart: Math.max(0, (now - Math.max(start, S.weekStart)) / 1000),
  };
}

function expectedByNow(target, now) {
  const cfg = S.config;
  const days = cfg.workdays;
  if (!target || !days.length) return 0;
  const [sh, sm] = cfg.day_start.split(":").map(Number);
  const span = cfg.day_hours * 3600 * 1000;
  let done = 0;
  for (let i = 0; i < 7; i++) {
    if (!days.includes(i)) continue;   // 0 = Monday
    const ds = new Date(S.weekStart.getFullYear(), S.weekStart.getMonth(), S.weekStart.getDate() + i, sh, sm);
    done += span > 0 ? Math.min(1, Math.max(0, (now - ds) / span)) : 0;
  }
  return target * 3600 * done / days.length;
}

// ---------------------------------------------------------------- rendering: tasks view

function renderNow(now, run) {
  const el = document.getElementById("now");
  if (!el) return;
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let today = 0;
  for (const b of S.blocks) today += (b.end - b.start) / 1000;
  if (run && !run.paused) today += Math.max(0, (now - Math.max(run.start, todayStart)) / 1000);

  let html;
  if (run) {
    const mins = Math.floor(run.elapsed / 60);
    const h = Math.floor(mins / 60), m = mins % 60;
    const known = !!projectMap()[run.id];
    const since = run.paused
      ? `Paused${run.pausedAt ? " at " + clock(run.pausedAt) : ""}`
      : `since ${clock(run.start)}${run.carried >= 60 ? ` (+${hm(run.carried)})` : ""}`;
    html = `<div class="task">${esc(labelOf(run.id))}</div>
      <div class="group">${esc(groupLabel(run.id))}${known ? "" : " · not in setup"}</div>
      <div class="elapsed${run.paused ? " paused" : ""}">${h}<span class="u">h</span>${pad(m)}<span class="u">m</span></div>
      <div class="since">${esc(since)}</div>
      <div class="ctrl-btns">
        ${run.paused
          ? `<button class="ctrl" data-act="resume" style="--c:${esc(colorOf(run.id))}">▶ Resume</button>`
          : `<button class="ctrl" data-act="pause">❚❚ Pause</button>`}
        <button class="ctrl" data-act="stop">■ Stop</button>
      </div>`;
  } else {
    html = `<div class="task">Not tracking</div>
      <div class="group">Tap a task to start</div>`;
  }
  if (view === "tasks") html += `<div class="now-btns"><button class="pill" data-act="sessions">Sessions</button><button class="pill" data-act="tasklist">Tasks</button></div>`;
  html += `<div class="today"><b>${hm(today)}</b> today of ${S.config.day_hours}h</div>`;
  el.innerHTML = html;
}

function todayKey() { return dayKey(new Date()); }

function shortDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const opts = {month: "short", day: "numeric"};
  if (y !== new Date().getFullYear()) opts.year = "numeric";
  return date.toLocaleDateString("en-US", opts);
}

function dueHtml(due) {
  const t = todayKey();
  const cls = due < t ? "due over" : due === t ? "due today" : "due";
  const text = due < t ? `overdue ${shortDate(due)}` : due === t ? "due today" : `due ${shortDate(due)}`;
  return `<span class="${cls}">${esc(text)}</span>`;
}

function groupWeek(g, run) {
  let total = g.closed_seconds;
  if (run && groupOf(run.id) === g.id) total += run.weekPart;
  return total;
}

function renderGroups(now, run) {
  const top = document.getElementById("top");
  const groups = S.config.groups;
  top.style.gridTemplateColumns = `minmax(0, 11rem) repeat(${Math.max(1, groups.length)}, minmax(0, 1fr))`;

  let html = `<section id="now"></section>`;
  if (!groups.length) {
    html += `<section class="grp"><div class="grp-name">${configLoaded ? "No groups set up yet" : "Loading your setup…"}</div>
      <div class="grp-empty">${configLoaded ? "Ask Claude to add your groups and weekly goals." : ""}</div></section>`;
  }
  for (const g of groups) {
    const week = groupWeek(g, run);
    let pace = `<div class="grp-pace"></div>`;
    if (g.pace && g.weekly_target_hours > 0) {
      const diff = week - expectedByNow(g.weekly_target_hours, now);
      if (Math.abs(diff) < 10 * 60) pace = `<div class="grp-pace">on pace</div>`;
      else if (diff < 0) pace = `<div class="grp-pace behind">${hm(-diff)} behind pace</div>`;
      else pace = `<div class="grp-pace">${hm(diff)} ahead of pace</div>`;
    }
    const target = g.weekly_target_hours > 0 ? ` <span class="of">of ${g.weekly_target_hours}h</span>` : "";

    let tasks = "";
    for (const p of S.config.active.filter(p => p.group === g.id)) {
      const on = run && run.id === p.id && !run.paused;
      const held = run && run.id === p.id && run.paused;
      const color = esc(p.color || "#8E8E93");
      const style = on ? ` style="background:${color}"` : held ? ` style="border-color:${color}"` : "";
      tasks += `<button class="task-btn${on ? " on" : ""}${held ? " held" : ""}" data-task="${esc(p.id)}"${style}>
        <span class="sw" style="background:${color}"></span>
        <span class="name"><span class="nm">${esc(p.label)}</span>${p.due ? dueHtml(p.due) : ""}</span>
        ${on ? `<span class="t">pause</span>` : held ? `<span class="t">paused</span>` : ""}
      </button>`;
    }
    if (g.id !== "_other") {
      if (adding === g.id) {
        tasks += `<form class="add-form" data-group="${esc(g.id)}">
          <input id="add-task-${esc(g.id)}" name="label" placeholder="Task name" maxlength="60" autocomplete="off" value="${esc(addDraft)}">
          <input id="add-due-${esc(g.id)}" name="due" type="date" aria-label="Due date (optional)" title="Due date (optional)">
          <button type="submit">Add</button>
        </form>`;
      } else {
        tasks += `<button class="task-btn add-btn" data-add="${esc(g.id)}">+ Add task</button>`;
      }
    } else if (!tasks) {
      tasks = `<div class="grp-empty">Time from tasks that aren't in a group</div>`;
    }

    html += `<section class="grp">
      <div class="grp-head">
        <div class="grp-name">${esc(g.label)}</div>
        <div class="grp-week">${hm(week)}${target}</div>
      </div>
      ${pace}
      <div class="tasks">${tasks}</div>
    </section>`;
  }
  top.innerHTML = html;
  renderNow(now, run);

  const input = top.querySelector(".add-form input");
  if (input) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}

function renderStrip(now, run) {
  const cfg = S.config;
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [sh, sm] = cfg.day_start.split(":").map(Number);
  const workStart = new Date(todayStart.getTime() + (sh * 60 + sm) * 60000);
  const workEnd = new Date(workStart.getTime() + cfg.day_hours * 3600000);
  const isWorkday = cfg.workdays.includes((now.getDay() + 6) % 7);

  const blocks = S.blocks.map(b => ({id: b.project, sid: b.id, start: b.start, end: b.end}));
  if (run && !run.paused) blocks.push({id: run.id, sid: "running", start: new Date(Math.max(run.start, todayStart)), end: now});

  let lo = workStart, hi = workEnd;
  for (const b of blocks) {
    if (b.start < lo) lo = b.start;
    if (b.end > hi) hi = b.end;
  }
  lo = new Date(todayStart.getTime() + Math.floor((lo - todayStart) / 3600000) * 3600000);
  hi = new Date(todayStart.getTime() + Math.min(24, Math.ceil((hi - todayStart) / 3600000)) * 3600000);
  const span = hi - lo;
  const pct = t => ((t - lo) / span * 100).toFixed(3) + "%";
  const w = (a, b) => ((b - a) / span * 100).toFixed(3) + "%";

  const strip = document.getElementById("strip");
  let html = "";
  if (isWorkday) html += `<div class="work" style="left:${pct(workStart)};width:${w(workStart, workEnd)}"></div>`;
  let axis = "";
  for (let t = lo.getTime(); t <= hi.getTime(); t += 3600000) {
    const d = new Date(t);
    const h = d.getHours();
    const first = t === lo.getTime();
    const label = h === 0 ? "12 am" : h === 12 ? "noon" : `${h % 12 || 12}${first ? (h < 12 ? " am" : " pm") : ""}`;
    if (t > lo.getTime() && t < hi.getTime()) html += `<div class="tick" style="left:${pct(d)}"></div>`;
    if (t < hi.getTime()) axis += `<span class="${first ? "first" : ""}" style="left:${pct(d)}">${label}</span>`;
  }
  for (const b of blocks) {
    const px = (b.end - b.start) / span * strip.clientWidth;
    const text = px > 90 ? esc(labelOf(b.id)) : "";
    html += `<div class="blk" data-sid="${esc(b.sid)}" title="${esc(labelOf(b.id))}, ${clock(b.start)} – ${clock(b.end)}" style="left:${pct(b.start)};width:${w(b.start, b.end)};background:${esc(colorOf(b.id))}">${text}</div>`;
  }
  if (now >= lo && now <= hi) html += `<div class="nowmark" style="left:${pct(now)}"></div>`;

  strip.innerHTML = html;
  document.getElementById("axis").innerHTML = axis;
}

// ---------------------------------------------------------------- rendering: sessions view

function sessEditing() {
  return !!(sessEdit || sessConfirm || clearMode || sessMove || linksMode);
}

function dayLabel(d, now) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - today) / 86400000);
  if (diff === 0) return "Today";
  if (diff === -1) return "Yesterday";
  const opts = {weekday: "long", month: "short", day: "numeric"};
  if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("en-US", opts);
}

function taskOptions(selected) {
  let html = "";
  if (selected && !projectMap()[selected]) html += `<option value="${esc(selected)}" selected>${esc(selected)} (not in setup)</option>`;
  for (const g of S.config.groups) {
    const items = S.config.projects.filter(p => p.group === g.id && (!p.completed || p.id === selected));
    if (!items.length) continue;
    html += `<optgroup label="${esc(g.label)}">`;
    for (const p of items) html += `<option value="${esc(p.id)}"${p.id === selected ? " selected" : ""}>${esc(p.label)}</option>`;
    html += `</optgroup>`;
  }
  return html;
}

function editorHtml(kind, s) {
  const hasEnd = kind !== "running";
  const k = esc(kind);
  return `<form class="editor" data-kind="${k}">
    <select id="ed-project-${k}" name="project" aria-label="Task">${taskOptions(s.project)}</select>
    <input id="ed-start-${k}" type="datetime-local" name="start" step="60" value="${esc(s.start)}" aria-label="Start">
    ${hasEnd ? `<span class="lbl">to</span><input id="ed-end-${k}" type="datetime-local" name="end" step="60" value="${esc(s.end)}" aria-label="End">` : `<span class="lbl">still running</span>`}
    ${hasEnd ? `<input id="ed-note-${k}" name="note" maxlength="500" placeholder="Note: what was this for?" value="${esc(s.note || "")}">` : ""}
    <button type="submit" class="pill strong">Save</button>
    <button type="button" class="pill" data-act="cancel">Cancel</button>
  </form>`;
}

function rowHtml(s) {
  const start = parseTs(s.start), end = parseTs(s.end);
  if (sessEdit === s.id) {
    return editorHtml(s.id, {project: s.project, start: toInput(start), end: toInput(end), note: s.note});
  }
  const crosses = dayKey(start) !== dayKey(end);
  const tags = (s.source === "manual" ? `<span class="tag">added</span>` : "") + (s.edited ? `<span class="tag">edited</span>` : "");
  const btns = sessConfirm === s.id
    ? `<span class="q">Delete?</span><button class="pill danger" data-act="del-yes" data-sid="${esc(s.id)}">Delete</button><button class="pill" data-act="cancel">Cancel</button>`
    : `<button class="pill" data-act="edit" data-sid="${esc(s.id)}">Edit</button><button class="pill" data-act="move" data-sid="${esc(s.id)}">Move</button><button class="pill" data-act="del" data-sid="${esc(s.id)}">Delete</button>`;
  return `<div class="row">
    <span class="sw" style="background:${esc(colorOf(s.project))}"></span>
    <span class="r-task">${esc(labelOf(s.project))}<span class="r-grp">${esc(groupLabel(s.project))}</span>${tags}</span>
    <span class="r-note">${esc(s.note || "")}</span>
    <span class="r-time">${clock(start)} – ${clock(end)}${crosses ? " +1d" : ""}</span>
    <span class="r-dur">${hm((end - start) / 1000)}</span>
    <span class="r-btns">${btns}</span>
  </div>${sessMove === s.id ? moverHtml(s.id, s.project, `${clock(start)} – ${clock(end)}`) : ""}`;
}

// Task keys for moving a session to another task.
function moverHtml(sid, current, when) {
  let keys = "";
  for (const g of S.config.groups) {
    const items = S.config.active.filter(p => p.group === g.id || p.id === current);
    if (!items.length) continue;
    keys += `<div class="mv-group"><span class="lbl">${esc(g.label)}</span>`;
    for (const p of items) {
      const here = p.id === current;
      keys += `<button class="mv-key${here ? " here" : ""}" data-act="move-to" data-sid="${esc(sid)}" data-task="${esc(p.id)}"${here ? " disabled" : ""}
        style="--c:${esc(p.color || "#8E8E93")}"><span class="sw"></span>${esc(p.label)}${here ? " (now)" : ""}</button>`;
    }
    keys += `</div>`;
  }
  return `<div class="mover">
    <div class="mv-head"><span>Move ${esc(when)} from <b>${esc(labelOf(current))}</b> to:</span>
      <button class="pill" data-act="cancel">Cancel</button></div>
    ${keys}
  </div>`;
}

function runningRowHtml(run) {
  if (run.paused) {
    return `<div class="row">
      <span class="sw" style="background:${esc(colorOf(run.id))}"></span>
      <span class="r-task">${esc(labelOf(run.id))}<span class="r-grp">${esc(groupLabel(run.id))}</span><span class="tag">paused</span></span>
      <span class="r-note">Earlier stretches are saved below</span>
      <span class="r-time">${run.pausedAt ? "paused at " + clock(run.pausedAt) : "paused"}</span>
      <span class="r-dur">${hm(run.elapsed)}</span>
      <span class="r-btns"><button class="pill" data-act="resume">Resume</button><button class="pill" data-act="stop">Stop</button></span>
    </div>`;
  }
  if (sessEdit === "running") return editorHtml("running", {project: run.id, start: toInput(run.start)});
  const btns = sessConfirm === "running"
    ? `<span class="q">Discard without saving?</span><button class="pill danger" data-act="discard-yes">Discard</button><button class="pill" data-act="cancel">Cancel</button>`
    : `<button class="pill" data-act="edit" data-sid="running">Edit</button><button class="pill" data-act="move" data-sid="running">Move</button><button class="pill" data-act="del" data-sid="running">Discard</button>`;
  return `<div class="row">
    <span class="sw" style="background:${esc(colorOf(run.id))}"></span>
    <span class="r-task">${esc(labelOf(run.id))}<span class="r-grp">${esc(groupLabel(run.id))}</span><span class="tag">running</span></span>
    <span class="r-note"></span>
    <span class="r-time">since ${clock(run.start)}</span>
    <span class="r-dur">${hm(run.elapsed)}</span>
    <span class="r-btns">${btns}</span>
  </div>${sessMove === "running" ? moverHtml("running", run.id, `the running timer (since ${clock(run.start)})`) : ""}`;
}

function linksHtml() {
  const row = (color, label, sub, hash) => `<div class="link-row">
      <span class="sw" style="background:${esc(color)}"></span>
      <span class="r-task">${esc(label)}<span class="r-grp">${esc(sub)}</span></span>
      <span class="link-url" id="link-${esc(hash)}">${esc(PAGE_URL + "#" + hash)}</span>
      <button class="pill" data-act="copy" data-hash="${esc(hash)}">Copy</button>
    </div>`;
  let rows = row("#8E8E93", "Stop timer", "stops whatever is running", "stop");
  for (const g of S.config.groups) {
    for (const p of S.config.active.filter(p => p.group === g.id)) {
      rows += row(p.color || "#8E8E93", p.label, g.label, "start-" + p.id);
    }
  }
  return `<div class="clear-panel">
    <p>In the Stream Deck app, drag a <b>Website</b> action onto a key and paste one of these
    links as its URL. Each link starts one task by its ID, so renaming or adding tasks
    doesn't change which key does what. Pressing a task's key while it's already running
    does nothing; use the Stop key to stop. The page shows a banner naming the task each time.</p>
    <div class="links">${rows}</div>
  </div>`;
}

function clearHtml() {
  const opt = (scope, text) => clearArmed === scope
    ? `<button class="pill danger" data-act="clear-yes" data-scope="${scope}">Tap again to clear ${text}</button>`
    : `<button class="pill" data-act="clear-arm" data-scope="${scope}">Clear ${text}</button>`;
  return `<div class="clear-panel">
    <p>Removes finished sessions. A running timer isn't touched. Every removed session
    is copied into the change log first, so the record of what was cleared stays.</p>
    <div class="opts">${opt("today", "today")}${opt("week", "this week")}${opt("all", "everything")}
      <button class="pill" data-act="cancel">Cancel</button></div>
  </div>`;
}

function renderSessions(now, run) {
  const top = document.getElementById("top");
  top.style.gridTemplateColumns = "minmax(0, 11rem) minmax(0, 1fr)";

  let body = "";
  if (linksMode) {
    body = linksHtml();
  } else if (clearMode) {
    body = clearHtml();
  } else {
    if (sessEdit === "new") {
      const end = new Date(Math.floor(now / 300000) * 300000);
      const start = new Date(end - 3600000);
      const first = S.config.active[0];
      body += editorHtml("new", {project: first ? first.id : "", start: toInput(start), end: toInput(end), note: ""});
    }
    if (run) body += runningRowHtml(run);
    const list = S.sessions;
    let day = null;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const key = dayKey(parseTs(s.start));
      if (key !== day) {
        day = key;
        let total = 0;
        for (let j = i; j < list.length && dayKey(parseTs(list[j].start)) === key; j++) {
          total += (parseTs(list[j].end) - parseTs(list[j].start)) / 1000;
        }
        body += `<div class="day-h"><span>${esc(dayLabel(parseTs(s.start), now))}</span><span>${hm(total)}</span></div>`;
      }
      body += rowHtml(s);
    }
    if (!list.length && !run && sessEdit !== "new") {
      body += `<div class="empty">${weeksLoaded ? "No sessions yet. Start a task, or use + Add session for time you didn't track." : "Loading sessions…"}</div>`;
    }
  }

  top.innerHTML = `<section id="now"></section>
    <section class="sess">
      <div class="sess-head">
        <div class="grp-name">Sessions</div>
        <button class="pill" data-act="add">+ Add session</button>
        ${downloads ? `<button class="pill" data-act="export">Export CSV</button>` : ""}
        <button class="pill" data-act="clear">Clear…</button>
        <button class="pill strong" data-act="done">Done</button>
      </div>
      <div class="sess-err">${esc(sessError)}</div>
      <div class="sess-list">${body}</div>
    </section>`;
  renderNow(now, run);

  const open = top.querySelector(".editor, .mover");
  if (open) open.scrollIntoView({block: "nearest"});
}

// ---------------------------------------------------------------- rendering: tasks list

function taskHours(id) {
  let secs = 0;
  for (const s of S.sessions) if (s.project === id) secs += (parseTs(s.end) - parseTs(s.start)) / 1000;
  return secs;
}

function renderTaskList(now, run) {
  const top = document.getElementById("top");
  top.style.gridTemplateColumns = "minmax(0, 11rem) minmax(0, 1fr)";
  let body = "";
  for (const g of S.config.groups) {
    const items = S.config.active.filter(p => p.group === g.id);
    if (!items.length) continue;
    body += `<div class="day-h"><span>${esc(g.label)}</span><span>${items.length} open</span></div>`;
    for (const p of items) {
      const k = esc(p.id);
      const done = completing === p.id
        ? `<span class="q">Completed on</span><input type="date" id="done-${k}" value="${esc(todayKey())}" aria-label="Completion date">
           <button class="pill strong" data-act="complete-yes" data-task="${k}">Complete</button><button class="pill" data-act="complete-no">Cancel</button>`
        : `<button class="pill" data-act="complete" data-task="${k}">Complete</button>`;
      body += `<div class="row task-row">
        <span class="sw" style="background:${esc(p.color || "#8E8E93")}"></span>
        <span class="r-task">${esc(p.label)}</span>
        <span class="r-note">${hm(taskHours(p.id))} logged</span>
        <label class="r-due"><span class="lbl">Due</span><input type="date" id="due-${k}" data-due="${k}" value="${esc(p.due)}" aria-label="Due date for ${esc(p.label)}"></label>
        <span class="r-btns">${done}</span>
      </div>`;
    }
  }
  if (!S.config.active.length) body += `<div class="empty">No open tasks. Add one with + Add task on the main screen.</div>`;
  const finished = S.config.projects.filter(p => p.completed).sort((a, b) => (a.completed < b.completed ? 1 : -1));
  if (finished.length) {
    body += `<div class="day-h"><span>Completed</span><span>${finished.length}</span></div>`;
    for (const p of finished) {
      body += `<div class="row task-row done">
        <span class="sw" style="background:${esc(p.color || "#8E8E93")}"></span>
        <span class="r-task">${esc(p.label)}<span class="r-grp">${esc(groupLabel(p.id))}</span></span>
        <span class="r-note">${hm(taskHours(p.id))} logged</span>
        <span class="r-due">completed ${esc(shortDate(p.completed))}${p.due ? ` · was due ${esc(shortDate(p.due))}` : ""}</span>
        <span class="r-btns"><button class="pill" data-act="reopen" data-task="${esc(p.id)}">Reopen</button></span>
      </div>`;
    }
  }
  top.innerHTML = `<section id="now"></section>
    <section class="sess">
      <div class="sess-head">
        <div class="grp-name">Tasks</div>
        <button class="pill strong" data-act="tasks-done">Done</button>
      </div>
      <div class="sess-err">${esc(sessError)}</div>
      <div class="sess-list">${body}</div>
    </section>`;
  renderNow(now, run);
}

function redrawTaskList() {
  const now = new Date();
  S = buildState(now);
  renderTaskList(now, runningInfo(now));
  renderStrip(now, runningInfo(now));
}

function render() {
  const now = new Date();
  S = buildState(now);
  const run = runningInfo(now);
  if (view === "sessions") {
    if (sessEditing()) renderNow(now, run);   // don't wipe a form mid-edit
    else renderSessions(now, run);
  } else if (view === "tasklist") {
    renderNow(now, run);                       // its date fields redraw only after a save
  } else if (adding) {
    renderNow(now, run);
  } else {
    renderGroups(now, run);
  }
  renderStrip(now, run);
  document.getElementById("warn").textContent = [storeError, view === "tasks" ? actionError : ""].filter(Boolean).join(" · ");
}

// Redraws the sessions view even while a form is open; use it when the user
// changes what's open. Background updates go through render(), which leaves forms alone.
function redrawSessions() {
  const now = new Date();
  S = buildState(now);
  renderSessions(now, runningInfo(now));
  renderStrip(now, runningInfo(now));
}

function showSessError(msg) {
  sessError = msg;
  const el = document.querySelector(".sess-err");
  if (el) el.textContent = msg;
}

// ---------------------------------------------------------------- writes

class UserError extends Error {}

function describe(e) {
  if (e instanceof UserError) return e.message;
  if (e && e.code === "quota_exceeded") return "Storage is full. Ask Claude to archive older weeks.";
  if (e && (e.code === "revoked" || e.code === "not_granted")) return "This page can't save right now. Reload it.";
  if (e && e.code === "invalid_argument") return "Only the owner of this page can change it.";
  return "Couldn't save. Check your connection and try again.";
}

// One write at a time, in order.
function enqueue(fn) {
  const p = writeChain.then(fn);
  writeChain = p.catch(() => {});
  return p;
}

async function act(fn) {
  if (!db) {
    const msg = "Open this page on claude.ai while signed in to save.";
    if (view !== "tasks") showSessError(msg); else { actionError = msg; render(); }
    return false;
  }
  try {
    await enqueue(fn);
    actionError = "";
    sessError = "";
    return true;
  } catch (e) {
    const msg = describe(e);
    if (view !== "tasks") showSessError(msg); else { actionError = msg; render(); }
    return false;
  }
}

async function mutateWeek(key, fn) {
  const ref = db.doc("weeks/" + key);
  const snap = await ref.get();
  const list = snap.exists ? (snap.data().sessions || []).map(s => ({...s})) : [];
  const next = fn(list);
  if (next === null) return;
  if (next.length) await ref.set({week: key, sessions: next});
  else await ref.delete();
  // Show the saved state right away; the live update that follows matches it.
  if (next.length) weeks = {...weeks, [key]: next};
  else { const {[key]: _, ...rest} = weeks; weeks = rest; }
}

async function logChange(record) {
  const now = new Date();
  const key = weekKey(now);
  const ref = db.doc("changes/" + key);
  const snap = await ref.get();
  const entries = snap.exists ? [...(snap.data().entries || [])] : [];
  entries.push({at: fmt(now), ...record});
  await ref.set({week: key, entries});
}

// Saves the current stretch as a session. Returns its length in seconds.
async function saveStretch(r, now) {
  const start = parseTs(r.start);
  if (r.paused || !start || now <= start) return 0;
  const s = {id: newId(), project: r.project, start: r.start, end: fmt(now)};
  await mutateWeek(weekKey(start), list => [...list, s]);
  return (now - start) / 1000;
}

async function closeTimer(r, now) {
  await saveStretch(r, now);
  await db.doc("timer/running").delete();
}

function startTask(project) {
  return act(async () => {
    const now = new Date();
    const snap = await db.doc("timer/running").get();
    if (snap.exists && snap.data().project === project) {
      if (snap.data().paused) await resumeFrom(snap.data(), now);
      return;
    }
    if (snap.exists) await closeTimer(snap.data(), now);
    await db.doc("timer/running").set({project, start: fmt(now)});
  });
}

async function resumeFrom(r, now) {
  const next = {project: r.project, start: fmt(now)};
  if (r.carried) next.carried = r.carried;
  await db.doc("timer/running").set(next);
}

function pauseTimer() {
  return act(async () => {
    const now = new Date();
    const snap = await db.doc("timer/running").get();
    if (!snap.exists || snap.data().paused) return;
    const r = snap.data();
    const secs = await saveStretch(r, now);
    await db.doc("timer/running").set({
      project: r.project, paused: true, paused_at: fmt(now),
      carried: Math.round((typeof r.carried === "number" ? r.carried : 0) + secs),
    });
  });
}

function resumeTimer() {
  return act(async () => {
    const snap = await db.doc("timer/running").get();
    if (snap.exists && snap.data().paused) await resumeFrom(snap.data(), new Date());
  });
}

function stopTimer() {
  return act(async () => {
    const snap = await db.doc("timer/running").get();
    if (snap.exists) await closeTimer(snap.data(), new Date());
  });
}

function slugify(label) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "task";
}

// A colour no task (open or completed) has used: the group's preset family
// first, then generated hues spaced by the golden angle, bright enough for
// dark labels.
function hslHex(h, s, l) {
  s /= 100; l /= 100;
  const f = n => {
    const k = (n + h / 30) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return ("#" + f(0) + f(8) + f(4)).toUpperCase();
}

function hueOf(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return null;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function pickColor(tasks, groupIndex) {
  const used = new Set(tasks.map(t => String(t.color || "").toUpperCase()));
  const palette = PALETTES[Math.min(Math.max(groupIndex, 0), PALETTES.length - 1)];
  const preset = palette.find(c => !used.has(c.toUpperCase()))
    || PALETTES.flat().find(c => !used.has(c.toUpperCase()));
  if (preset) return preset;
  const hues = [...used].map(c => /^#[0-9A-F]{6}$/.test(c) ? hueOf(c) : null).filter(h => h !== null);
  let best = null, bestGap = -1;
  for (let i = 0; i < 360; i++) {
    const h = (i * 137.508) % 360;
    const gap = hues.length ? Math.min(...hues.map(u => Math.min(Math.abs(u - h), 360 - Math.abs(u - h)))) : 360;
    const candidate = hslHex(h, 80, 62 + (i % 3) * 6);
    if (used.has(candidate)) continue;
    if (gap > bestGap) { best = candidate; bestGap = gap; }
    if (gap >= 14) break;
  }
  return best || hslHex(Math.random() * 360, 80, 65);
}

function addTask(groupId, label, due) {
  return act(async () => {
    label = label.split(/\s+/).filter(Boolean).join(" ");
    if (!label) throw new UserError("Task name is empty");
    const ref = db.doc("setup/config");
    const snap = await ref.get();
    if (!snap.exists) throw new UserError("Setup is missing. Ask Claude to set up your groups.");
    const cfg = JSON.parse(JSON.stringify(snap.data()));
    const groups = cfg.groups || [];
    const index = groups.findIndex(g => g.id === groupId);
    if (index < 0) throw new UserError("That group no longer exists");
    const tasks = cfg.tasks || (cfg.tasks = []);
    const taken = new Set(tasks.map(t => t.id));
    const base = slugify(label);
    let id = base, n = 2;
    while (taken.has(id)) id = `${base}-${n++}`;
    const task = {id, label, color: pickColor(tasks, index), group: groupId};
    if (/^\d{4}-\d{2}-\d{2}$/.test(due || "")) task.due = due;
    tasks.push(task);
    await ref.set(cfg);
    config = cfg;
  });
}

// Changes one task's due or completed date. null removes the field.
function updateTask(id, patch) {
  return act(async () => {
    const ref = db.doc("setup/config");
    const snap = await ref.get();
    if (!snap.exists) throw new UserError("Setup is missing");
    const cfg = JSON.parse(JSON.stringify(snap.data()));
    const task = (cfg.tasks || []).find(t => t.id === id);
    if (!task) throw new UserError("That task no longer exists");
    const before = {...task};
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") delete task[k]; else task[k] = v;
    }
    if (JSON.stringify(before) === JSON.stringify(task)) return;
    await ref.set(cfg);
    config = cfg;
    await logChange({action: "task", task: id, before, after: {...task}});
  });
}

function keepSeconds(value, original) {
  // Time fields only go to the minute; an unchanged minute keeps the stored seconds.
  const d = parseTs(value);
  const o = parseTs(original);
  if (d && o && Math.floor(d / 60000) === Math.floor(o / 60000)) return original;
  return d ? fmt(d) : null;
}

function checkTimes(start, end, now) {
  if (!start) throw new UserError("Start time is missing or invalid");
  if (!end) throw new UserError("End time is missing or invalid");
  if (parseTs(end) <= parseTs(start)) throw new UserError("End must be after start");
  if (parseTs(end) > new Date(now.getTime() + 60000)) throw new UserError("End can't be in the future");
}

function checkProject(project, allowed) {
  if (!projectMap()[project] && project !== allowed) throw new UserError("Pick a task");
}

function cleanNote(note) {
  note = String(note || "").split(/\s+/).filter(Boolean).join(" ");
  if (note.length > 500) throw new UserError("Note is too long (500 characters max)");
  return note;
}

function addSession(f) {
  return act(async () => {
    const now = new Date();
    checkProject(f.project);
    const start = keepSeconds(f.start, null), end = keepSeconds(f.end, null);
    checkTimes(start, end, now);
    const s = {id: newId(), project: f.project, start, end, source: "manual"};
    const note = cleanNote(f.note);
    if (note) s.note = note;
    await mutateWeek(weekKey(parseTs(start)), list => [...list, s]);
    await logChange({action: "add", after: s});
  });
}

function findSession(id) {
  return S.sessions.find(s => s.id === id) || null;
}

function updateSession(id, f) {
  return act(async () => {
    const now = new Date();
    const known = findSession(id);
    if (!known) throw new UserError("That session no longer exists");
    const oldKey = known.week;
    let before = null, after = null;
    await mutateWeek(oldKey, list => {
      const i = list.findIndex(s => s.id === id);
      if (i < 0) throw new UserError("That session was changed elsewhere. Close this and try again.");
      before = list[i];
      checkProject(f.project, before.project);
      const start = keepSeconds(f.start, before.start), end = keepSeconds(f.end, before.end);
      checkTimes(start, end, now);
      after = {...before, project: f.project, start, end};
      const note = cleanNote(f.note);
      if (note) after.note = note; else delete after.note;
      delete after.edited;
      const same = after.project === before.project && after.start === before.start
        && after.end === before.end && (after.note || "") === (before.note || "");
      if (same) { after = null; return null; }
      after.edited = fmt(now);
      if (weekKey(parseTs(start)) === oldKey) { list[i] = after; return list; }
      list.splice(i, 1);
      return list;
    });
    if (!after) return;
    const newKey = weekKey(parseTs(after.start));
    if (newKey !== oldKey) await mutateWeek(newKey, list => [...list, after]);
    await logChange({action: "edit", before, after});
  });
}

function reassignSession(id, project) {
  return act(async () => {
    const known = findSession(id);
    if (!known) throw new UserError("That session no longer exists");
    checkProject(project);
    let before = null, after = null;
    await mutateWeek(known.week, list => {
      const i = list.findIndex(s => s.id === id);
      if (i < 0) throw new UserError("That session was changed elsewhere. Close this and try again.");
      before = list[i];
      if (before.project === project) return null;
      after = {...before, project, edited: fmt(new Date())};
      list[i] = after;
      return list;
    });
    if (after) await logChange({action: "reassign", before, after});
  });
}

function reassignRunning(project) {
  return act(async () => {
    checkProject(project);
    const snap = await db.doc("timer/running").get();
    if (!snap.exists) throw new UserError("Nothing is running");
    const before = snap.data();
    if (before.project === project) return;
    const after = {...before, project};
    await db.doc("timer/running").set(after);
    await logChange({action: "reassign-running", before, after});
  });
}

function deleteSession(id) {
  return act(async () => {
    const known = findSession(id);
    if (!known) return;
    let removed = null;
    await mutateWeek(known.week, list => {
      const i = list.findIndex(s => s.id === id);
      if (i < 0) return null;
      removed = list[i];
      list.splice(i, 1);
      return list;
    });
    if (removed) await logChange({action: "delete", before: removed});
  });
}

function clearSessions(scope) {
  return act(async () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const cutoff = scope === "today" ? today : scope === "week" ? mondayOf(now) : null;
    const removed = [];
    for (const key of Object.keys(weeks)) {
      await mutateWeek(key, list => {
        const kept = list.filter(s => {
          const gone = cutoff === null || parseTs(s.start) >= cutoff;
          if (gone) removed.push(s);
          return !gone;
        });
        return kept.length === list.length ? null : kept;
      });
    }
    if (!removed.length) return;
    // Removed sessions go into their own change-log documents, 400 at a time.
    const stamp = fmt(now).replace(/[:]/g, "");
    const parts = [];
    for (let i = 0; i < removed.length; i += 400) {
      const id = `${weekKey(now)}-clear-${stamp}-${i / 400}`;
      await db.doc("changes/" + id).set({week: weekKey(now), cleared: removed.slice(i, i + 400)});
      parts.push(id);
    }
    await logChange({action: "clear", scope, count: removed.length, removed_in: parts});
  });
}

function updateRunning(f) {
  return act(async () => {
    const snap = await db.doc("timer/running").get();
    if (!snap.exists) throw new UserError("Nothing is running");
    const before = snap.data();
    if (before.paused) throw new UserError("Resume the timer to change its start time");
    checkProject(f.project, before.project);
    const start = keepSeconds(f.start, before.start);
    if (!start) throw new UserError("Start time is missing or invalid");
    if (parseTs(start) > new Date()) throw new UserError("Start can't be in the future");
    const after = {...before, project: f.project, start};
    if (after.project === before.project && after.start === before.start) return;
    await db.doc("timer/running").set(after);
    await logChange({action: "edit-running", before, after});
  });
}

function discardRunning() {
  return act(async () => {
    const snap = await db.doc("timer/running").get();
    if (!snap.exists) return;
    await db.doc("timer/running").delete();
    await logChange({action: "discard-running", before: snap.data()});
  });
}

function csvCell(v) {
  const s = String(v == null ? "" : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function exportCsv() {
  const rows = [["date", "group", "task", "task_id", "start", "end", "hours", "source", "note", "edited"]];
  for (const s of [...S.sessions].reverse()) {
    const a = parseTs(s.start), b = parseTs(s.end);
    rows.push([dayKey(a), groupLabel(s.project) || "Other", labelOf(s.project), s.project, s.start, s.end,
      ((b - a) / 3600000).toFixed(2), s.source || "timer", s.note || "", s.edited || ""]);
  }
  const data = rows.map(r => r.map(csvCell).join(",")).join("\n") + "\n";
  try {
    await downloads.save({filename: `timecard-${dayKey(new Date())}.csv`, data});
  } catch (e) {
    if (e && e.code !== "declined") showSessError("Export didn't start. Try again.");
  }
}

// ---------------------------------------------------------------- banner, copy, Stream Deck commands

function toast(text, color, isError) {
  const el = document.getElementById("toast");
  el.innerHTML = `<span class="sw" style="background:${esc(color || "#8E8E93")}"></span><span>${esc(text)}</span>`;
  el.className = isError ? "show err" : "show";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ""; }, 8000);
}

function copyLink(btn) {
  const hash = btn.dataset.hash;
  const text = PAGE_URL + "#" + hash;
  const done = () => { btn.textContent = "Copied"; setTimeout(() => { btn.textContent = "Copy"; }, 1500); };
  const fallback = () => {
    const el = document.getElementById("link-" + hash);
    if (!el) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    btn.textContent = "Press ⌘C";
  };
  try {
    navigator.clipboard.writeText(text).then(done, fallback);
  } catch (e) {
    fallback();
  }
}

function parseCmd(hash) {
  const h = String(hash || "").replace(/^#/, "");
  return /^(start-[a-z0-9-]+|stop)$/.test(h) ? h : null;
}

// A command from the page's link runs once per tab: reloading the tab, or the
// browser restoring it later, won't start or stop anything again.
function commandFromLoad() {
  const cmd = parseCmd(location.hash);
  if (!cmd) return null;
  try {
    if (sessionStorage.getItem("timecard-cmd") === cmd) return null;
    sessionStorage.setItem("timecard-cmd", cmd);
  } catch (e) { /* storage blocked: run it anyway */ }
  return cmd;
}

function runPendingCommand() {
  if (!pendingCmd || !db || !configLoaded || !runningLoaded) return;
  const cmd = pendingCmd;
  pendingCmd = null;
  S = buildState(new Date());
  if (cmd === "stop") {
    if (!running) { toast("Stream Deck: nothing was running"); return; }
    const id = running.project;
    stopTimer().then(ok => ok && toast(`Stream Deck: stopped ${labelOf(id)}`, colorOf(id)));
    return;
  }
  const id = cmd.slice("start-".length);
  const p = projectMap()[id];
  if (!p) { toast(`Stream Deck key points to a task that doesn't exist ("${id}"). Nothing changed.`, null, true); return; }
  const where = groupLabel(id);
  if (p.completed) { toast(`Stream Deck: ${p.label} is marked complete. Reopen it under Tasks to track it again.`, p.color, true); return; }
  if (running && running.project === id && !running.paused) { toast(`Stream Deck: ${p.label} is already running`, p.color); return; }
  startTask(id).then(ok => ok && toast(`Stream Deck: started ${p.label}${where ? " · " + where : ""}`, p.color));
}

window.addEventListener("hashchange", () => {
  pendingCmd = parseCmd(location.hash);
  runPendingCommand();
});

// ---------------------------------------------------------------- events

function openSessions(editId) {
  view = "sessions";
  adding = null;
  sessEdit = editId || null;
  sessConfirm = sessMove = null;
  clearMode = linksMode = false;
  clearArmed = null;
  sessError = "";
  redrawSessions();
}

function closeEditors() {
  sessEdit = sessConfirm = clearArmed = sessMove = null;
  clearMode = linksMode = false;
  sessError = "";
}

document.addEventListener("click", e => {
  const blk = e.target.closest(".blk[data-sid]");
  if (blk) { openSessions(blk.dataset.sid); return; }

  const btn = e.target.closest("[data-act]");
  if (btn) {
    const a = btn.dataset.act, sid = btn.dataset.sid;
    if (a === "pause") { pauseTimer().then(ok => ok && view === "sessions" && redrawSessions()); return; }
    if (a === "resume") { resumeTimer().then(ok => ok && view === "sessions" && redrawSessions()); return; }
    if (a === "stop") { stopTimer().then(ok => ok && view === "sessions" && redrawSessions()); return; }
    if (a === "sessions") { openSessions(); return; }
    if (a === "tasklist") { view = "tasklist"; adding = null; completing = null; sessError = ""; redrawTaskList(); return; }
    if (view === "tasklist") {
      const id = btn.dataset.task;
      if (a === "tasks-done") { view = "tasks"; completing = null; render(); }
      else if (a === "complete") { completing = id; redrawTaskList(); }
      else if (a === "complete-no") { completing = null; redrawTaskList(); }
      else if (a === "complete-yes") {
        const date = (document.getElementById("done-" + id) || {}).value || todayKey();
        updateTask(id, {completed: date}).then(ok => {
          if (!ok) return;
          completing = null;
          redrawTaskList();
          toast(`Completed ${labelOf(id)}`, colorOf(id));
        });
      }
      else if (a === "reopen") updateTask(id, {completed: null}).then(ok => ok && redrawTaskList());
      return;
    }
    if (view === "sessions") {
      sessError = "";
      const after = () => { closeEditors(); redrawSessions(); };
      if (a === "done") { view = "tasks"; closeEditors(); render(); }
      else if (a === "add") { closeEditors(); sessEdit = "new"; redrawSessions(); }
      else if (a === "edit") { closeEditors(); sessEdit = sid; redrawSessions(); }
      else if (a === "del") { closeEditors(); sessConfirm = sid; redrawSessions(); }
      else if (a === "cancel") { closeEditors(); redrawSessions(); }
      else if (a === "del-yes") deleteSession(sid).then(ok => ok && after());
      else if (a === "discard-yes") discardRunning().then(ok => ok && after());
      else if (a === "clear") { closeEditors(); clearMode = true; redrawSessions(); }
      else if (a === "clear-arm") { clearArmed = btn.dataset.scope; redrawSessions(); }
      else if (a === "clear-yes") clearSessions(btn.dataset.scope).then(ok => ok && after());
      else if (a === "export") exportCsv();
      else if (a === "move") { closeEditors(); sessMove = sid; redrawSessions(); }
      else if (a === "move-to") {
        const task = btn.dataset.task;
        (sid === "running" ? reassignRunning(task) : reassignSession(sid, task)).then(ok => {
          if (!ok) return;
          after();
          toast(`Moved to ${labelOf(task)}`, colorOf(task));
        });
      }
      else if (a === "links") { closeEditors(); linksMode = true; redrawSessions(); }
      else if (a === "copy") copyLink(btn);
      return;
    }
  }

  const task = e.target.closest("[data-task]");
  if (task) {
    const id = task.dataset.task;
    // Tapping the running task pauses it; tapping it again resumes.
    if (running && running.project === id) (running.paused ? resumeTimer() : pauseTimer());
    else startTask(id);
    return;
  }
  const add = e.target.closest("[data-add]");
  if (add) {
    adding = add.dataset.add;
    addDraft = "";
    const now = new Date();
    renderGroups(now, runningInfo(now));
    return;
  }
  if (adding && !e.target.closest(".add-form")) {
    adding = null;
    render();
  }
});

document.addEventListener("change", e => {
  const due = e.target.closest("input[data-due]");
  if (!due) return;
  updateTask(due.dataset.due, {due: due.value || null}).then(ok => { if (ok) redrawTaskList(); });
});

document.addEventListener("input", e => {
  if (e.target.closest(".add-form") && e.target.name === "label") addDraft = e.target.value;
});

document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (view === "sessions" && sessEditing()) { closeEditors(); redrawSessions(); }
  else if (view === "tasklist" && completing) { completing = null; redrawTaskList(); }
  else if (adding) { adding = null; render(); }
});

document.addEventListener("submit", async e => {
  e.preventDefault();
  const editor = e.target.closest(".editor");
  if (editor) {
    const kind = editor.dataset.kind;
    const v = name => (editor.querySelector(`[name=${name}]`) || {}).value || "";
    const f = {project: v("project"), start: v("start"), end: v("end"), note: v("note")};
    const ok = kind === "new" ? await addSession(f)
      : kind === "running" ? await updateRunning(f)
      : await updateSession(kind, f);
    if (ok) { closeEditors(); redrawSessions(); }
    return;
  }
  const form = e.target.closest(".add-form");
  if (!form) return;
  const label = form.querySelector("[name=label]").value.trim();
  const due = form.querySelector("[name=due]").value || "";
  if (!label) return;
  const group = form.dataset.group;
  adding = null;
  render();
  if (!(await addTask(group, label, due))) {
    adding = group;
    addDraft = label;
    const now = new Date();
    renderGroups(now, runningInfo(now));
  }
});

window.addEventListener("resize", render);

// ---------------------------------------------------------------- start

render();
setInterval(render, 20000);   // keeps the minutes and the now marker current

pendingCmd = commandFromLoad();

(async () => {
  const cl = window.claude;
  db = cl && cl.use ? await cl.use("db") : null;
  downloads = cl && cl.use ? await cl.use("downloads") : null;
  if (!db) {
    storeError = "Your records load when this page is opened on claude.ai while signed in.";
    if (pendingCmd) toast("Stream Deck: sign in to claude.ai in this browser to start or stop the timer.", null, true);
    configLoaded = weeksLoaded = true;
    render();
    return;
  }
  const fail = err => {
    storeError = err && err.code === "revoked" ? "Access to your records ended. Reload the page." : "Lost the connection to your records. Reload the page.";
    render();
  };
  db.doc("setup/config").onSnapshot(snap => {
    config = snap.exists ? snap.data() : null;
    configLoaded = true;
    render();
    runPendingCommand();
  }, fail);
  db.doc("timer/running").onSnapshot(snap => {
    running = snap.exists ? snap.data() : null;
    runningLoaded = true;
    render();
    runPendingCommand();
  }, fail);
  db.collection("weeks").onSnapshot(q => {
    const next = {};
    for (const d of q.docs) next[d.id] = (d.data() || {}).sessions || [];
    weeks = next;
    weeksLoaded = true;
    render();
  }, fail);
})();
