// The two runs. Tick mode: tick a batch, press the page's download button,
// wait for evidence of the file, untick, next batch. Click mode: press every
// item's own button once (Add to zip and the like), page by page. Both drive
// the page only through deps.page and keep nothing of it, so tests drive them
// with stand-ins.

import { collapse } from "./rows.js";
import { chooseBatch, pageCounts, wholeNumber, owns, putRow } from "./ledger.js";
import { wantsFormat, describeFormats, andList, DEFAULT_ZIP_LIMIT } from "./settings.js";

export const DEFAULT_BATCH = 10;
export const DEFAULT_TIMEOUT = 90;
export const DEFAULT_SETTLE = 1;
export const DEFAULT_RETRY_BATCH = 3;

// Three unconfirmed batches in a row means the page hands files over in a way
// this cannot watch; carrying on would mark everything unconfirmed.
const MISSES_BEFORE_STOPPING = 3;
// A guard against a Load more that never ends.
const MAX_LOAD_MORE = 500;

export function playLabel(state) {
  return state === "running" ? "Pause" : "Play";
}

function quietly(work) {
  try { return work(); } catch { return undefined; }
}

function endOfPage(batches, counts, alone) {
  if (!counts.rows && !alone) return "No rows found.";
  return (batches ? `Done: ${batches} batch(es).` : "Nothing to do here.")
    + (counts.unconfirmed ? ` ${counts.unconfirmed} unconfirmed: Play retries them.` : " Next page, then Play.")
    + (alone ? ` ${alone} of other file types left.` : "");
}

// Rows of the file types switched off, not yet confirmed.
function leftAlone(scope, types, ledger) {
  const others = scope.filter((each) => !wantsFormat(types, each.identity.format)).map((each) => each.identity);
  const counts = pageCounts(others, ledger);
  return counts.todo + counts.unconfirmed;
}

