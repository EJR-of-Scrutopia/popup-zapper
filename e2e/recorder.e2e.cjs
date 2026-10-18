// End-to-end check of the step recorder on the fake two-site library
// (recorder-site.cjs): record item 1 by hand with real clicks, add a check
// and shorten the wait, then Play and see every other item fetched across
// both list pages, item 5 skipped, and every viewer tab closed.
//
// Run: npm run build && npm run e2e:recorder   (HEADED=1 to watch)
// Paths: PLAYWRIGHT_CORE and CHROMIUM override the defaults below.

const fs = require("fs");
const path = require("path");
const site = require("./recorder-site.cjs");

const PLAYWRIGHT = process.env.PLAYWRIGHT_CORE
  || "C:/dev/VS code/models/partical simulation/SandboxScience/node_modules/playwright-core";

function findChromium() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const root = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  const builds = fs.readdirSync(root).filter((name) => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const build of builds) {
    for (const folder of ["chrome-win64", "chrome-win"]) {
      const exe = path.join(root, build, folder, "chrome.exe");
      if (fs.existsSync(exe)) return exe;
    }
  }
  throw new Error("No Chromium found; set CHROMIUM");
}

const SHIM = `(() => {
  window.GM = {
    getValue: async (key, dflt) => { const v = await window.__pzGet(key); return v === null || v === undefined ? dflt : v; },
    setValue: async (key, value) => { await window.__pzSet(key, value); },
    setClipboard: async () => {},
    xmlHttpRequest: () => {},
    openInTab: (url) => { window.__pzOpenTab(url); },
    addStyle: () => {},
  };
  window.GM_openInTab = (url) => {
    const id = String(Math.random());
    window.__pzOpenTab(url, id);
    const handle = { closed: false, close() { handle.closed = true; window.__pzCloseOpened(id); } };
    return handle;
  };
  window.GM_registerMenuCommand = () => {};
  window.GM_setClipboard = () => {};
  window.GM_xmlhttpRequest = () => {};
  window.GM_info = { script: { version: "e2e" } };
  window.unsafeWindow = window;
  window.close = () => { window.__pzClose(); };
  window.focus = () => { window.__pzFocus(); };
})();`;

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

function check(ok, what) {
  if (!ok) throw new Error("FAILED: " + what);
  console.log("  ok  " + what);
}

