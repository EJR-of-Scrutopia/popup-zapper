// The ledger: every row a batch run has handled on a page, with its batch,
// time and whether its file was seen arriving. Kept in the site's own
// localStorage under the keys the standalone downloader used, so ledgers
// from it carry over.

export const LEDGER_PREFIX = "qs-intelligence document ledger ";
// At most this many batch records are kept; rows are kept for good.
const MAX_BATCH_RECORDS = 2000;

// One ledger per origin and path; the query and fragment (page of results,
// filters) are left out.
export function ledgerKey(href) {
  const where = new URL(String(href));
  return LEDGER_PREFIX + where.origin + where.pathname;
}

export function emptyLedger(key) {
  return { version: 1, key, nextBatch: 1, rows: {}, batches: [] };
}

export function owns(object, name) {
  return Object.prototype.hasOwnProperty.call(object, name);
}

// Written as an own property, so no row name can reach the prototype.
export function putRow(rows, id, row) {
  Object.defineProperty(rows, id, { value: row, enumerable: true, writable: true, configurable: true });
}

function isStatus(value) {
  return value === "confirmed" || value === "unconfirmed";
}

export function heldRow(ledger, id) {
  return ledger && ledger.rows && owns(ledger.rows, id) ? ledger.rows[id] : null;
}

export function wholeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 ? Math.floor(number) : fallback;
}

// Every touch of storage is wrapped: a private window or blocked site data
// throws, and the run carries on without it. A stored row that is neither
// confirmed nor unconfirmed reads as never handled.
export function readLedger(storage, key) {
  const ledger = emptyLedger(key);
  let raw = null;
  try { raw = storage ? storage.getItem(key) : null; } catch { raw = null; }
  if (typeof raw !== "string" || !raw) return ledger;
  let held = null;
  try { held = JSON.parse(raw); } catch { held = null; }
  if (!held || typeof held !== "object" || Array.isArray(held)
    || !held.rows || typeof held.rows !== "object" || Array.isArray(held.rows)) {
    return ledger;
  }
  for (const id of Object.keys(held.rows)) {
    const row = held.rows[id];
    if (row && typeof row === "object" && isStatus(row.status)) putRow(ledger.rows, id, row);
  }
  ledger.nextBatch = wholeNumber(held.nextBatch, 1);
  if (Array.isArray(held.batches)) {
    ledger.batches = held.batches.filter((record) => record !== null && typeof record === "object");
  }
  return ledger;
}

export function writeLedger(storage, key, ledger) {
  try {
    if (!storage) return false;
    storage.setItem(key, JSON.stringify(ledger));
    return true;
  } catch {
    return false;
  }
}

function betterRow(held, other) {
  if (!held) return other;
  if (!other) return held;
  const rank = (row) => (row.status === "confirmed" ? 1 : 0);
  if (rank(held) !== rank(other)) return rank(held) > rank(other) ? held : other;
  return String(other.at) > String(held.at) ? other : held;
}

export function mergeLedgers(one, two) {
  const merged = emptyLedger(one.key || two.key);
  merged.nextBatch = Math.max(wholeNumber(one.nextBatch, 1), wholeNumber(two.nextBatch, 1));
  for (const ledger of [one, two]) {
    for (const id of Object.keys(ledger.rows)) {
      putRow(merged.rows, id, betterRow(heldRow(merged, id), ledger.rows[id]));
    }
  }
  const records = new Map();
  for (const ledger of [one, two]) {
    for (const record of ledger.batches) {
      const name = record.batch + " " + record.at;
      const held = records.get(name);
      if (!held) records.set(name, record);
      else if (record.late && !held.late) records.set(name, Object.assign({}, held, { late: record.late }));
    }
  }
  merged.batches = Array.from(records.values()).sort((a, b) => {
    const first = String(a.at);
    const second = String(b.at);
    return (Number(a.batch) - Number(b.batch)) || (first < second ? -1 : first > second ? 1 : 0);
  });
  if (merged.batches.length > MAX_BATCH_RECORDS) merged.batches = merged.batches.slice(-MAX_BATCH_RECORDS);
  return merged;
}

// A row once confirmed stays confirmed: a document seen arriving has arrived.
export function recordBatch(ledger, identities, batch, status, at, details) {
  if (!isStatus(status)) throw new Error(`a batch is confirmed or unconfirmed, not "${status}"`);
  const extra = details || {};
  for (const each of identities) {
    const held = heldRow(ledger, each.id);
    if (held && held.status === "confirmed" && status !== "confirmed") continue;
    putRow(ledger.rows, each.id, {
      title: each.title,
      format: each.format,
      size: each.size,
      where: extra.where || "",
      batch,
      at,
      status,
      tries: (held ? wholeNumber(held.tries, 1) : 0) + 1,
    });
  }
  ledger.batches.push({
    batch,
    at,
    status,
    rows: identities.length,
    mode: extra.mode || "",
    waited: typeof extra.waited === "number" ? extra.waited : null,
    evidence: extra.evidence || "",
    reason: extra.reason || "",
  });
  if (ledger.batches.length > MAX_BATCH_RECORDS) {
    ledger.batches.splice(0, ledger.batches.length - MAX_BATCH_RECORDS);
  }
  if (wholeNumber(ledger.nextBatch, 1) <= batch) ledger.nextBatch = batch + 1;
  return ledger;
}

export function noteLate(ledger, batch, description, at) {
  let marked = false;
  for (const record of ledger.batches) {
    if (record.batch === batch && record.status === "unconfirmed" && !record.late) {
      record.late = { at, evidence: String(description || "") };
      marked = true;
    }
  }
  return marked;
}

