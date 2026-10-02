// Browser tests for the Timecard page, run against an in-memory stand-in for
// its database and a controllable clock (tests/mockdb.js).
//
//   python3 records/build.py
//   NODE_PATH=$(npm root -g) node records/tests/run.js [screenshot-dir]
//
// Needs Playwright with Chromium (npm i -g playwright && npx playwright install chromium).

const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const shots = process.argv[2] || null;
const pageFile = path.join(os.tmpdir(), "timecard-test.html");
fs.writeFileSync(pageFile,
  "<!doctype html><html><head><meta charset=utf-8><meta name=viewport content=\"width=device-width,initial-scale=1\"></head><body><script>"
  + fs.readFileSync(path.join(__dirname, "mockdb.js"), "utf8") + "</script>"
  + fs.readFileSync(path.join(root, "timecard.html"), "utf8") + "</body></html>");

const failures = [];
let passed = 0;
function check(name, ok, detail) {
  if (ok) passed++;
  else failures.push(`${name}${detail === undefined ? "" : ": " + JSON.stringify(detail)}`);
}

const CONFIG = {
  groups: [{id: "rs", label: "Refined Science", target: 40, pace: false}, {id: "cu", label: "CU", target: 8, pace: false}],
  tasks: [
    {id: "mds", label: "MDS Audit", color: "#0A84FF", group: "rs"},
    {id: "meet", label: "Meetings", color: "#30D158", group: "rs"},
    {id: "des", label: "DES Registry", color: "#FF9F0A", group: "cu"},
  ],
  day_start: "08:30", day_hours: 8, workdays: [0, 1, 2, 3, 4],
};

// Local timestamp helpers, evaluated in Node with the same local zone as the page.
const pad = n => String(n).padStart(2, "0");
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const day = (offset, h = 0, m = 0, s = 0) => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate() + offset, h, m, s); };
const at = (offset, h, m, s = 0) => fmt(day(offset, h, m, s));
const monday = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return new Date(x.getFullYear(), x.getMonth(), x.getDate() - ((x.getDay() + 6) % 7)); };
const dayKeyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const weekKey = d => { const m = monday(d); return `${m.getFullYear()}-${pad(m.getMonth() + 1)}-${pad(m.getDate())}`; };

async function open(browser, {clock, docs = {}, width = 2560, height = 720} = {}) {
  const page = await browser.newPage({viewport: {width, height}});
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("file://" + pageFile);
  await page.evaluate(({target, docs}) => {
    if (target) window.__off = target - Date.now() + window.__off;
    for (const [k, v] of Object.entries(docs)) window.__store.set(k, v);
    window.__notify();
  }, {target: clock ? clock.getTime() : null, docs});
  await page.waitForTimeout(250);
  page.errors = errors;
  return page;
}

const advance = (page, minutes) => page.evaluate(m => { window.__off += m * 60000; window.__notify(); }, minutes).then(() => page.waitForTimeout(80));
const store = (page, prefix) => page.evaluate(p => Object.fromEntries([...window.__store.entries()].filter(([k]) => k.startsWith(p))), prefix);
const sessions = async page => Object.values(await store(page, "weeks/")).flatMap(w => w.sessions);
const changes = async page => Object.values(await store(page, "changes/")).flatMap(c => c.entries || []).map(e => e.action);
const settle = page => page.waitForTimeout(250);
const shot = async (page, name) => { if (shots) await page.screenshot({path: path.join(shots, name + ".png")}); };

