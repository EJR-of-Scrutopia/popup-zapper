# Step recorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A recorder in the Popup Zapper that learns one item's clicks across pages and tabs, then repeats them for every item in a list, page after page.

**Architecture:** Pure modules under `src/lib/recorder/` (targets, steps, engine, store, highlight, panel) wired by `tool.js`. All state sits in the userscript manager's shared storage, so tabs on different origins cooperate. Each page polls a run state machine and acts only when it is the right tab for the current step, writing the next step before it acts.

**Tech Stack:** Plain ES2020 modules bundled by esbuild into a userscript; Vitest with jsdom; playwright-core with Chromium for the end-to-end check.

**Spec:** `docs/superpowers/specs/2026-10-18-step-recorder-design.md`

## Global Constraints

- Code and comment style as `src/lib/batch/`: short functions, plain-words comments, every DOM read in try/catch where a page could throw, `isOurs` excludes `[data-pz]` UI.
- Panel words in plain British English, no em dashes. Number boxes use `numberStyle(width)` from `src/lib/batch/panel.js`.
- Shared storage keys, values JSON strings: `pz-rec live`, `pz-rec leaving`, `pz-rec recording <origin>`, `pz-rec ledger <origin>`, `pz-rec position`.
- Defaults: step timeout 30 s; wait before closing a run-opened tab 5 s; poll 300 ms; list must show items within 15 s; next page must arrive within 20 s; a leaving token is adoptable for 5 s.
- Header gains `@grant window.close` and `@grant window.focus`. Version 2.3.0.
- Commit after each task with a conventional message and no co-author line. Never push.

## Review Focus

1. **The click that navigates before the step is saved.** The recording writes each step with the synchronous `GM_setValue` when it exists, so a click on a link still lands in the draft. Test in Task 4 (`setNow` uses the sync form).
2. **Two pages acting on one step.** After a click, Back or navigate, the acting page holds off for 1.5 s, 5 s and 5 s, until a new visit. A page whose visit equals `run.lastVisit` never takes a step marked `afterLoad`. Tests in Task 3 (`whoActs` afterLoad and hold cases).
3. **A run-opened tab left open.** Every row end, failure and Stop puts the run's opened tokens into `live.closing`, and those tabs close themselves. Tests in Task 3 (`rowEnded`, `stopRun`).
4. **A step whose button never appears** (paid item, slow viewer). The item fails with a note naming the step and its words, and the run goes on to the next item. Test in Task 3 (`timedOut` plus `rowEnded` with failure).
5. **Items already done, or pressed by hand during recording.** These are never offered again. Tests in Task 2 (`wantedRows` with ledger) and Task 3 (`finishRecording` returns `firstRow`).

---

### Task 1: Share the next-page finder

**Files:**
- Create: `src/lib/batch/pager.js`
- Modify: `src/lib/batch/tool.js` (remove `NEXT_TEXT`, `NOT_NEXT`, `PAGE_NUMBER`, `hintsOf`, `markedCurrent`, and the body of `nextControls`)
- Test: `tests/pager.test.js`

**Interfaces:**
- Produces: `findNextControls(doc, lastNode, { isOurs, onScreen, win }) -> Array<{ control: Element, how: string }>`. It does the same as `nextControls()` in `tool.js` today, with `lastCard` passed in as `lastNode` (null means no "after" limit). It is exported from `src/lib/batch/index.js` too.

- [ ] **Step 1: Write the failing tests** in `tests/pager.test.js` with jsdom documents and `onScreen: () => true`:
  - `a[rel=next]` after the last item gives `[{ how: "the next page button" }]`.
  - A link reading "Next Page" (the CIBSE pager) is found.
  - "Previous Page" and "Last" are never returned.
  - A link before `lastNode` is ignored.
  - Numbers 1 2 3 with `aria-current="page"` on 3 give `[]` (last page).
  - With current 1 marked by class `active`, the result includes `{ how: "page 2" }`.