// One Play takes rows the ledger has never seen (pressing Load more when they
// run out), then the unconfirmed ones once each at the retry size, so a run
// always ends. A row is written to the ledger only once its batch has an
// outcome, before it is unticked. Pause before the press puts the batch back.
// The list is saved on Stop and when a run that pressed something ends.
export function createRunner(deps) {
  let state = "idle";
  let stopAsked = false;
  let ended = Promise.resolve();

  const show = (next) => { state = next; quietly(() => deps.showState(next)); };
  const say = (text) => quietly(() => deps.say(text));
  const refresh = () => quietly(() => deps.refresh());
  const halted = () => stopAsked || state === "pausing";

  function formatsNow() {
    if (typeof deps.formats !== "function") return null;
    const types = quietly(() => deps.formats());
    return Array.isArray(types) ? types : null;
  }

  function saveList() {
    const documents = quietly(() => deps.siteDocuments()) || 0;
    if (!documents) return "Ledger empty, so no list to save.";
    const name = quietly(() => deps.saveExport());
    return name ? `Saved ${name}.` : "The list could not be saved.";
  }

  // Eligible rows in page order that the page lets be ticked, until full.
  function usableFirst(eligible, live, size) {
    if (typeof deps.page.usable !== "function") return eligible.slice(0, size);
    const byId = new Map(live.map((each) => [each.identity.id, each]));
    const out = [];
    for (let at = 0; at < eligible.length && out.length < size; at++) {
      const row = byId.get(eligible[at].id);
      const fit = row ? quietly(() => deps.page.usable(row)) : false;
      if (fit !== false) out.push(eligible[at]);
    }
    return out;
  }

  async function loop() {
    const retried = new Set();
    let allLoaded = false;
    let loadPresses = 0;
    let batches = 0;
    let misses = 0;
    let ending = "";
    let saveAtEnd = false;
    let lastEnd = null;
    let between = {};
    try {
      if (typeof deps.begin === "function") deps.begin();
      const store = deps.store();
      const settings = deps.settings();
      for (;;) {
        if (stopAsked) { ending = "Stopped."; saveAtEnd = true; break; }
        if (state === "pausing") { ending = "Paused. Play carries on."; break; }
        const types = formatsNow();
        if (Array.isArray(types) && !types.length) {
          ending = describeFormats(types);
          saveAtEnd = batches > 0;
          break;
        }
        // Rows read afresh for every batch, so rows that appear mid-run count.
        const start = wholeNumber(settings.startAt, 1);
        say("Reading rows…");
        const readStart = deps.now();
        const live = deps.page.rows();
        const readMs = deps.now() - readStart;
        const scope = start > 1 ? live.slice(start - 1) : live;
        const identities = scope.filter((each) => wantsFormat(types, each.identity.format)).map((each) => each.identity);
        const ledger = store.read();
        let mode = "fresh";
        let picked = usableFirst(chooseBatch(identities, ledger, identities.length, "fresh"), live, settings.size);
        if (!picked.length && !allLoaded && typeof deps.page.loadMore === "function") {
          const more = (await deps.page.loadMore(halted)) || {};
          loadPresses += more.pressed ? 1 : 0;
          if (more.pressed && more.grew && loadPresses < MAX_LOAD_MORE) {
            say(`Load more: +${more.after - more.before} rows.`);
          } else {
            allLoaded = true;
            if (more.pressed) say("Load more added nothing.");
          }
          continue;
        }
        if (!picked.length) {
          mode = "retry";
          const remaining = identities.filter((each) => !retried.has(each.id));
          picked = usableFirst(chooseBatch(remaining, ledger, remaining.length, "retry"), live, settings.retrySize);
        }
        if (!picked.length) {
          if (!live.length) {
            const why = typeof deps.page.explainNoRows === "function" ? quietly(() => deps.page.explainNoRows()) : "";
            ending = "No rows found." + (why ? " " + why : "");
          } else if (live.length < start) {
            ending = `No row ${start}: this page has ${live.length}. Lower "start at".`;
          } else {
            ending = endOfPage(batches, pageCounts(identities, ledger), leftAlone(scope, types, ledger));
          }
          saveAtEnd = batches > 0;
          break;
        }
        const wanted = new Set(picked.map((each) => each.id));
        const chosen = live.filter((each) => wanted.has(each.identity.id));
        const next = wholeNumber(ledger.nextBatch, 1);
        say(`Batch ${next}: ticking ${chosen.length}` + (mode === "retry" ? " (retry)" : "")
          + (Array.isArray(types) ? `, ${andList(types)} only` : "") + "…");
        const takeStart = deps.now();
        let taken = await deps.page.take(chosen, halted);
        const takeMs = deps.now() - takeStart;
        if (!taken.ok) {
          deps.page.untick(chosen);
          if (taken.halted) continue;
          ending = taken.problem;
          break;
        }
        // The page goes quiet before the press, and the selection is taken
        // again after, which clicks nothing when it held.
        let quietMs = null;
        let stillChanging = false;
        if (typeof deps.page.quiet === "function") {
          say(`Batch ${next}: letting the page settle…`);
          const calm = (await deps.page.quiet(halted)) || {};
          if (calm.halted) { deps.page.untick(chosen); continue; }
          quietMs = typeof calm.waitedMs === "number" ? calm.waitedMs : null;
          stillChanging = calm.quiet === false;
          taken = await deps.page.take(chosen, halted);
          if (!taken.ok) {
            deps.page.untick(chosen);
            if (taken.halted) continue;
            ending = taken.problem;
            break;
          }
        }
        const batch = store.nextBatch();
        const pressedAt = deps.now();
        const timing = Object.assign({
          after: lastEnd ? lastEnd.batch : null,
          handedOver: lastEnd ? lastEnd.confirmed : false,
          gapSeconds: lastEnd ? (pressedAt - lastEnd.at) / 1000 : null,
          settleMs: null, untickMs: null, refreshMs: null,
        }, between, { readMs, takeMs, quietMs, stillChanging });
        say(`Batch ${batch}: pressed.`);
        const outcome = await deps.page.press(taken.button, batch, settings.timeout, timing);
        lastEnd = { batch, at: deps.now(), confirmed: outcome.status === "confirmed" };
        between = {};
        const waited = Math.round((lastEnd.at - pressedAt) / 1000);
        store.record(chosen.map((each) => each.identity), batch, outcome.status, deps.iso(), {
          mode, waited, evidence: outcome.evidence, reason: outcome.reason, where: deps.where(),
        });
        batches += 1;
        if (mode === "retry") for (const each of chosen) retried.add(each.identity.id);
        if (outcome.status === "confirmed") {
          misses = 0;
          say(`Batch ${batch} ✓ ${waited}s`);
          const settleStart = deps.now();
          await deps.sleep(settings.settle);
          between.settleMs = deps.now() - settleStart;
        } else {
          misses += 1;
          say(`Batch ${batch} ✗ ` + (outcome.reason === "timeout"
            ? `no file in ${settings.timeout}s` : outcome.reason) + `: ${chosen.length} unconfirmed`);
        }
        const untickStart = deps.now();
        deps.page.untick(chosen);
        between.untickMs = deps.now() - untickStart;
        const refreshStart = deps.now();
        refresh();
        between.refreshMs = deps.now() - refreshStart;
        if (misses >= MISSES_BEFORE_STOPPING) {
          ending = `Stopped: ${MISSES_BEFORE_STOPPING} batches in a row showed no file. See Details.`;
          saveAtEnd = true;
          break;
        }
        // No pause after unticking: the selection check catches a site still
        // clearing the last batch.
      }
    } catch (error) {
      ending = "Stopped on a script fault: " + (error && error.message ? error.message : String(error)) + ".";
    }
    stopAsked = false;
    show("idle");
    quietly(() => { if (typeof deps.end === "function") deps.end(); });
    if (saveAtEnd) ending += " " + saveList();
    refresh();
    say(ending);
  }

  return {
    state: () => state,
    play() {
      if (state === "pausing") { show("running"); say("Carrying on."); return ended; }
      if (state !== "idle") return ended;
      stopAsked = false;
      show("running");
      ended = loop();
      return ended;
    },
    pause() {
      if (state !== "running") return ended;
      show("pausing");
      say("Pausing after this batch…");
      return ended;
    },
    // Stop ends the wait at once and records the batch in hand unconfirmed.
    stop() {
      if (state === "idle") { say(saveList()); return ended; }
      if (state === "stopping") return ended;
      stopAsked = true;
      show("stopping");
      say("Stopping…");
      quietly(() => deps.page.abortWait());
      return ended;
    },
    // Forgets every ledger kept on this site, after deps.confirm says yes.
    reset() {
      if (state !== "idle") { say("Stop the run before Reset."); return false; }
      const documents = quietly(() => deps.siteDocuments()) || 0;
      if (!documents) { say("The ledger is already empty."); return false; }
      const agreed = quietly(() => deps.confirm(`Forget all ${documents} document(s) in this site's ledger? `
        + "The next Play fetches every one again."));
      if (agreed !== true) { say("Reset cancelled."); return false; }
      const cleared = quietly(() => deps.forgetSite()) === true;
      refresh();
      say(cleared ? `Forgot ${documents} document(s).` : "Forgotten here, but storage refused; a reload may bring it back.");
      return cleared;
    },
  };
}