(async () => {
  const browser = await chromium.launch();
  const thisWeek = weekKey(new Date());

  // 1. Start, pause, resume, stop, Resume from the panel, switch tasks.
  {
    const p = await open(browser, {clock: day(0, 9, 0), docs: {"setup/config": CONFIG}});
    await p.click('[data-task="mds"]'); await settle(p);
    await advance(p, 45); await p.click('[data-act=pause]'); await settle(p);
    await advance(p, 15); await p.click('[data-act=resume]'); await settle(p);
    await advance(p, 30); await p.click('#now [data-act=stop]'); await settle(p);
    let s = await sessions(p);
    check("pause/resume keeps one session", s.length === 1 && s[0].stretches.length === 2, s);
    await advance(p, 60); await p.click('#now [data-act=continue]'); await settle(p);
    await advance(p, 20); await p.click('[data-task="des"]'); await settle(p);
    await advance(p, 25); await p.click('#now [data-act=stop]'); await settle(p);
    s = await sessions(p);
    const mds = s.find(x => x.project === "mds"), des = s.find(x => x.project === "des");
    check("Resume adds a third stretch", mds && mds.stretches.length === 3, mds);
    check("switching starts a new session", des && !des.stretches, des);
    check("timer locks were used", (await p.evaluate(() => window.__leases)).some(l => l === "locks/timer"));
    check("no page errors (timer)", !p.errors.length, p.errors);
    await p.close();
  }

  // 2. A timer left running overnight: warning, Stop at, and a bad time.
  {
    const p = await open(browser, {clock: day(0, 1, 6), docs: {
      "setup/config": CONFIG, "timer/running": {project: "mds", start: at(-1, 16, 17, 55)}}});
    const warn = await p.textContent(".run-warn").catch(() => "");
    check("forgotten-timer warning", /yesterday/.test(warn) && /Still working/.test(warn), warn);
    await p.click('[data-act=stop-at]'); await settle(p);
    const suggested = await p.inputValue("#stop-at-time");
    const fits = await p.$eval("#now", el => el.scrollHeight <= el.clientHeight + 1);
    check("timer panel fits with the warning showing", fits);
    check("Stop at suggests end of that working day", suggested === at(-1, 16, 30).slice(0, 16), suggested);
    await shot(p, "stop-at");
    await p.fill("#stop-at-time", at(-1, 15, 0).slice(0, 16));
    await p.click(".stop-at button[type=submit]"); await settle(p);
    const err = await p.textContent(".stop-err").catch(() => "");
    check("Stop at refuses a time before the start", /after the timer started/.test(err), err);
    await p.fill("#stop-at-time", at(-1, 17, 5).slice(0, 16));
    await p.click(".stop-at button[type=submit]"); await settle(p);
    const s = await sessions(p);
    check("Stop at saves the session up to that time", s.length === 1 && s[0].start === at(-1, 16, 17, 55) && s[0].end === at(-1, 17, 5), s);
    check("Stop at clears the timer", !(await store(p, "timer/")).hasOwnProperty("timer/running"));
    check("Stop at is logged", (await changes(p)).includes("stop-at"));
    check("no page errors (stop at)", !p.errors.length, p.errors);
    await p.close();
  }

  // 3. Delete and discard, each undone.
  {
    const p = await open(browser, {clock: day(0, 12, 0), docs: {
      "setup/config": CONFIG,
      [`weeks/${thisWeek}`]: {week: thisWeek, sessions: [{id: "a1", project: "mds", start: at(0, 9, 0), end: at(0, 10, 0)}]},
      "timer/running": {project: "des", start: at(0, 11, 30)}}});
    await p.click("[data-act=sessions]");
    await p.click('[data-act=del][data-sid=a1]'); await p.click("[data-act=del-yes]"); await settle(p);
    check("delete removes the session", (await sessions(p)).length === 0);
    await p.click('#toast [data-act=toast-action]'); await settle(p);
    check("Undo restores the deleted session", (await sessions(p)).some(x => x.id === "a1"));
    await p.click('[data-act=del][data-sid=running]'); await p.click("[data-act=discard-yes]"); await settle(p);
    check("discard clears the timer", !(await store(p, "timer/")).hasOwnProperty("timer/running"));
    await p.click('#toast [data-act=toast-action]'); await settle(p);
    const t = (await store(p, "timer/"))["timer/running"];
    check("Undo restores the discarded timer", t && t.project === "des" && t.start === at(0, 11, 30), t);
    const log = await changes(p);
    check("undo actions are logged", log.includes("undo-delete") && log.includes("undo-discard"), log);
    await p.close();
  }

  // 4. Remove one stretch; keep an untouched zero-length placeholder.
  {
    const p = await open(browser, {clock: day(0, 18, 0), docs: {
      "setup/config": CONFIG,
      [`weeks/${thisWeek}`]: {week: thisWeek, sessions: [{id: "s1", project: "mds", start: at(0, 8, 30, 7), end: at(0, 10, 0, 9),
        stretches: [[at(0, 8, 30, 7), at(0, 9, 10, 3)], [at(0, 9, 10, 41), at(0, 9, 10, 41)], [at(0, 9, 20, 5), at(0, 10, 0, 9)]]}]}}});
    await p.click("[data-act=sessions]"); await p.click('[data-act=edit][data-sid=s1]');
    await p.fill(".editor [name=note]", "kept placeholder"); await p.click(".editor button[type=submit]"); await settle(p);
    let s = (await sessions(p))[0];
    check("placeholder stretch doesn't block a save", s.note === "kept placeholder" && s.stretches.length === 3, s);
    await p.click('[data-act=edit][data-sid=s1]');
    await p.click(".stretch:nth-child(1) [data-act=drop-stretch]"); await p.click(".editor button[type=submit]"); await settle(p);
    s = (await sessions(p))[0];
    check("removing a stretch keeps the others exactly", s.stretches.length === 2 && s.stretches[1][0] === at(0, 9, 20, 5), s);
    await p.close();
  }

  // 5. Weeks view: per-day split across midnight, previous week.
  {
    const lastMonday = new Date(monday(new Date()).getTime() - 7 * 86400000);
    const lastKey = weekKey(lastMonday);
    const lm = (d, h, m) => fmt(new Date(lastMonday.getFullYear(), lastMonday.getMonth(), lastMonday.getDate() + d, h, m));
    const p = await open(browser, {clock: day(0, 12, 0), docs: {
      "setup/config": CONFIG,
      [`weeks/${lastKey}`]: {week: lastKey, sessions: [
        {id: "w1", project: "mds", start: lm(0, 9, 0), end: lm(0, 12, 0)},
        {id: "w2", project: "des", start: lm(1, 23, 0), end: lm(2, 1, 0)}]}}});
    await p.click("[data-act=weeks]"); await settle(p);
    await p.click("[data-act=week-prev]"); await settle(p);
    const days = await p.$$eval(".wk-day b", els => els.map(e => e.textContent));
    check("week days split at midnight", days[0] === "3h 00m" && days[1] === "1h 00m" && days[2] === "1h 00m" && days[7] === "5h 00m", days);
    const head = await p.textContent(".sess-head .grp-name");
    check("week title names the previous week", /Week of/.test(head), head);
    await shot(p, "weeks");
    await p.click("[data-act=week-export]"); await settle(p);
    const saved = await p.evaluate(() => window.__saved.map(x => x.filename + "|" + x.data.trim().split("\n").pop()));
    check("week export has a total row", saved.length === 1 && /total,.*,5\.00,/.test(saved[0]), saved);
    check("no page errors (weeks)", !p.errors.length, p.errors);
    await p.close();
  }

  // 6. Tasks: rename, duplicate colour refused, move group, change goal; History shows them.
  {
    const p = await open(browser, {clock: day(0, 12, 0), docs: {"setup/config": CONFIG,
      [`weeks/${thisWeek}`]: {week: thisWeek, sessions: [{id: "a1", project: "mds", start: at(0, 9, 0), end: at(0, 10, 0)}]}}});
    await p.click("[data-act=tasklist]"); await settle(p);
    await p.fill("#label-mds", "MDS Audit 2026"); await p.dispatchEvent("#label-mds", "change"); await settle(p);
    await p.$eval("#color-meet", el => { el.value = "#0a84ff"; el.dispatchEvent(new Event("change", {bubbles: true})); }); await settle(p);
    const colourErr = await p.textContent(".sess-err");
    await p.selectOption("#group-meet", "cu"); await settle(p);
    await p.fill("#goal-rs", "38"); await p.dispatchEvent("#goal-rs", "change"); await settle(p);
    const cfg = (await store(p, "setup/"))["setup/config"];
    check("rename saves", cfg.tasks.find(t => t.id === "mds").label === "MDS Audit 2026", cfg.tasks);
    check("duplicate colour refused", /already uses that colour/.test(colourErr) && cfg.tasks.find(t => t.id === "meet").color === "#30D158", colourErr);
    check("task moves group", cfg.tasks.find(t => t.id === "meet").group === "cu");
    check("goal saves", cfg.groups.find(g => g.id === "rs").target === 38);
    await shot(p, "tasks");
    await p.click("[data-act=tasks-done]"); await p.click("[data-act=history]"); await settle(p);
    const titles = await p.$$eval(".hist-title", els => els.map(e => e.textContent));
    check("history lists task and goal changes", titles.some(t => /Changed task MDS Audit 2026/.test(t)) && titles.some(t => /Changed Refined Science/.test(t)), titles);
    await shot(p, "history");
    check("no page errors (tasks/history)", !p.errors.length, p.errors);
    await p.close();
  }

  // 7. Export ranges, full backup and its reminder.
  {
    const p = await open(browser, {clock: day(0, 12, 0), docs: {"setup/config": CONFIG,
      [`weeks/${thisWeek}`]: {week: thisWeek, sessions: [{id: "a1", project: "mds", start: at(0, 9, 0), end: at(0, 10, 30)}]},
      [`changes/${thisWeek}`]: {week: thisWeek, entries: [{at: at(0, 10, 31), action: "edit", before: {}, after: {}}]}}});
    const reminder = await p.textContent(".backup-due").catch(() => "");
    check("backup reminder shows when there's no backup", /No backup yet/.test(reminder), reminder);
    await p.click(".backup-due"); await settle(p);
    await p.click('[data-act=export-range][data-range="week"]'); await settle(p);
    await p.click("[data-act=backup]"); await settle(p);
    const saved = await p.evaluate(() => window.__saved.map(x => ({name: x.filename, data: x.data})));
    check("this-week CSV exported", saved[0] && /\.csv$/.test(saved[0].name) && /total,.*,1\.50,/.test(saved[0].data), saved[0] && saved[0].name);
    const backup = saved[1] && JSON.parse(saved[1].data);
    check("full backup includes sessions and change log", backup && backup.documents[`weeks/${thisWeek}`] && backup.documents[`changes/${thisWeek}`], saved[1] && saved[1].name);
    check("backup date recorded", !!((await store(p, "setup/"))["setup/meta"] || {}).last_backup);
    await p.click("[data-act=cancel]"); await p.click("[data-act=done]"); await settle(p);
    check("reminder clears after a backup", !(await p.$(".backup-due")));
    await p.close();
  }

  // 8. Phone width: no sideways scrolling on any screen.
  {
    const p = await open(browser, {clock: day(0, 12, 0), width: 400, height: 800, docs: {"setup/config": CONFIG,
      [`weeks/${thisWeek}`]: {week: thisWeek, sessions: [{id: "a1", project: "mds", start: at(0, 9, 0), end: at(0, 10, 30)}]}}});
    for (const v of ["sessions", "tasklist", "weeks", "history"]) {
      if (v !== "sessions") { await p.click(`[data-act=${v === "tasklist" ? "tasklist" : v}]`).catch(() => {}); }
      else await p.click("[data-act=sessions]");
      await settle(p);
      check(`no sideways scroll at phone width (${v})`, !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
      const back = await p.$("[data-act=done], [data-act=tasks-done], [data-act=to-tasks]");
      if (back) { await back.click(); await settle(p); }
    }
    await p.close();
  }

  // 9. Main screen with task keys: idle with today's work, then a running timer.
  {
    const cfg = {...CONFIG, tasks: [...CONFIG.tasks,
      {id: "rep", label: "Quarterly report", color: "#BF5AF2", group: "rs", due: dayKeyOf(day(3))},
      {id: "grant", label: "Grant renewal", color: "#FF375F", group: "cu", due: dayKeyOf(day(-1))}]};
    const p = await open(browser, {clock: day(0, 11, 0), docs: {"setup/config": cfg, "setup/meta": {last_backup: at(-1, 17, 0)},
      [`weeks/${thisWeek}`]: {week: thisWeek, sessions: [
        {id: "m1", project: "mds", start: at(0, 8, 40), end: at(0, 10, 5)},
        {id: "m2", project: "meet", start: at(0, 10, 10), end: at(0, 10, 45)}]}}});
    await shot(p, "main-idle");
    await p.click('[data-task="rep"]'); await settle(p);
    await advance(p, 52);
    const keys = await p.$$eval(".task-btn[data-task]", els => els.length);
    check("main screen shows every open task key", keys === 5, keys);
    const elapsed = await p.textContent("#now .elapsed");
    check("timer shows no seconds", /^\d+h\d\dm$/.test(elapsed.replace(/\s/g, "")), elapsed);
    await shot(p, "main-running");
    const fits = await p.$eval("#now", el => el.scrollHeight <= el.clientHeight + 1);
    check("timer column fits without scrolling at 2560x720", fits);
    check("no page errors (main)", !p.errors.length, p.errors);
    await p.close();
  }

  await browser.close();
  console.log(`${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("FAIL " + f);
  process.exit(failures.length ? 1 : 0);
})();