- [ ] **Step 2: Run** `npx vitest run tests/pager.test.js`. Expected: FAIL, module not found.
- [ ] **Step 3: Move the code.** `tool.js`'s `nextControls()` becomes a call to `findNextControls(document, lastCard, { isOurs, onScreen, win: window })`; `getComputedStyle` goes through `win`.
- [ ] **Step 4: Run** `npx vitest run`. Expected: all pass (298 plus the new ones).
- [ ] **Step 5: Commit** `refactor(batch): move the next-page finder to pager.js so the recorder can share it`.

### Task 2: Recorder targets and rows

**Files:**
- Create: `src/lib/recorder/targets.js`
- Test: `tests/recorder-targets.test.js`

**Interfaces:**
- Consumes: `resolveTarget`, `describeTarget`, `matchesTarget`, `labelOf`, `buttonWords`, `chainScore` from `src/lib/batch/target.js`; `collapse`, `normaliseText`, `numberIdentities`, `ROW_DEPTH` from `src/lib/batch/rows.js`; `shortUrl` from `src/lib/batch/evidence.js`.
- Produces:
  - `describeStepTarget(node, kind) -> Target`. `Target` is `describeTarget(node, kind)` plus `text` (label, max 60 chars), `href` (absolute href of the node or its closest `a[href]`, else `""`) and `blank` (that link has `target="_blank"`). `words` is kept even for links; `refineWords(target, matches)` clears it when fewer than `max(2, ceil(n/2))` of the matches share it, the same rule as `learnItem`.
  - `rowsFor(doc, target, isOurs) -> Array<{ node, control, id, title }>`. Every match of `target` (`matchesTarget` plus words when set) in document order. Its row is the largest ancestor, up to `ROW_DEPTH`, holding no other match. Its title is the row text with the control's text removed, max 200 chars. Its id is `normaliseText(title)` plus `" | " + shortUrl(first other link)`, numbered by `numberIdentities`.
  - `rowOf(rows, node) -> row | null` (the row whose node contains `node`).
  - `findInRow(rowNode, target) -> Element | null`.
  - `findOnPage(doc, target, { isOurs, onScreen }) -> Element | null`. With words: same words, best `chainScore`. Without words: the first visible `matchesTarget`.
  - `parseWords(text) -> string[]`: split on commas and new lines, trimmed, lower case, empties dropped.
  - `rowFilter(title, skipText, onlyText) -> { take: boolean, why: string }`. `why` is `skipped: has "x"` or `skipped: lacks any of "a", "b"`.
  - `wantedRows(rows, ledger, rec) -> Array<row & { why?: string }>`. Rows not in `ledger.rows` that pass `rowFilter`, in order.

- [ ] **Step 1: Write the failing tests** in `tests/recorder-targets.test.js` on a CIBSE-shaped fixture: three `article.card` elements, each holding `h3 > a.title[href=/item/n]`, a price line, and `a.btn.access[href=/item/n]` reading "Access Now".
  - `rowsFor` on the target of card 2's "Access Now" gives 3 rows, ids differ, titles hold the h3 words and not "Access Now", each `node` is the article.
  - `rowOf(rows, accessButtonOfCard2).title` holds card 2's heading.
  - `findInRow(rows[2].node, target)` is card 3's button.
  - `findOnPage` finds an icon button `<button aria-label="Download"><i></i></button>` by words `"download"`, picks the one whose chain matches best between two candidates, and returns null when only an invisible one exists.
  - `parseWords(" Buy now, hard copy\n\n")` is `["buy now", "hard copy"]`.
  - `rowFilter("TM59 PDF and Hard Copy", "hard copy", "")` is `{ take: false, why: 'skipped: has "hard copy"' }`. With `onlyText` "tm" it takes, and with "guide" it gives `skipped: lacks any of "guide"`.
  - `wantedRows` leaves out a row whose id is in the ledger, with any status.
  - `describeStepTarget` on a link with `target=_blank` gives `blank: true` and an absolute `href`.
- [ ] **Step 2: Run** `npx vitest run tests/recorder-targets.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `src/lib/recorder/targets.js` with the signatures above.
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(recorder): find a recorded target again, and the rows of a list`.

### Task 3: Steps and the run engine