// ---- click mode ----

// A control is an add button by its own words (30 characters at most), and
// already done by "Remove from", "Added to", "In" the same, or a bare
// "Added"/"Selected". A button reading anything else is never pressed: a
// toggle pressed twice takes the item out again.
const PLACES = "(zip|basket|downloads?|download\\s+(list|basket|cart|folder)|selection|cart|list|project|folder"
  + "|collection|favou?rites|wish\\s*list|briefcase|library|pack|bundle|binder|board|documents?|bag)";
const ADD_TEXT = new RegExp("^(\\+\\s*)?((add|save)(\\s+(it|this|item|file|document))?\\s+to\\s+(your\\s+|the\\s+|my\\s+)?"
  + PLACES + "\\b|(select|add)\\s+for\\s+download\\b)", "i");
const IN_ZIP_TEXT = new RegExp("^(((remove|delete)\\s+from|(added|saved)\\s+to|in)\\s+(your\\s+|the\\s+|my\\s+)?"
  + PLACES + "\\b|added\\b|(saved|selected)!?$|✓)", "i");

export function isAddText(text) {
  const words = collapse(text);
  return words.length <= 30 && ADD_TEXT.test(words);
}

export function isInZipText(text) {
  const words = collapse(text);
  return words.length <= 30 && IN_ZIP_TEXT.test(words);
}

// The click ledger: every item handled on this site by its identity, with
// what became of it. ADDED: pressed, and the page showed it took (or it was
// already in). REFUSED: could not be clicked. SILENT: pressed, nothing on the
// page changed. Per origin and path, like the batch ledger.
const ZIP_PREFIX = "qs-intelligence zip ledger ";
const ZIP_STATUSES = ["added", "refused", "silent"];

export function zipLedgerKey(href) {
  const where = new URL(String(href));
  return ZIP_PREFIX + where.origin + where.pathname;
}

