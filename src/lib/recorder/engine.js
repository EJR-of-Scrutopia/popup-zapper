// The run, as a state machine kept in shared storage. Pure: every page reads
// the state, asks whose turn it is, and the one page whose turn it is writes
// the next state before it acts (a click navigates and a close ends the page,
// so anything written after might never be).
//
// Live:  { mode: "idle"|"recording"|"running"|"paused", draft?, run?, closing: [tokens], note }
// Run:   { origin, homeTab, home, phase: "row"|"steps"|"turning"|"unwind", at, row, listUrl, page,
//          tabs: { recordedTab: liveToken }, opened: [tokens], visits: { recordedTab: visit },
//          since, turnFrom }
// Me:    { token, visit, origin, href, startedAt, now, holdUntil }

export const LIST_WAIT_MS = 15000;
export const PAGE_WAIT_MS = 20000;
export const FRESH_SLACK_MS = 1000;

const no = { mine: false, bind: false, skip: false };

export function startRun(rec, me, now) {
  return {
    origin: rec.origin,
    homeTab: rec.homeTab,
    home: me.token,
    phase: "row",
    at: 0,
    row: null,
    listUrl: me.href,
    page: 1,
    tabs: { [rec.homeTab]: me.token },
    opened: [],
    visits: {},
    since: now,
    turnFrom: null,
  };
}

export function currentTask(run, rec) {
  if (run.phase === "row") return { type: "pick-row" };
  if (run.phase === "turning") return run.turnFrom ? { type: "await-page" } : { type: "turn-page" };
  if (run.phase === "steps") {
    const step = rec.steps[run.at];
    if (step) return { type: "step", step, index: run.at };
  }
  return { type: "unwind" };
}

// Whose turn it is. The list belongs to the home tab. A step belongs to the
// live tab bound to its recorded tab; a step recorded after a page load is
// never done by the visit that did that tab's step before. A new tab's first
// step goes to a fresh page on its origin whose token is not bound yet. A
// wait, close or Back for a tab that never opened is passed over by home.
export function whoActs(run, rec, me, task) {
  if (me.holdUntil && me.holdUntil > me.now) return no;
  const home = me.token === run.home;
  if (task.type !== "step") return home ? { mine: true, bind: false, skip: false } : no;
  const step = task.step;
  const bound = run.tabs[step.tab];
  if (bound) {
    if (bound !== me.token) return no;
    if (step.afterLoad && run.visits[step.tab] === me.visit) return no;
    if ((step.kind === "click" || step.kind === "check") && step.origin && step.origin !== me.origin) return no;
    return { mine: true, bind: false, skip: false };
  }
  if (step.kind === "click" || step.kind === "check") {
    const taken = Object.keys(run.tabs).some((tab) => run.tabs[tab] === me.token);
    if (!taken && me.origin === step.origin && me.startedAt >= run.since - FRESH_SLACK_MS) {
      return { mine: true, bind: true, skip: false };
    }
    return no;
  }
  return home ? { mine: true, bind: false, skip: true } : no;
}

export function rowPicked(run, row, now) {
  return Object.assign({}, run, { phase: "steps", at: 0, row: { id: row.id, title: row.title }, since: now });
}

export function bindTab(run, recTab, token) {
  const opened = token !== run.home && run.opened.indexOf(token) < 0 ? run.opened.concat([token]) : run.opened;
  return Object.assign({}, run, { tabs: Object.assign({}, run.tabs, { [recTab]: token }), opened });
}

// Only clicks and Back change a tab's page, so only they note the visit.
export function advance(run, rec, me, now) {
  const step = rec.steps[run.at];
  const next = Object.assign({}, run, { at: run.at + 1, since: now });
  if (step && (step.kind === "click" || step.kind === "back")) {
    next.visits = Object.assign({}, run.visits, { [step.tab]: me.visit });
  }
  if (step && step.kind === "close") {
    const token = run.tabs[step.tab];
    next.tabs = Object.assign({}, run.tabs);
    delete next.tabs[step.tab];
    next.opened = run.opened.filter((each) => each !== token);
  }
  return { run: next, finished: next.at >= rec.steps.length };
}

export function rowEnded(run, now) {
  return {
    closing: run.opened.slice(),
    run: Object.assign({}, run, {
      phase: "unwind", at: 0, row: null, tabs: { [run.homeTab]: run.home }, opened: [], visits: {}, since: now,
    }),
  };
}

export function listArrived(run, now) {
  return Object.assign({}, run, { phase: "row", since: now, turnFrom: null });
}

export function startTurning(run, now) {
  return Object.assign({}, run, { phase: "turning", turnFrom: null, since: now });
}

export function turnStarted(run, me, signature, now) {
  return Object.assign({}, run, { phase: "turning", turnFrom: { visit: me.visit, signature, url: me.href }, since: now });
}

export function pageTurned(run, href, now) {
  return Object.assign({}, run, { phase: "row", page: run.page + 1, listUrl: href, turnFrom: null, since: now });
}

export function resumed(run, now) {
  return Object.assign({}, run, { since: now });
}

export function timedOut(run, rec, now, task) {
  let limit = Infinity;
  if (task.type === "step") limit = (rec.timeout || 30) * 1000;
  else if (task.type === "pick-row") limit = LIST_WAIT_MS;
  else if (task.type === "await-page") limit = PAGE_WAIT_MS;
  return now - run.since > limit;
}

// A step nobody finished (its tab never opened, or was closed by hand) is
// ended by the home tab 5 s after the page doing it would have given up.
export function overdue(run, rec, now, task) {
  if (task.type !== "step") return false;
  const extra = task.step.kind === "wait" ? Number(task.step.seconds) || 0 : 0;
  return now - run.since > (extra + (rec.timeout || 30) + 5) * 1000;
}

export function failNote(task, rec) {
  const target = task.step && task.step.target;
  if (!target) return `step ${task.index + 1}: ${task.step.kind} did not finish in ${rec.timeout || 30} s`;
  return `step ${task.index + 1}: "${target.text || target.words || target.tag}" not found in ${rec.timeout || 30} s`;
}

// Whether a page takes part, at load: it keeps its own tab token (unless the
// token was copied from the tab that opened it), takes one its tab let go of
// on another site, or joins as a new tab when it opened during a run's step
// or soon after a recorded step.
export function tokenPlan(live, { token, cloned, adopted, historyLength, startedAt, now }) {
  if (token && !cloned) return "keep";
  if (adopted) return "adopt";
  if (live.mode === "running" && live.run) {
    if (historyLength === 1 || startedAt >= live.run.since - FRESH_SLACK_MS) return "new";
    return "none";
  }
  if (live.mode === "recording" && live.draft) {
    if (historyLength === 1 || now - (live.draft.lastAt || 0) < 15000) return "new";
    return "none";
  }
  return "none";
}

function listKey(href) {
  const url = new URL(String(href));
  return url.origin + url.pathname.replace(/\/+$/, "") + url.search;
}

export function sameList(a, b) {
  try { return listKey(a) === listKey(b); } catch { return false; }
}

export function stopRun(live, note) {
  const closing = (live.closing || []).slice();
  for (const token of (live.run && live.run.opened) || []) if (closing.indexOf(token) < 0) closing.push(token);
  return { mode: "idle", closing, note: note || "" };
}
