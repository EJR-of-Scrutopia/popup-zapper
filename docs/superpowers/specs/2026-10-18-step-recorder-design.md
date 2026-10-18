# Step recorder: design

Date: 2026-10-18. Status: Param said "lets just build" and skipped the questions, so the
calls below marked *my call* are mine, not his.

## Why

The Batch clicker handles pages where the documents sit on one page (tick and download,
or click each). Some libraries need a chain of actions per document across pages and
tabs. The case in hand is the CIBSE Knowledge Portal: 48 list pages of 12 cards on
www.cibse.org. Each card's "Access Now" opens the item page in the same tab. Its read
button opens the PDF in a SharePoint viewer on cibseorg.sharepoint.com in a new tab. The
viewer's download icon fetches the file. Then the person closes the viewer, goes back to
the list and does the next card. About 576 times.

He asked for a recorder: he does one item by hand, the tool learns the steps, finds the
same button on every other item, repeats the steps for each item, then moves to the
next page and repeats. He also asked for operators: wait, switch tabs, go back, skip an
item if it shows some text, and highlight text.

## Goals

1. **Record** one item by hand: clicks, new tabs, closing a tab, and Back are noted as
   steps in order, across pages, origins and tabs.
2. **Learn the list**: the first click is on an item in a list. Every other element on
   that page that matches it (same tag and class path, same words when most share
   them) is another item. Each item's row is the largest element above its control
   holding no other control; its identity is its words plus its own link's path.
3. **Replay** the steps for every item not yet done, then turn to the next list page,
   until the last page or a page limit.
4. **Operators** added to the recorded steps: Wait N seconds; Skip the item if the page
   shows some text; Close tab and Back, which are also recorded by themselves.
   List-level filters: skip items whose text contains any of some words, and take only
   items containing any of some words.
5. **Highlight**: words typed into a Highlight box are marked on every page while the
   recorder is open, and the words of the skip filter are marked in red on the list.
   *My call:* he said "highlight the text" without saying what for. This reading lets
   him see what a filter catches before Play.
6. **A ledger** of items done, skipped and failed, kept per recording, so a stopped run
   resumes where it was and nothing is fetched twice. A failed item is tried again at
   the next Play.
7. **Export** the recording and ledger as JSON. When a site does not behave, that file
   is the diagnostic to send back.

## Non-goals

- Steps before the loop (log in, set a filter): the person does them by hand before
  Record.
- Typing into fields, drags, keyboard steps, clicks inside iframes (the zapper runs with
  `@noframes`).
- Telling when a download finished. A run-opened tab is closed after a wait (5 s by
  default, editable), not on evidence of the file.
- Several recordings per site. One per list origin; recording again replaces it.

## Anti-goals

- Opening a tab per item and never closing it (576 tabs).
- Clicking a different item's button than the one in the current row.
- Marking an item done when a step never happened.
- Doing anything on a site until the recorder is used there.

## How it works

**Where it lives.** A new module `src/lib/recorder/`, opened from a "⏺ Steps" button on
the Batch clicker panel and a "Step recorder" menu command. *My call:* a panel of its
own, not a third Batch clicker mode, because the batch tool is already 1,400 lines and
the recorder works across tabs, which nothing in the batch tool does.

**Shared storage.** The list and the viewer are on different origins, so everything the
recorder keeps goes in the userscript manager's storage (`GM.getValue`/`GM.setValue`),
which every tab and origin shares. The batch tool's per-site localStorage cannot be used.

**Tabs.** Each tab gets a token in its sessionStorage, made only once the recorder is in
use. A page with no token and `history.length === 1` is a new tab. A page with no token
and a longer history is the same tab after a cross-origin move. It takes the token that
was leaving within the last 5 s, which each page writes on `pagehide`. Each page load,
and each restore from the back-forward cache, gets a fresh visit id.

**Recording** notes trusted clicks (capture phase, never stopped or changed), a load or
restore whose navigation type is `back_forward` (Back), and a tab becoming visible when
the last step was made in another tab (Switch). On Stop:
- a click followed by a step in a tab not seen before becomes "opens a tab";
- a Switch out of a tab the recording opened becomes Wait 5 s plus Close that tab;
- the item clicked by hand is marked done in the ledger.

**Replay** is a state machine kept in shared storage. Every page with the script reads
it at load, and polls it every 300 ms while a run is going. A page acts on the current
step only when it is the right tab (its token is bound to the step's recorded tab, or
it is a fresh unbound tab on the step's origin). For a step recorded after a page load,
the page must also be a different visit from the one that did the previous step. The
acting page writes the next step **before** it acts, because clicks navigate and closes
end the page. A step that cannot find its button within the step timeout (30 s by
default) fails the item. Failing or finishing an item unwinds: tabs the run opened
close themselves, and the home tab goes back to the list address.

**Clicks.** A click step finds its element inside the current row (for clicks made in
the item's row on the list page) or on the page by words and path. It is clicked with
pointer and mouse events, then `click()`. A click recorded as opening a tab goes through
`GM.openInTab` when the element is a link, and with `window.open` caught and routed the
same way when it is not. The browser's popup blocker stops tabs opened from a script's
click otherwise.

**Pages.** The next list page is found by the Batch clicker's next-page finder, moved to
`src/lib/batch/pager.js` so both tools share it. It looks for rel=next, a "next" label
or class, the words Next or Next Page or an arrow, else the page numbers.

**Grants.** `@grant window.close` and `@grant window.focus` (Violentmonkey and
Tampermonkey both honour them), so a run-opened tab can close itself and the home tab
can come to the front when its turn comes.

## Constraints

- A userscript bundle built by esbuild, plain ES2020 modules, Vitest with jsdom. Same
  file and comment style as `src/lib/batch/`.
- Panel words: short, plain British English, no em dashes.
- Every new number box uses `numberStyle(width)`, because a site's padding reaches the
  panel.
- Commit after each task. No co-author lines. Do not push; Param pushes.

## Left to the builder

Exact layout of the panel, the poll interval within 200 to 500 ms, the wording of
status lines, and how a step is described in the list, within the words above.