function readZipLedger(storage, key) {
  const ledger = { version: 1, key, cards: {} };
  let held = null;
  try {
    const raw = storage ? storage.getItem(key) : null;
    held = typeof raw === "string" && raw ? JSON.parse(raw) : null;
  } catch { held = null; }
  if (!held || typeof held !== "object" || Array.isArray(held) || !held.cards
    || typeof held.cards !== "object" || Array.isArray(held.cards)) {
    return ledger;
  }
  for (const id of Object.keys(held.cards)) {
    const card = held.cards[id];
    if (card && typeof card === "object" && ZIP_STATUSES.indexOf(card.status) >= 0) putRow(ledger.cards, id, card);
  }
  return ledger;
}

export function openZipStore(storage, key) {
  let memory = readZipLedger(storage, key);
  let saved = true;
  function read() {
    const stored = readZipLedger(storage, key);
    for (const id of Object.keys(stored.cards)) {
      if (!owns(memory.cards, id)) putRow(memory.cards, id, stored.cards[id]);
    }
    return memory;
  }
  return {
    key,
    read,
    record(card, status, why, at, where) {
      if (ZIP_STATUSES.indexOf(status) < 0) throw new Error(`an item is added, refused or silent, not "${status}"`);
      read();
      putRow(memory.cards, card.id, {
        title: String(card.title || "").slice(0, 240), status, why: String(why || ""), at, where: where || "",
      });
      try {
        if (!storage) throw new Error("no storage");
        storage.setItem(key, JSON.stringify(memory));
        saved = true;
      } catch { saved = false; }
      return memory;
    },
    saved: () => saved,
    forget() {
      memory = { version: 1, key, cards: {} };
      try { if (storage) storage.removeItem(key); return true; } catch { return false; }
    },
  };
}

// A guard against a list of pages that never ends.
const MAX_ZIP_PAGES = 500;

// `inZip`, where given, says an item is already done though the ledger never
// saw it.
export function zipCounts(cards, ledger, inZip) {
  const counts = { cards: cards.length, added: 0, refused: 0, silent: 0, todo: 0 };
  for (const card of cards) {
    const held = ledger && owns(ledger.cards, card.id) ? ledger.cards[card.id] : null;
    if (held) counts[held.status] += 1;
    else if (typeof inZip === "function" && inZip(card) === true) counts.added += 1;
    else counts.todo += 1;
  }
  return counts;
}

export function zipAddedCount(ledger) {
  return Object.keys(ledger.cards).filter((id) => ledger.cards[id].status === "added").length;
}

export function zipSummary(counts, added) {
  return `${counts.cards} items · ${counts.added} done · ${counts.todo} to do`
    + (counts.refused ? ` · ${counts.refused} not clickable` : "")
    + (counts.silent ? ` · ${counts.silent} no change` : "")
    + ` · ${added} on site`;
}

