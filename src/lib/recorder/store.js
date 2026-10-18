// What the recorder keeps, in the userscript manager's storage: shared by
// every tab and every site, which the list and its viewer (two origins) need.
// Values are JSON strings; a missing or broken one reads as its default.

const LIVE = "pz-rec live";
const LEAVING = "pz-rec leaving";
const BEAT = "pz-rec beat";
const RECORDING = "pz-rec recording ";
const LEDGER = "pz-rec ledger ";

const owns = (object, key) => !!object && Object.prototype.hasOwnProperty.call(object, key);

function parse(raw) {
  if (typeof raw !== "string" || !raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asLive(value) {
  if (!isObject(value) || typeof value.mode !== "string") return { mode: "idle", closing: [], note: "" };
  return Object.assign({}, value, {
    closing: Array.isArray(value.closing) ? value.closing : [],
    note: typeof value.note === "string" ? value.note : "",
  });
}

function asLedger(value) {
  return isObject(value) && isObject(value.rows) ? value : { rows: {} };
}

export function createRecorderStore(gm) {
  const read = async (key) => parse(await gm.get(key, null));
  const write = (key, value) => gm.set(key, value === null ? "" : JSON.stringify(value));
  return {
    readLive: async () => asLive(await read(LIVE)),
    // Null when the manager cannot read at once.
    readLiveNow() {
      const raw = gm.getNow(LIVE);
      return raw === undefined ? null : asLive(parse(raw));
    },
    writeLive: (live) => write(LIVE, live),
    writeLiveNow: (live) => gm.setNow(LIVE, JSON.stringify(live)),
    readLeaving: async () => {
      const value = await read(LEAVING);
      return isObject(value) && typeof value.token === "string" ? value : null;
    },
    writeLeavingNow: (leaving) => gm.setNow(LEAVING, JSON.stringify(leaving)),
    readBeat: async () => {
      const value = await read(BEAT);
      return isObject(value) && typeof value.token === "string" && Number.isFinite(value.at) ? value : null;
    },
    writeBeatNow: (beat) => gm.setNow(BEAT, JSON.stringify(beat)),
    readRecording: async (origin) => {
      const value = await read(RECORDING + origin);
      return isObject(value) && Array.isArray(value.steps) ? value : null;
    },
    writeRecording: (origin, rec) => write(RECORDING + origin, rec),
    readLedger: async (origin) => asLedger(await read(LEDGER + origin)),
    writeLedger: (origin, ledger) => write(LEDGER + origin, ledger),
  };
}

export function markRow(ledger, id, { status, title, note = "", at, page }) {
  const rows = Object.assign({}, ledger.rows, { [id]: { status, title: String(title || "").slice(0, 200), note, at, page } });
  return Object.assign({}, ledger, { rows });
}

export function ledgerTally(ledger) {
  const tally = { done: 0, skipped: 0, failed: 0 };
  for (const id of Object.keys(ledger.rows)) {
    const status = ledger.rows[id].status;
    if (owns(tally, status)) tally[status] += 1;
  }
  return tally;
}

export function forgetFailed(ledger) {
  const rows = {};
  for (const id of Object.keys(ledger.rows)) if (ledger.rows[id].status !== "failed") rows[id] = ledger.rows[id];
  return Object.assign({}, ledger, { rows });
}

// Back one: the most recent item marked done or skipped is forgotten, so the
// next Play does it again. Failed items need no help: Play retries them.
export function undoLast(ledger) {
  let last = null;
  for (const id of Object.keys(ledger.rows)) {
    const held = ledger.rows[id];
    if (held.status !== "done" && held.status !== "skipped") continue;
    if (!last || String(held.at || "") >= String(ledger.rows[last].at || "")) last = id;
  }
  if (!last) return { ledger, row: null };
  const rows = Object.assign({}, ledger.rows);
  const held = rows[last];
  delete rows[last];
  return { ledger: Object.assign({}, ledger, { rows }), row: { id: last, title: held.title, status: held.status } };
}

export function ledgerLines(ledger) {
  return Object.keys(ledger.rows).filter((id) => ledger.rows[id].status !== "done").map((id) => {
    const held = ledger.rows[id];
    return (held.status + "        ").slice(0, 8) + " " + String(held.title || id).slice(0, 80) + (held.note ? ": " + held.note : "");
  });
}