// The ledger for one address, in memory and written after every change.
// Before each change it reads storage again and merges (confirmed wins), so
// two tabs on one site add to the ledger rather than overwrite it.
export function openStore(storage, key) {
  let memory = readLedger(storage, key);
  let saved = true;
  const fresh = () => { memory = mergeLedgers(readLedger(storage, key), memory); return memory; };
  const save = () => { saved = writeLedger(storage, key, memory); return saved; };
  return {
    key,
    read: fresh,
    nextBatch() {
      fresh();
      const batch = wholeNumber(memory.nextBatch, 1);
      memory.nextBatch = batch + 1;
      save();
      return batch;
    },
    record(identities, batch, status, at, details) {
      fresh();
      recordBatch(memory, identities, batch, status, at, details);
      save();
      return memory;
    },
    noteLate(batch, description, at) {
      fresh();
      const marked = noteLate(memory, batch, description, at);
      if (marked) save();
      return marked;
    },
    saved: () => saved,
    // Another tab still holding the ledger would write it back, so Reset is
    // for one tab at a time.
    forget() {
      memory = emptyLedger(key);
      saved = true;
      if (!storage) return true;
      try { storage.removeItem(key); return true; } catch { return false; }
    },
  };
}

export function chooseBatch(identities, ledger, size, mode) {
  if (mode !== "fresh" && mode !== "retry") throw new Error(`a run is "fresh" or "retry", not "${mode}"`);
  const asked = Math.floor(Number(size));
  const limit = Number.isFinite(asked) && asked >= 1 ? asked : 1;
  const out = [];
  for (let at = 0; at < identities.length && out.length < limit; at++) {
    const each = identities[at];
    const held = heldRow(ledger, each.id);
    // A confirmed row is never offered again, in either kind of run.
    if (held && held.status === "confirmed") continue;
    if (mode === "fresh" && held) continue;
    if (mode === "retry" && !held) continue;
    out.push(each);
  }
  return out;
}

export function pageCounts(identities, ledger) {
  const counts = { rows: identities.length, todo: 0, confirmed: 0, unconfirmed: 0 };
  for (const each of identities) {
    const held = heldRow(ledger, each.id);
    if (held && isStatus(held.status)) counts[held.status] += 1;
    else counts.todo += 1;
  }
  return counts;
}

export function ledgerCounts(ledger) {
  const counts = { confirmed: 0, unconfirmed: 0 };
  for (const id of Object.keys(ledger.rows)) {
    const status = ledger.rows[id] && ledger.rows[id].status;
    if (isStatus(status)) counts[status] += 1;
  }
  return counts;
}

export function listLedgerKeys(storage, prefix) {
  const keys = [];
  try {
    const count = storage ? storage.length : 0;
    for (let at = 0; at < count; at++) {
      const key = storage.key(at);
      if (typeof key === "string" && key.indexOf(prefix) === 0) keys.push(key);
    }
  } catch {
    return keys.sort();
  }
  return keys.sort();
}

// The list Stop saves: documents by name, unconfirmed first, then the
// ledgers themselves with every batch's evidence.
export function buildExport(ledgers, about) {
  const meta = about || {};
  const confirmed = [];
  const unconfirmed = [];
  for (const ledger of ledgers) {
    const address = String(ledger.key || "").slice(LEDGER_PREFIX.length);
    for (const id of Object.keys(ledger.rows)) {
      const row = ledger.rows[id];
      const line = {
        title: String(row.title || ""), format: row.format || "", size: row.size || "",
        status: row.status, batch: row.batch, at: row.at, tries: row.tries,
        where: row.where || "", address, id,
      };
      if (row.status === "confirmed") confirmed.push(line);
      if (row.status === "unconfirmed") unconfirmed.push(line);
    }
  }
  const byTitle = (a, b) => {
    if (a.title !== b.title) return a.title < b.title ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
  confirmed.sort(byTitle);
  unconfirmed.sort(byTitle);
  return {
    exported: meta.at || "",
    script: meta.script || "",
    origin: meta.origin || "",
    reading: "Every document row the batch clicker has handled on this site. "
      + "CONFIRMED means a file was seen handed over for its batch. "
      + "UNCONFIRMED means its batch was pressed and no file was seen within the time allowed: "
      + "fetch those again or look for them among the zips. \"where\" is the page of results it "
      + "was on, and batch numbers match the ledgers below. \"traces\" holds, for each batch "
      + "pressed since the page was opened, what the page and the browser did after the press, "
      + "in milliseconds from it.",
    totals: { confirmed: confirmed.length, unconfirmed: unconfirmed.length },
    unconfirmed,
    confirmed,
    traces: meta.traces || {},
    ledgers,
  };
}

// Every ledger kept on this site: from storage and from the stores this page
// holds (which still have them should storage have refused).
export function siteLedgers(storage, stores, prefix) {
  const keys = listLedgerKeys(storage, prefix);
  if (stores) stores.forEach((store, key) => { if (keys.indexOf(key) < 0) keys.push(key); });
  return keys.map((key) => (stores && stores.has(key) ? stores.get(key).read() : readLedger(storage, key)));
}

export function siteTotals(storage, stores, prefix) {
  const ledgers = siteLedgers(storage, stores, prefix);
  let documents = 0;
  for (const ledger of ledgers) {
    const counts = ledgerCounts(ledger);
    documents += counts.confirmed + counts.unconfirmed;
  }
  return { ledgers: ledgers.length, documents };
}

export function forgetSite(storage, stores, prefix) {
  let cleared = true;
  for (const key of listLedgerKeys(storage, prefix)) {
    try { storage.removeItem(key); } catch { cleared = false; }
  }
  if (stores) stores.forEach((store) => { if (!store.forget()) cleared = false; });
  return cleared;
}