// deps.page: cards (id, title, words(), clickable()), press (resolves
// { added, why }), paint, next (resolves { pressed, changed, why }), and
// optionally state(card) -> "ready" | "in" | "other" (else read from words).
// An item held as added or silent is never pressed again (a second press of
// a toggle takes it out); a refused one is tried again each pass. The run
// turns pages itself to the last, and stops at deps.limit (the site's own
// count where it shows one, else items added since Play).
export function createClickRunner(deps) {
  let state = "idle";
  let sweeping = null;
  let again = false;
  let addedSincePlay = 0;
  let full = null;

  const say = (text) => quietly(() => deps.say(text));
  const show = (next) => { state = next; quietly(() => deps.showState(next)); };
  function record(card, status, why) {
    deps.store.record(card, status, why, deps.iso(), deps.where());
    quietly(() => deps.page.paint(card, status));
  }

  function stateOf(card) {
    if (typeof deps.page.state === "function") return quietly(() => deps.page.state(card)) || "other";
    const words = quietly(() => card.words()) || "";
    if (isInZipText(words)) return "in";
    return isAddText(words) ? "ready" : "other";
  }

  function limitNow() {
    if (typeof deps.limit !== "function") return Infinity;
    return wholeNumber(quietly(() => deps.limit()), DEFAULT_ZIP_LIMIT);
  }

  function fullNow() {
    const limit = limitNow();
    if (!Number.isFinite(limit)) return null;
    let holds = null;
    if (typeof deps.zipHolds === "function") {
      const said = quietly(() => deps.zipHolds());
      holds = typeof said === "number" && Number.isFinite(said) && said >= 0 ? said : null;
    }
    const count = holds !== null ? holds : addedSincePlay;
    return count >= limit ? { count, limit, site: holds !== null } : null;
  }

  async function sweepOnce() {
    const cards = deps.page.cards();
    let pressed = 0;
    for (let at = 0; at < cards.length; at++) {
      if (state !== "running") break;
      const card = cards[at];
      const ledger = deps.store.read();
      const held = owns(ledger.cards, card.id) ? ledger.cards[card.id] : null;
      if (held && held.status === "added") { quietly(() => deps.page.paint(card, "added")); continue; }
      const now = stateOf(card);
      if (now === "in") { record(card, "added", "already done"); continue; }
      if (now !== "ready") continue;
      if (held && held.status === "silent") { quietly(() => deps.page.paint(card, "silent")); continue; }
      if (quietly(() => card.clickable()) !== true) { record(card, "refused", "could not be clicked"); continue; }
      full = fullNow();
      if (full) break;
      say(`Clicking ${at + 1} of ${cards.length}: ${String(card.title || "").slice(0, 40)}`);
      const outcome = (await deps.page.press(card)) || {};
      record(card, outcome.added ? "added" : "silent", outcome.why || "");
      if (outcome.added) addedSincePlay += 1;
      pressed += 1;
      await deps.sleep(deps.gap);
    }
    return pressed;
  }

  // Marked busy BEFORE the first press: a page change that press causes would
  // otherwise start a second pass that presses the same item again.
  function sweep() {
    if (sweeping) { again = true; return sweeping; }
    let finished = null;
    sweeping = new Promise((resolve) => { finished = resolve; });
    const promise = sweeping;
    (async () => {
      try {
        quietly(() => deps.setAuto(true));
        let pressed = 0;
        let ending = "";
        let lastPage = false;
        let turned = 0;
        full = null;
        do {
          again = false;
          pressed += await sweepOnce();
          if (full && state === "running") {
            ending = `Limit reached (${full.count}). Download the zip, empty it if the site keeps it, `
              + "then Play to carry on.";
            break;
          }
          if (again || state !== "running" || typeof deps.page.next !== "function") continue;
          say("Page done; next page…");
          const moved = (await deps.page.next()) || {};
          if (state !== "running") break;
          if (moved.pressed && moved.changed) {
            turned += 1;
            if (turned >= MAX_ZIP_PAGES) ending = `Stopped after ${MAX_ZIP_PAGES} pages.`;
            else again = true;
            continue;
          }
          lastPage = true;
          ending = "Done: last page.";
        } while (again && state === "running");
        if (ending && state === "running") {
          show("idle");
          quietly(() => deps.setAuto(false));
          say(ending + (lastPage ? ` ${zipAddedCount(deps.store.read())} done on this site.` : ""));
        } else if (state === "running") {
          say((pressed ? "Page done." : "Nothing new here.") + " Open the next page to carry on, or Stop.");
        }
      } catch (error) {
        show("idle");
        quietly(() => deps.setAuto(false));
        say("Stopped on a script fault: " + (error && error.message ? error.message : String(error)) + ".");
      } finally {
        sweeping = null;
        quietly(() => deps.refresh());
        finished();
      }
    })();
    return promise;
  }

  return {
    state: () => state,
    play() {
      if (state === "running") return sweeping || Promise.resolve();
      addedSincePlay = 0;
      show("running");
      return sweep();
    },
    pageChanged() {
      if (state !== "running") return Promise.resolve();
      return sweep();
    },
    stop() {
      show("idle");
      quietly(() => deps.setAuto(false));
      say("Stopped.");
      return sweeping || Promise.resolve();
    },
    reset() {
      if (state !== "idle") { say("Stop before Reset."); return false; }
      const count = Object.keys(deps.store.read().cards).length;
      if (!count) { say("The click ledger is already empty."); return false; }
      const agreed = quietly(() => deps.confirm(`Forget all ${count} item(s) in this site's click ledger? `
        + "The next Play clicks them again. It does not empty anything on the site."));
      if (agreed !== true) { say("Reset cancelled."); return false; }
      const cleared = deps.store.forget();
      quietly(() => deps.refresh());
      say(cleared ? `Forgot ${count} item(s).` : "Forgotten here, but storage refused.");
      return cleared;
    },
  };
}

// The old name, for the Add to zip runner this grew from.
export const createZipRunner = createClickRunner;