**Files:**
- Create: `src/lib/recorder/steps.js`, `src/lib/recorder/engine.js`
- Test: `tests/recorder-steps.test.js`, `tests/recorder-engine.test.js`

**Interfaces:**
- Consumes: `Target` from Task 2.
- Produces, `steps.js`:
  - Step shapes:
    - `{ kind: "click", tab, origin, path, visit, target, scope: "row"|"page", afterLoad, opens }`
    - `{ kind: "back", tab, origin, visit }`
    - `{ kind: "wait", tab, seconds }`
    - `{ kind: "close", tab }`
    - `{ kind: "check", tab, text, afterLoad }`
  - `newDraft({ origin, listUrl, homeTab, visit }) -> Draft`, with `steps: []`, `firstRow: null`, `rowVisit: null`, `lastTab: homeTab`, `lastVisit: visit`.
  - `addClick(draft, { tab, origin, path, visit, target, scope, row }) -> Draft`. It sets `afterLoad` when the previous step was in the same tab from another visit. The first click sets `firstRow` (`{ id, title }`) and `rowVisit`.
  - `addBack(draft, { tab, origin, visit }) -> Draft`.
  - `finishRecording(draft, previous, { linger = 5, now }) -> { recording, problem }`.
    - The problem is `"Start with a click on an item in the list."` when the first step is not a row click, and `"Nothing was recorded."` when there are no steps.
    - A click followed by the first step in a new tab gets `opens: true`.
    - Where a step's tab differs from the step before, and the earlier tab was opened in the recording and never appears again, `wait(linger)` and `close` for that tab go in before the step. Tabs still open at the end get the same at the end.
    - The recording is `{ version: 1, id, origin, listUrl, homeTab, steps, firstRow, createdAt }`, plus `skipText`, `onlyText`, `highlight`, `pages` and `timeout` carried from `previous` (defaults `""`, `""`, `""`, `0`, `30`).
  - Edits returning a new recording: `removeStep(rec, i)` (refuses `i === 0`), `insertWait(rec, after, seconds = 3)`, `setWait(rec, i, seconds)` (clamped 0 to 600), and `insertCheck(rec, after, text)`. A check takes the tab and `afterLoad` of the step after it.
  - `describeStep(step, index, steps) -> string`. Tab 1 is the home tab and later tabs are numbered in order of appearance. Forms: `Click "Access Now" on each item`; `Tab 2: Click "Download"`; `Click "Read online" (opens a tab)`; `Go back`; `Wait 5 s`; `Tab 2: Close the tab`; `Skip the item if the page says "Buy now"`.