async function main() {
  const { chromium } = require(PLAYWRIGHT);
  const server = await site.start();
  const A = `http://127.0.0.1:${server.port}`;
  // Playwright turns the popup blocker off by default; Brave keeps it on, and
  // it stops a window.open made from a script's click.
  const browser = await chromium.launch({
    executablePath: findChromium(), headless: !process.env.HEADED, ignoreDefaultArgs: ["--disable-popup-blocking"],
  });
  const context = await browser.newContext({ acceptDownloads: true });
  const store = new Map();
  const downloads = [];
  const watch = (page) => {
    page.on("download", (download) => downloads.push(download.suggestedFilename()));
    page.on("pageerror", (error) => console.log("  page error:", page.url(), error.message));
  };
  context.on("page", watch);
  await context.exposeBinding("__pzGet", (source, key) => (store.has(key) ? store.get(key) : null));
  await context.exposeBinding("__pzSet", (source, key, value) => { store.set(key, value); });
  const openedById = new Map();
  await context.exposeBinding("__pzCloseOpened", async (source, id) => {
    const page = openedById.get(id);
    if (page) await page.close().catch(() => {});
  });
  await context.exposeBinding("__pzOpenTab", async (source, url, id) => {
    const page = await context.newPage();
    if (id) openedById.set(id, page);
    await page.goto(url).catch(() => {});
    await page.bringToFront().catch(() => {});
  });
  await context.exposeBinding("__pzClose", async ({ page }) => { await page.close().catch(() => {}); });
  await context.exposeBinding("__pzFocus", async ({ page }) => { await page.bringToFront().catch(() => {}); });
  const bundle = fs.readFileSync(path.join(__dirname, "..", "dist", "popup-zapper.user.js"), "utf8");
  await context.addInitScript(SHIM + "\n" + bundle);
  const live = () => JSON.parse(store.get("pz-rec live") || "{}");
  const ledger = () => JSON.parse(store.get("pz-rec ledger " + A) || '{"rows":{}}');
  const act = (page, name, index) => page.locator(`[data-act="${name}"]` + (index === undefined ? "" : `[data-index="${index}"]`));

  try {
    console.log("recorder e2e on " + A);
    const home = await context.newPage();
    await home.goto(A + "/list?page=1");
    await act(home, "menu").click();
    await act(home, "batch").click();
    await act(home, "batch-steps").click();
    await act(home, "rec-record").click();
    await wait(300);
    check(live().mode === "recording", "Record starts a recording");

    // Item 1 by hand, as on CIBSE: Access Now, Download, Yes I agree (the
    // viewer opens in a new tab), Download in the viewer, close it, Back To
    // All Knowledge Items. A person waits for the page; so does the test.
    await home.locator("article.card").nth(0).locator("a.access").click();
    await home.waitForURL(/\/item\/1$/);
    await home.waitForLoadState("load");
    await wait(600);
    await home.locator("aside a.knowledge-purchase-cta__btn-purchase").click();
    await home.waitForSelector("#download-modal.show");
    const [viewer] = await Promise.all([context.waitForEvent("page"), home.locator(".btn-cta-confirm").click()]);
    await viewer.waitForSelector('button[aria-label="Download"]');
    await wait(500);
    await Promise.all([viewer.waitForEvent("download"), viewer.locator('button[aria-label="Download"]').click()]);
    await wait(800);
    await viewer.close();
    await home.bringToFront();
    await home.locator("a.subpage-hero-banner__btn-back").click();
    await home.waitForURL(/\/list\?page=1$/);
    await wait(1200);
    check(live().draft && live().draft.steps.map((step) => step.target && step.target.text).join(",") === "Access Now,Download,Yes, I agree,Download,Back To All Knowledge Items",
      "the recording holds Access Now, Download, Yes I agree, Download, Back To All");
    await act(home, "rec-record").click();
    await wait(600);
    check(live().mode === "idle", "Stop recording ends it");
    check(await home.locator('[data-act="rec-step"]').count() === 7, "the panel lists 7 steps");
    check(Object.values(ledger().rows).some((row) => row.status === "done" && row.note === "done by hand"), "item 1 is marked done by hand");

    // As his recording: nothing between the item click and Download, so the
    // run meets each item page as it loads. Item 5 is left out by the list
    // filter; the wait is shortened.
    await act(home, "rec-skip").fill("Code M");
    await act(home, "rec-skip").dispatchEvent("change");
    const box = act(home, "rec-wait-seconds", 4);
    await box.fill("2");
    await box.dispatchEvent("change");
    await wait(600);
    const rec = JSON.parse(store.get("pz-rec recording " + A));
    check(rec.steps.map((step) => step.kind).join(",") === "click,click,click,click,wait,close,click", "the steps read click, click, click, click, wait, close, click");
    check(rec.steps[2].opens === true, '"Yes, I agree" is known to open a tab');
    check(rec.steps[4].seconds === 2, "the wait is 2 s");
    check(rec.skipText === "Code M", "items with Code M are skipped");
    await act(home, "rec-timeout").fill("5");
    await act(home, "rec-timeout").dispatchEvent("change");
    await wait(600);
    check(JSON.parse(store.get("pz-rec recording " + A)).timeout === 5, "the step timeout is 5 s");

    // Play.
    const started = Date.now();
    await act(home, "rec-play").click();
    while (live().mode !== "running" && Date.now() - started < 5000) await wait(100);
    check(live().mode === "running", "Play starts the run");
    while (Date.now() - started < 150000) {
      const now = live();
      if (now.mode === "idle") break;
      await wait(500);
    }
    console.log("  run took " + Math.round((Date.now() - started) / 1000) + " s; note: " + live().note);
    check(live().mode === "idle" && live().note === "Last page done.", "the run ends with Last page done.");
    await wait(1500);
    const got = downloads.slice().sort();
    console.log("  downloads: " + got.join(", "));
    check(got.join(",") === "doc-1.pdf,doc-2.pdf,doc-3.pdf,doc-4.pdf", "items 1, 2, 3 and 4 downloaded once each");
    const rows = Object.values(ledger().rows);
    check(rows.filter((row) => row.status === "done").length === 4, "the ledger holds 4 done");
    const failed = rows.filter((row) => row.status === "failed");
    check(failed.length === 1 && /TM65/.test(failed[0].title) && failed[0].note === 'step 4: "Download" not found in 5 s', "item 6 fails: its viewer went to a login page");
    check(!rows.some((row) => /Code M/.test(row.title)), "item 5 was left alone by the filter");
    check(context.pages().length === 1, "every viewer tab is closed, the login tab too");
    check(/\/list\?page=2$/.test(home.url()), "the home tab is on list page 2");
    console.log("recorder e2e: PASS");
  } catch (error) {
    console.log("recorder e2e: FAIL\n" + (error && error.stack ? error.stack : error));
    console.log("live: " + store.get("pz-rec live"));
    console.log("ledger: " + store.get("pz-rec ledger " + A));
    console.log("pages: " + context.pages().map((page) => page.url()).join(" | "));
    console.log("downloads: " + downloads.join(", "));
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
}

main();
