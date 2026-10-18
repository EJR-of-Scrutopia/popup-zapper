// The steps of one item, as recorded and as edited. Pure: a draft or a
// recording goes in, a new one comes out.
//
// Step kinds:
//   click  { tab, origin, path, visit, target, scope: "row"|"page", afterLoad, opens }
//   back   { tab, origin, visit }
//   wait   { tab, seconds }
//   close  { tab }
//   check  { tab, origin, text, afterLoad }   skip the item if the page says text
// A tab is a token made at recording time; the run maps each to a live tab.

export const DEFAULT_LINGER = 5;
export const DEFAULT_TIMEOUT = 30;

export function newDraft({ origin, listUrl, homeTab, visit }) {
  return { origin, listUrl, homeTab, steps: [], firstRow: null, rowVisit: null, lastTab: homeTab, lastVisit: visit };
}

function lastInTab(steps, tab) {
  for (let at = steps.length - 1; at >= 0; at--) if (steps[at].tab === tab) return steps[at];
  return null;
}

// A click came after a page load when the same tab's step before it was on
// another visit, or was Back (whose visit is the page Back led to).
export function addClick(draft, { tab, origin, path, visit, target, scope, row }) {
  const before = lastInTab(draft.steps, tab);
  const afterLoad = !!before && (before.kind === "back" || before.visit !== visit);
  const step = { kind: "click", tab, origin, path, visit, target, scope: scope === "row" ? "row" : "page", afterLoad, opens: false };
  const next = Object.assign({}, draft, { steps: draft.steps.concat([step]), lastTab: tab, lastVisit: visit });
  if (!draft.steps.length && step.scope === "row" && row) {
    next.firstRow = { id: row.id, title: row.title };
    next.rowVisit = visit;
  }
  return next;
}

export function addBack(draft, { tab, origin, visit }) {
  if (!draft.steps.length) return draft;
  const step = { kind: "back", tab, origin, visit };
  return Object.assign({}, draft, { steps: draft.steps.concat([step]), lastTab: tab, lastVisit: visit });
}

// From what was done to what a run repeats: a click whose next step is in a
// tab not seen before opened that tab; a tab opened in the recording and
// never seen again was closed (or left behind), so the run waits and closes
// it, before the next step elsewhere or at the end.
export function finishRecording(draft, previous, { linger = DEFAULT_LINGER, now = Date.now() } = {}) {
  const steps = (draft && draft.steps) || [];
  if (!steps.length) return { recording: null, problem: "Nothing was recorded." };
  if (steps[0].kind !== "click" || steps[0].scope !== "row") {
    return { recording: null, problem: "Start with a click on an item in the list." };
  }
  const home = draft.homeTab;
  const out = [];
  const seen = new Set([home]);
  const opened = [];
  const closed = new Set();
  const closeGone = (from) => {
    const gone = opened.filter((tab) => !closed.has(tab) && !steps.slice(from).some((step) => step.tab === tab));
    gone.forEach((tab, at) => {
      if (at === 0) out.push({ kind: "wait", tab, seconds: linger });
      out.push({ kind: "close", tab });
      closed.add(tab);
    });
  };
  steps.forEach((original, at) => {
    if (at > 0 && original.tab !== steps[at - 1].tab) closeGone(at);
    const step = Object.assign({}, original);
    if (step.kind === "click") {
      const next = steps[at + 1];
      step.opens = !!next && !seen.has(next.tab) && !steps.slice(0, at + 1).some((each) => each.tab === next.tab);
    }
    if (!seen.has(step.tab)) { seen.add(step.tab); opened.push(step.tab); }
    out.push(step);
  });
  closeGone(steps.length);
  const kept = previous || {};
  return {
    problem: "",
    recording: {
      version: 1,
      id: draft.origin + " " + new Date(now).toISOString(),
      origin: draft.origin,
      listUrl: draft.listUrl,
      homeTab: home,
      steps: out,
      firstRow: draft.firstRow,
      createdAt: new Date(now).toISOString(),
      skipText: typeof kept.skipText === "string" ? kept.skipText : "",
      onlyText: typeof kept.onlyText === "string" ? kept.onlyText : "",
      highlight: typeof kept.highlight === "string" ? kept.highlight : "",
      pages: Number.isFinite(kept.pages) ? kept.pages : 0,
      timeout: Number.isFinite(kept.timeout) ? kept.timeout : DEFAULT_TIMEOUT,
    },
  };
}

function withSteps(rec, steps) {
  return Object.assign({}, rec, { steps });
}

// The item click is what the run repeats per item, so it stays.
export function removeStep(rec, index) {
  if (!rec || index <= 0 || index >= rec.steps.length) return rec;
  return withSteps(rec, rec.steps.filter((step, at) => at !== index));
}

export function insertWait(rec, after, seconds = 3) {
  if (!rec || after < 0 || after >= rec.steps.length) return rec;
  const steps = rec.steps.slice();
  steps.splice(after + 1, 0, { kind: "wait", tab: steps[after].tab, seconds });
  return withSteps(rec, steps);
}

export function setWait(rec, index, seconds) {
  const step = rec && rec.steps[index];
  const value = parseFloat(String(seconds));
  if (!step || step.kind !== "wait" || !Number.isFinite(value)) return rec;
  const steps = rec.steps.slice();
  steps[index] = Object.assign({}, step, { seconds: Math.min(600, Math.max(0, value)) });
  return withSteps(rec, steps);
}

// A check goes before the chosen step and reads that step's page. Never
// before the item click: the list's own filters do that.
export function insertCheck(rec, before, text) {
  const words = String(text == null ? "" : text).trim();
  const step = rec && rec.steps[before];
  if (!words || !step || before <= 0) return rec;
  const steps = rec.steps.slice();
  steps.splice(before, 0, { kind: "check", tab: step.tab, origin: step.origin || "", text: words, afterLoad: !!step.afterLoad });
  return withSteps(rec, steps);
}

function tabNumbers(steps) {
  const order = [];
  for (const step of steps) if (order.indexOf(step.tab) < 0) order.push(step.tab);
  return order;
}

function named(target) {
  const words = target ? target.text || target.words || "" : "";
  return words ? `"${words}"` : `the ${(target && target.tag) || "element"}`;
}

export function describeStep(step, index, steps) {
  const number = tabNumbers(steps).indexOf(step.tab) + 1;
  const lead = number > 1 ? `Tab ${number}: ` : "";
  if (step.kind === "click") {
    if (index === 0) return `Click ${named(step.target)} on each item`;
    return lead + `Click ${named(step.target)}` + (step.scope === "row" ? " in the item" : "") + (step.opens ? " (opens a tab)" : "");
  }
  if (step.kind === "back") return lead + "Go back";
  if (step.kind === "wait") return lead + `Wait ${step.seconds} s`;
  if (step.kind === "close") return lead + "Close the tab";
  if (step.kind === "check") return lead + `Skip the item if the page says "${step.text}"`;
  return lead + step.kind;
}