- Produces, `engine.js` (pure, no DOM):
  - Live shape: `{ mode: "idle"|"recording"|"running"|"paused", draft?, run?, closing: string[], note: string }`.
  - Run shape: `{ origin, phase: "row"|"steps"|"turning"|"unwind", at, row, listUrl, page, tabs, opened, lastVisit, since, turnFrom }`.
  - `startRun(rec, me, now) -> Run`: `tabs = { [rec.homeTab]: me.token }`, `listUrl = me.href`, `page = 1`, phase `"row"`.
  - `currentTask(run, rec) -> { type: "pick-row"|"turn-page"|"await-page"|"unwind"|"step", step?, index? }`.
  - `whoActs(run, rec, me, task) -> { mine: boolean, bind: boolean }`.
    - pick-row, turn-page, await-page and unwind belong to the home token.
    - A step whose tab is bound belongs to that token, and to no page whose visit equals `run.lastVisit` when the step is `afterLoad`.
    - A click or check whose tab is unbound belongs to a page whose token is unbound, whose origin matches the step, whose `historyLength` is 1 and whose `startedAt >= run.since - 1000` (`bind: true`).
    - A close or wait whose tab is unbound belongs to the home token, which advances it.
    - `me.holdUntil > me.now` always gives `mine: false`.
  - Reducers, each returning a new run:
    - `rowPicked(run, row, now)`
    - `bindTab(run, recTab, token)` (adds to `opened` unless it is the home tab's token)
    - `advance(run, rec, me, now) -> { run, finished }`. Only click and back steps set `lastVisit`. A close step unbinds its tab and takes it out of `opened`. Leaving the last step gives `finished: true`.
    - `rowEnded(run, now) -> { run, closing }`: phase `"unwind"`; `closing` is `opened`, which then empties; `tabs` keeps only home.
    - `listArrived(run, now)`: phase `"row"`.
    - `turnStarted(run, me, signature, now)`
    - `pageTurned(run, href, now)`: `page + 1`, new `listUrl`, phase `"row"`.
    - `resumed(run, now)`: fresh `since`.
  - `timedOut(run, rec, now, task) -> boolean`. A step allows `rec.timeout` s, pick-row 15 s and await-page 20 s.
  - `failNote(task, steps) -> string`: `step 3: "Download" not found in 30 s`.
  - `sameList(a, b) -> boolean`: same origin, path without a trailing slash, and query.
  - `stopRun(live) -> Live`: mode `"idle"`, `closing` plus `run.opened`, run dropped.

- [ ] **Step 1: Write the failing tests.** `tests/recorder-steps.test.js`:
  - Recording the CIBSE sequence (row click home v1, Read online home v2, Download in tab B, back home v3) finishes as click row, click opens, tab B click, wait 5, close B, back.
  - The second click has `afterLoad: true`.
  - `firstRow` is set.
  - A first click with scope `"page"` gives the problem text.
  - `insertCheck(rec, 1, "Buy now")` puts a check at index 2 with step 3's tab and `afterLoad`.
  - `removeStep(rec, 0)` returns `rec` unchanged.
  - `describeStep` gives the forms above.

  `tests/recorder-engine.test.js`:
  - `startRun` binds home.
  - pick-row belongs to home only.
  - With `afterLoad`, the page whose visit is `lastVisit` is refused and a new visit of the same token is accepted.
  - An unbound click step goes to a fresh page with `historyLength` 1 on the right origin, with `bind: true`. It is refused for `historyLength` 2, the wrong origin, or `startedAt` before `since - 1000`.
  - `advance` past a close unbinds and leaves `opened`, and past the last step gives `finished`.
  - `rowEnded` hands back `opened` as `closing`.
  - `timedOut` is true at 30,001 ms on a step with timeout 30.
  - `sameList("https://a/x/?page=2#t", "https://a/x?page=2")` is true, and false for `page=3`.
  - `stopRun` moves opened tokens into `closing`.
- [ ] **Step 2: Run** `npx vitest run tests/recorder-steps.test.js tests/recorder-engine.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** both modules.
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(recorder): record steps and decide who does the next one`.

### Task 4: Shared storage and the ledger

**Files:**
- Modify: `src/lib/gm.js` (add `getNow`, `setNow`)
- Create: `src/lib/recorder/store.js`
- Test: `tests/gm.test.js` (extend), `tests/recorder-store.test.js`

**Interfaces:**
- Produces:
  - `gm.getNow(key)`: the value from `GM_getValue` when it exists, else `undefined`.
  - `gm.setNow(key, value) -> boolean`: `GM_setValue` when it exists and returns true; otherwise it calls `set` and returns false.
  - `createRecorderStore(gm)` with async methods `readLive()`, `writeLive(live)`, `readRecording(origin)`, `writeRecording(origin, rec)`, `readLedger(origin)`, `writeLedger(origin, ledger)` and `readLeaving()`, plus sync-first methods `writeLiveNow(live)` and `writeLeavingNow({ token, at })`. A missing or broken value reads as its default: `{ mode: "idle", closing: [], note: "" }`, `null`, `{ rows: {} }`, `null`.
  - Ledger helpers, pure: `markRow(ledger, id, { status, title, note, at, page })`, `ledgerTally(ledger) -> { done, skipped, failed }`, `forgetFailed(ledger)`, `ledgerLines(ledger) -> string[]` (skipped and failed, one line each: status padded to 8 chars, then the title to 80 chars, then `: ` and the note).

- [ ] **Step 1: Write the failing tests.**
  - `setNow` uses `GM_setValue` synchronously when it is present, and returns false and calls `GM.setValue` when it is not.
  - `getNow` returns `undefined` without `GM_getValue`.
  - The store reads defaults from an empty fake, round-trips each value as a JSON string, and reads `"{oops"` as the default.
  - `forgetFailed` drops only failed rows.
  - `ledgerTally` counts each status.
- [ ] **Step 2: Run** `npx vitest run tests/gm.test.js tests/recorder-store.test.js`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(recorder): shared storage across tabs and a ledger per list site`.

### Task 5: Highlight and panel

**Files:**
- Create: `src/lib/recorder/highlight.js`, `src/lib/recorder/panel.js`
- Test: `tests/recorder-panel.test.js`

**Interfaces:**
- Consumes: `palette`, `tag`, `own`, `getTouch` from `src/lib/ui.js`; `numberStyle`, `makeDraggable` from `src/lib/batch/panel.js`.
- Produces:
  - `findWordRanges(text, words) -> Array<[start, end]>`: case-insensitive, non-overlapping, in order.
  - `highlightWords(doc, name, words, isOurs) -> number` uses `CSS.highlights` and `Highlight` with at most 2000 ranges, adds a style element once (`::highlight(pz-rec-mark)` yellow, `::highlight(pz-rec-skip)` light red, text black), and returns the count. It returns 0 without throwing where the API is missing.
  - `clearHighlights(doc)`.
  - `createRecorderPanel(opts) -> view`.
    - `opts`: `position`, `onClose`, `onRecord`, `onPlay`, `onStop`, `onReset`, `onExport`, `onSelectStep(i)`, `onRemoveStep(i)`, `onWaitSeconds(i, v)`, `onAddWait()`, `onAddCheck(text)`, `onSkipText(v)`, `onOnlyText(v)`, `onHighlight(v)`, `onPages(v)`, `onTimeout(v)`.
    - `data-act` names: `rec-close`, `rec-record`, `rec-play`, `rec-stop`, `rec-reset`, `rec-step`, `rec-remove`, `rec-wait-seconds`, `rec-add-wait`, `rec-check-text`, `rec-add-check`, `rec-skip`, `rec-only`, `rec-highlight`, `rec-pages`, `rec-timeout`, `rec-export`, `rec-details`. Per-step controls carry `data-index`.
    - Root `data-pz="recorder"`.
  - The view has `{ el, head, setMode(mode), setSteps(lines, kinds, waits, selected), setFields({ skipText, onlyText, highlight, pages, timeout }), setStatus, setCounts, setDetails(text, open), setReset(label) }`.
    - `setMode` labels: Record reads `⏺ Record` when idle and `■ Stop recording` when recording. Play reads `▶ Play`, `⏸ Pause` while running and `▶ Resume` when paused.
    - Every row of `setSteps` after the first has a `✕`. Wait rows have a number box.

- [ ] **Step 1: Write the failing tests.**
  - `findWordRanges("Buy now or buy NOW", ["buy now"])` is `[[0,7],[11,18]]`.
  - `highlightWords` returns 0 in jsdom.
  - The panel's first act order is `rec-close, rec-record, rec-play, rec-stop, rec-reset`.
  - `setSteps(["a","b","c"], ["click","wait","back"], [null,5,null], 1)` draws two `rec-remove` buttons and one `rec-wait-seconds` reading 5. Clicking `rec-remove` with `data-index` 2 calls `onRemoveStep(2)`.
  - Typing "Buy now" in `rec-check-text` and pressing `rec-add-check` calls `onAddCheck("Buy now")` and empties the box.
  - `setMode("running")` makes Play read `⏸ Pause`.
- [ ] **Step 2: Run** `npx vitest run tests/recorder-panel.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** both. Style as the batch panel: 300 px wide, themed header, steps list scrolling at 180 px, folded Details.
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(recorder): panel and highlighting`.

### Task 6: The recorder tool, wired into the zapper

**Files:**
- Create: `src/lib/recorder/tool.js`
- Modify:
  - `src/main.js`: create the tool, add the menu command "Step recorder", call `recorder.resume()` in `start()`, add it to `repaint()`.
  - `src/lib/batch/panel.js` and `src/lib/batch/tool.js`: a `⏺ Steps` button (`data-act="batch-steps"`) in the teach row, calling `onSteps`.
  - `src/userscript-header.js`: grants.
  - `package.json`: version 2.3.0.
  - `README.md`: a "Step recorder" section.
- Test: `tests/batch-panel.test.js` (act lists gain `batch-steps`), `tests/build-header.test.js` (grants), `tests/recorder-tool.test.js`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `createRecorderTool({ gm, pageWindow, version }) -> { open(), close(), isOpen(), repaint(), resume() }`.
  - `resume()` reads `live`. When the mode is not idle, or this tab's token is in `closing`, it opens the panel, or closes the tab, and starts the loop. It returns true if it did anything.

Behaviour the code must have (all from the spec):
- **Tokens.** A tab token in `sessionStorage["pz-rec tab"]` is made only while the mode is not idle, or on Record or Play. Adoption works as in the spec. `pagehide` calls `writeLeavingNow`. A visit id is made at load and remade on `pageshow` with `persisted`.
- **Recording.** A capture-phase `click` listener on `window`, for trusted events not on our UI, builds the step synchronously and saves the draft with `writeLiveNow`. A first click that `rowOf` cannot place in a list of at least 2 rows is not recorded and says `That isn't one of a list of items. Click the first item's button.` A later click in the same visit as `rowVisit` and inside the recorded row node is scope `"row"`. A load with navigation type `back_forward`, or a persisted `pageshow`, adds a Back step. Stop recording runs `finishRecording`, saves the recording (keeping the old filters), marks `firstRow` done in the ledger, and sets the mode to idle.
- **Loop** every 300 ms while the mode is not idle or the panel is open:
  1. Read `live`. If this token is in `closing`, remove it and save, then `window.close()`. If still open 1.5 s later, say `Close this tab by hand.`
  2. While running, take `currentTask`. If `whoActs` says mine and no action is in flight, act:
     - pick-row: navigate to `listUrl` when not `sameList`, at most once per visit and only 1.5 s after `since`. Then `wantedRows`. None found within 15 s ends the run (`No items found on the list page.`). None wanted starts turning. Otherwise `rowPicked`, then do step 0 in the same tick.
     - step click: find the element (in the row by id, or on the page). Missing past the timeout gives `failNote`, a failed ledger row and `rowEnded`. Found: save `advance`, then click. Hold 1.5 s. A click with `opens` goes through `gm.openTab(href)` when there is an href. Otherwise `pageWindow.open` is caught for 1 s and routed to `gm.openTab`, returning a stub `{ closed: false, focus(){}, close(){} }`. Click sequence: `pointerdown`, `mousedown`, `pointerup`, `mouseup` (bubbling, cancelable), then `el.click()`.
     - wait: advance once `since + seconds` has passed.
     - check: if the page's `body.innerText` (falling back to `textContent`) holds the text, ignoring case, give a skipped ledger row with note `page says "x"` and `rowEnded`. Otherwise advance once `readyState` is complete and the page has been quiet 1 s.
     - back: save `advance`, then `history.back()`, then hold 5 s.
     - close: save `advance`, then `window.close()` after 100 ms.
     - finished: a done ledger row, then `rowEnded`, writing `closing`.
     - unwind: `listArrived` when `sameList`, else navigate (hold 5 s).
     - turn-page: stop with `Stopped after N page(s).` when `rec.pages` is reached. Otherwise `findNextControls(document, lastRowNode, ...)`; none gives `Last page done.` Else `turnStarted` with the row id signature, then click it.
     - await-page: `pageTurned` when the visit differs from `turnFrom.visit` or the signature changed.
     - When the home tab acts after another tab acted, call `window.focus()`.
  3. Paint rows on the list: done at opacity 0.45, skipped with a red dashed outline, failed amber, current blue. Highlight `rec.highlight` words, and `skipText` words as skip.
  4. Panel counts: `Page P · N items here · D done · S skipped · F failed`. Details gives `ledgerLines`.
- **Buttons.**
  - Play with no recording says `Record one item first.` Otherwise it runs `forgetFailed`, then `startRun` with mode running. On a paused run it gives `resumed`, and on a running one it pauses.
  - Stop gives `stopRun`.
  - Reset asks twice within 4 s and clears the ledger.
  - Export saves `step-recorder-<host>-<stamp>.json` holding `{ script, at, recording, ledger, live }`.
  - Panel field changes save the recording; they are refused while running (`Stop the run first.`).

- [ ] **Step 1: Write the failing tests.**
  - `tests/recorder-tool.test.js` with a fake gm in jsdom. `open()` adds `[data-pz="recorder"]`. With a stored live in mode recording, `resume()` returns true and opens the panel. A trusted click can't be made in jsdom, so the recording listener's step-building function `stepFromClick(target, me, draft, rowNode)` is exported and tested: on the CIBSE fixture it gives scope `"row"` for card 1's "Access Now", and a problem for a click on the page header.
  - Batch panel act lists include `batch-steps` after `batch-forget-item`.
  - The header test expects `// @grant        window.close` and `// @grant        window.focus`.
- [ ] **Step 2: Run** `npx vitest run`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement**, then `npm run build`.
- [ ] **Step 4: Run** `npx vitest run && npm run build`. Expected: all pass, and `Built dist/popup-zapper.user.js (v2.3.0)`.
- [ ] **Step 5: Commit** `feat(recorder): step recorder in the zapper, opened from the batch clicker` (including `git add -f dist/popup-zapper.user.js`).

### Task 7: End-to-end check on a two-origin fake site

**Files:**
- Create: `e2e/recorder-site.cjs` (node http server), `e2e/recorder.e2e.cjs` (playwright-core runner)
- Modify: `package.json` (script `"e2e:recorder": "node e2e/recorder.e2e.cjs"`)

**Interfaces:**
- Consumes: `dist/popup-zapper.user.js`.
- Fake site, one port, two origins (`http://127.0.0.1:PORT` list and items, `http://localhost:PORT` viewer):
  - `/list?page=1` and `/list?page=2` show three cards each, as in the Task 2 fixture. A pager has a "Next Page" link on page 1 only.
  - `/item/n` has a "Read online" `a[target=_blank]` to `http://localhost:PORT/viewer/n`. Item 5 instead says "Members only: Buy now" with no read link.
  - `/viewer/n` draws, after 800 ms, a toolbar `button[aria-label=Download]` holding only an icon. Clicking it sets `location.href = /file/n.pdf`, which is served with `Content-Disposition: attachment`.
- Runner:
  - Paths come from env vars with defaults: `PLAYWRIGHT_CORE` (default `C:/dev/VS code/models/partical simulation/SandboxScience/node_modules/playwright-core`), `CHROMIUM` (default newest `chromium-*/chrome-win*/chrome.exe` under `%LOCALAPPDATA%/ms-playwright`).
  - Init script: a GM shim over `exposeBinding` (shared store in Node; `GM.getValue`/`GM.setValue` async; `GM_openInTab` opens a page in the context and brings it to the front; `window.close` and `window.focus` overridden to close or bring the calling page to the front; `GM_info`, a `GM_registerMenuCommand` that does nothing, `unsafeWindow = window`), then the bundle.

- [ ] **Step 1: Write the runner** to do the following:
  1. Open list page 1 and open the recorder through the batch panel or the store.
  2. Press Record, then do item 1 by hand with real clicks: Access Now, Read online, Download in the new page, close that page, `goBack` on the home page.
  3. Press Stop recording.
  4. Assert the panel lists 6 steps.
  5. Select step 2, add a check "Buy now", and set the wait to 2.
  6. Press Play, then wait for mode idle with a note `Last page done.` (timeout 120 s).
  7. Assert: 5 downloads, files 1, 2, 3, 4 and 6; the ledger holds 5 done and 1 skipped (item 5); exactly one page is open; the home page is on `/list?page=2`.
- [ ] **Step 2: Run** `npm run build && npm run e2e:recorder`. Fix what fails, adding a unit test for each fault found, until it prints `recorder e2e: PASS`.
- [ ] **Step 3: Commit** `test(recorder): two-origin end-to-end check with a new tab per item`.
