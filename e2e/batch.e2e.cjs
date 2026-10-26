// End-to-end check of the batch clicker's picked kind, in Chromium with the
// built userscript: cards each carry a PDF, a DWG and an RVT icon over two
// pages. Picking one PDF icon must click the PDF icons only, page by page;
// icons drawn alike must be told apart by their place; and Refine must widen
// and narrow the kind by clicks.
//
// Run: npm run build && npm run e2e:batch   (HEADED=1 to watch)
// Paths: PLAYWRIGHT_CORE and CHROMIUM override the defaults below; SHOTS=<folder>
// saves screenshots of the panel to look at.

const fs = require("fs");
const path = require("path");
const http = require("http");

const PLAYWRIGHT = process.env.PLAYWRIGHT_CORE
  || "C:/dev/VS code/models/partical simulation/SandboxScience/node_modules/playwright-core";
const DIST = path.join(__dirname, "..", "dist", "popup-zapper.user.js");

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

// Six cards a page, two pages drawn in place, each card with three icons.
// "alike" draws the three icons identically, so only their place differs.
function page(alike) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Fake product files</title>
<style>
  body { font: 14px sans-serif; margin: 20px; }
  #cards { display: grid; grid-template-columns: repeat(3, 240px); gap: 12px; }
  .card { border: 1px solid #ccc; padding: 10px; border-radius: 6px; }
  .files a { display: inline-block; width: 28px; height: 28px; margin-right: 6px; border: 1px solid #999; border-radius: 4px; }
  .files a.picked { background: #c8e6c9; }
  .icon-pdf { color: #c62828; } .icon-dwg { color: #1565c0; } .icon-rvt { color: #6a1b9a; }
</style></head><body>
<div id="list-count">List (0)</div>
<div id="cards"></div>
<nav id="pager"></nav>
<script>
  const NAMES = ["Alpha board", "Beta slab", "Gamma roll", "Delta batt", "Epsilon sheet", "Zeta panel",
    "Eta block", "Theta tile", "Iota strip", "Kappa sheet", "Lambda board", "Mu panel"];
  const ALIKE = ${alike ? "true" : "false"};
  window.__clicked = [];
  let pageNo = 1;
  function draw() {
    const cards = document.getElementById("cards");
    cards.innerHTML = "";
    for (let i = 0; i < 6; i++) {
      const name = NAMES[(pageNo - 1) * 6 + i];
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = "<h3>" + name + "</h3><div class='files'></div>";
      for (const kind of ["pdf", "dwg", "rvt"]) {
        const a = document.createElement("a");
        a.className = "dl";
        if (ALIKE) {
          a.href = "#";
          a.innerHTML = "<span class='ico'></span>";
        } else {
          a.href = "/files/" + name.replace(/ /g, "-") + "." + kind;
          a.title = "Download " + kind.toUpperCase() + " for " + name;
          a.innerHTML = "<i class='icon icon-" + kind + "'>" + kind[0] + "</i>";
        }
        a.addEventListener("click", (e) => {
          e.preventDefault();
          window.__clicked.push(name + ":" + kind);
          a.classList.toggle("picked");
          document.getElementById("list-count").textContent = "List (" + window.__clicked.length + ")";
        });
        card.querySelector(".files").appendChild(a);
      }
      cards.appendChild(card);
    }
    const pager = document.getElementById("pager");
    pager.innerHTML = [1, 2].map((p) => "<a href='#' class='page-link" + (p === pageNo ? " active" : "") + "' data-p='" + p + "'>" + p + "</a>").join(" ")
      + (pageNo < 2 ? " <a href='#' class='next' aria-label='Next page'>&rsaquo;</a>" : "");
  }
  document.getElementById("pager").addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (!a) return;
    e.preventDefault();
    setTimeout(() => { pageNo = a.classList.contains("next") ? pageNo + 1 : Number(a.dataset.p); draw(); }, 300);
  });
  draw();
</script></body></html>`;
}

function start() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://x");
      if (url.pathname === "/icons.html" || url.pathname === "/alike.html") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(page(url.pathname === "/alike.html"));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

const SHIM = `
  window.GM_info = { script: { version: "e2e" } };
  window.GM_registerMenuCommand = function () {};
  window.unsafeWindow = window;
`;

async function shot(p, name) {
  if (!process.env.SHOTS) return;
  fs.mkdirSync(process.env.SHOTS, { recursive: true });
  await p.screenshot({ path: path.join(process.env.SHOTS, name + ".png") });
}

function check(ok, what, detail) {
  if (!ok) throw new Error("FAILED: " + what + (detail !== undefined ? "  " + JSON.stringify(detail) : ""));
  console.log("  ok  " + what);
}

const status = (p) => p.$eval("[data-pz='batch'] [data-pz-status]", (el) => el.textContent);

async function waitStatus(p, re, ms) {
  const until = Date.now() + ms;
  let last = "";
  while (Date.now() < until) {
    last = await status(p);
    if (re.test(last)) return last;
    await p.waitForTimeout(200);
  }
  throw new Error("status never matched " + re + "; last: " + last);
}

async function openBatch(p) {
  await p.waitForSelector("[data-pz='control'] [data-act='menu']", { timeout: 10000 });
  await p.click("[data-pz='control'] [data-act='menu']");
  await p.click("[data-pz='control'] [data-act='batch']");
  await p.waitForSelector("[data-pz='batch']");
  await p.waitForTimeout(300);
}

// The icons outlined green, as a run will take them.
const greens = (p) => p.$$eval("a.dl", (links) => links.filter((a) => /solid/.test(a.style.outline)).length);

async function main() {
  const { chromium } = require(PLAYWRIGHT);
  const { server, port } = await start();
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: findChromium(), headless: !process.env.HEADED });
  const user = fs.readFileSync(DIST, "utf8");
  const fresh = async () => {
    const context = await browser.newContext({ viewport: { width: 1300, height: 860 } });
    await context.addInitScript({ content: SHIM + "\n" + user });
    const p = await context.newPage();
    p.on("pageerror", (error) => console.log("  page error:", error.message));
    return { context, p };
  };
  try {
    console.log("A picked PDF icon clicks the PDF icons only, on both pages");
    {
      const { context, p } = await fresh();
      await p.goto(base + "/icons.html");
      await openBatch(p);
      await p.click("[data-act='batch-pick-item']");
      await p.click(".card:nth-child(1) a.dl:nth-child(1)");
      await p.waitForTimeout(300);
      const said = await status(p);
      check(/Learned: 6 button\(s\) of this kind \(18 look alike\)/.test(said), "learned 6 of this kind among 18 alike", said);
      check(await p.$$eval(".files a.picked", (n) => n.length) === 0, "the picking click was kept from the page");
      check(await greens(p) === 6, "the six PDF icons are outlined green before Play", await greens(p));
      await shot(p, "1-learned");
      check(!!(await p.$("[data-act='batch-variant-kind']")) && !!(await p.$("[data-act='batch-refine']")), "the panel offers This kind / All alike and Refine");
      await p.click("[data-act='batch-play']");
      const end = await waitStatus(p, /^(Done|Stopped|Limit)/, 60000);
      const clicked = await p.evaluate(() => window.__clicked);
      check(/^Done: last page/.test(end), "the run ends on the last page", end);
      check(clicked.length === 12 && clicked.every((each) => /:pdf$/.test(each)), "12 clicks, every one a PDF", clicked);
      await context.close();
    }

    console.log("Icons drawn alike: the one picked is told apart by its place");
    {
      const { context, p } = await fresh();
      await p.goto(base + "/alike.html");
      await openBatch(p);
      await p.click("[data-act='batch-pick-item']");
      await p.click(".card:nth-child(2) a.dl:nth-child(2)");
      await p.waitForTimeout(300);
      check(/Learned: 6 button\(s\) of this kind \(18 look alike\)/.test(await status(p)), "learned the second icon of each card", await status(p));
      await p.click("[data-act='batch-play']");
      await waitStatus(p, /^(Done|Stopped|Limit)/, 60000);
      const clicked = await p.evaluate(() => window.__clicked);
      check(clicked.length === 12 && clicked.every((each) => /:dwg$/.test(each)), "12 clicks, every one the second icon", clicked);
      await context.close();
    }

    console.log("All alike and Refine change what a run takes");
    {
      const { context, p } = await fresh();
      await p.goto(base + "/icons.html");
      await openBatch(p);
      await p.click("[data-act='batch-pick-item']");
      await p.click(".card:nth-child(1) a.dl:nth-child(1)");
      await p.waitForTimeout(300);
      await p.click("[data-act='batch-variant-all']");
      await p.waitForTimeout(200);
      check(await greens(p) === 18, "All alike takes all 18", await greens(p));
      await p.click("[data-act='batch-variant-kind']");
      await p.waitForTimeout(200);
      check(await greens(p) === 6, "This kind takes the 6 again", await greens(p));
      await p.click("[data-act='batch-refine']");
      await p.waitForTimeout(200);
      const dashed = await p.$$eval("a.dl", (links) => links.filter((a) => /dashed/.test(a.style.outline)).length);
      check(dashed === 12, "Refine shows the 12 left out, dashed", dashed);
      await shot(p, "2-refine");
      await p.click(".card:nth-child(3) a.dl:nth-child(2)");
      await p.waitForTimeout(300);
      check(await greens(p) === 12, "taking a DWG in widens the kind to PDF and DWG", await greens(p));
      await p.click(".card:nth-child(4) a.dl:nth-child(2)");
      await p.waitForTimeout(300);
      check(await greens(p) === 6, "leaving a DWG out narrows it back", await greens(p));
      await p.click("[data-act='batch-refine']");
      await p.waitForTimeout(200);
      check(await p.$$eval(".files a.picked", (n) => n.length) === 0, "no Refine click reached the page");
      await p.click("[data-act='batch-play']");
      await waitStatus(p, /^(Done|Stopped|Limit)/, 60000);
      const clicked = await p.evaluate(() => window.__clicked);
      check(clicked.length === 12 && clicked.every((each) => /:pdf$/.test(each)), "the run after Refine clicks the 12 PDFs", clicked);
      await context.close();
    }
    console.log("\nAll batch clicker checks passed.");
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => { console.error(error.message || error); process.exit(1); });
