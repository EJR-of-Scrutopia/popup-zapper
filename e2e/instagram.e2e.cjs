// End-to-end check of the Instagram post viewer, in Chromium with the built
// userscript, against a stand-in instagram.com served by request interception.
//
// Run: npm run build && npm run e2e:instagram   (HEADED=1 to watch)
// Paths: PLAYWRIGHT_CORE and CHROMIUM override the defaults below.

const fs = require("fs");
const path = require("path");
const { routeFor, POSTS } = require("./instagram-site.cjs");

const PLAYWRIGHT = process.env.PLAYWRIGHT_CORE
  || "C:/dev/VS code/models/partical simulation/SandboxScience/node_modules/playwright-core";
const DIST = path.join(__dirname, "..", "dist", "popup-zapper.user.js");
const PROFILE = "https://www.instagram.com/fakegram/";

function findChromium() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const root = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  const builds = fs.readdirSync(root)
    .filter((n) => /^chromium-\d+$/.test(n))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const build of builds) {
    for (const folder of ["chrome-win64", "chrome-win"]) {
      const exe = path.join(root, build, folder, "chrome.exe");
      if (fs.existsSync(exe)) return exe;
    }
  }
  throw new Error("No Chromium found; set CHROMIUM");
}

const SHIM = `
  window.GM_info = { script: { version: "e2e" } };
  window.GM_registerMenuCommand = function () {};
  window.unsafeWindow = window;
`;

let passed = 0;
function check(ok, what, detail) {
  if (!ok) throw new Error("FAILED: " + what + (detail !== undefined ? "  " + JSON.stringify(detail) : ""));
  passed += 1;
  console.log("  ok  " + what);
}

const shadow = `
  (() => {
    const host = document.querySelector("[data-pz='instagram-viewer']");
    return host && host.shadowRoot ? host.shadowRoot : null;
  })()
`;

async function overlay(page) {
  return page.evaluate(`(() => {
    const r = ${shadow};
    if (!r) return null;
    const img = r.querySelector("img[data-pz-media]");
    const frame = r.querySelector("iframe");
    const video = r.querySelector("video");
    return {
      text: r.textContent,
      img: img ? img.getAttribute("src") : null,
      frame: frame ? frame.getAttribute("src") : null,
      video: video ? video.getAttribute("src") : null,
      hasToggle: !!r.querySelector("[data-pz-view-toggle]"),
      hasSave: !!r.querySelector("[data-pz-save]"),
    };
  })()`);
}

const waitForOverlay = (page) => page.waitForFunction(
  `(() => { const r = ${shadow}; return !!(r && (r.querySelector("img[data-pz-media]") || r.querySelector("iframe") || r.querySelector("video"))); })()`,
  null, { timeout: 15000 });

const wallUp = (page) => page.evaluate(`!!document.querySelector("#wall.up")`);

async function main() {
  if (!fs.existsSync(DIST)) throw new Error("Build first: npm run build");
  const user = fs.readFileSync(DIST, "utf8");

  const { chromium } = require(PLAYWRIGHT);
  const browser = await chromium.launch({ executablePath: findChromium(), headless: !process.env.HEADED });
  const context = await browser.newContext({ locale: "en-GB", viewport: { width: 1280, height: 1000 } });

  await context.route("**/*", async (route) => {
    const r = routeFor(route.request().url());
    if (r.status === 404) return route.fulfill({ status: 404, body: "no" });
    return route.fulfill({ status: 200, contentType: r.contentType, body: r.body });
  });
  await context.addInitScript({ content: SHIM + "\n" + user });

  const page = await context.newPage();

  try {
    // --- a plain click opens our view, and the wall never goes up ---
    await page.goto(PROFILE, { waitUntil: "domcontentloaded" });
    await page.click("a[data-code='AAphoto1']");
    await waitForOverlay(page);
    let o = await overlay(page);
    check(o.img === POSTS.AAphoto1.img, "a tile click shows the original image", o.img);
    check((await wallUp(page)) === false, "the login wall never goes up");
    check(o.text.includes("first light on the dish"), "the caption is shown");
    check(o.text.includes("fakegram"), "the author is shown");
    check(o.hasSave, "a save button is offered");
    check(o.hasToggle, "the view toggle is offered");

    // --- the toggle swaps to Instagram's own view and back ---
    await page.evaluate(`${shadow}.querySelector("[data-pz-view-toggle]").click()`);
    await page.waitForFunction(`(() => { const r = ${shadow}; return !!(r && r.querySelector("iframe")); })()`, null, { timeout: 10000 });
    o = await overlay(page);
    check(/\/p\/AAphoto1\/embed\/captioned\//.test(o.frame || ""), "the toggle shows Instagram's own view", o.frame);
    await page.evaluate(`${shadow}.querySelector("[data-pz-view-toggle]").click()`);
    await page.waitForFunction(`(() => { const r = ${shadow}; return !!(r && r.querySelector("img[data-pz-media]")); })()`, null, { timeout: 10000 });
    check(true, "the toggle comes back to our view");

    // --- arrow keys step along the grid ---
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(
      `(() => { const r = ${shadow}; const i = r && r.querySelector("img[data-pz-media]"); return i && i.getAttribute("src").includes("photo-two-full"); })()`,
      null, { timeout: 10000 });
    check(true, "ArrowRight steps to the next post");

    // --- Escape closes ---
    await page.keyboard.press("Escape");
    await page.waitForFunction(`!document.querySelector("[data-pz='instagram-viewer']")`, null, { timeout: 10000 });
    check(true, "Escape closes the viewer");

    // --- a carousel opens in Instagram's own view ---
    await page.click("a[data-code='CCcarousel']");
    await waitForOverlay(page);
    o = await overlay(page);
    check(!!o.frame, "a carousel opens in Instagram's own view", o.frame);
    check(/more pictures/i.test(o.text), "and says why", o.text.slice(0, 120));
    await page.keyboard.press("Escape");

    // --- a reel plays ---
    await page.click("a[data-code='DDreel']");
    await waitForOverlay(page);
    o = await overlay(page);
    check(o.video === POSTS.DDreel.video, "a reel yields a playable video", o.video);
    await page.keyboard.press("Escape");

    // --- a ctrl-click is left alone ---
    // Proved by contrast: a plain click on the same tile must open the viewer
    // straight afterwards, so this cannot pass merely because nothing is open.
    await page.goto(PROFILE, { waitUntil: "domcontentloaded" });
    await page.click("a[data-code='AAphoto1']", { modifiers: ["Control"] });
    await page.waitForTimeout(800);
    check((await overlay(page)) === null, "a ctrl-click does not open the viewer");
    check((await wallUp(page)) === true, "and the site's own handler sees it");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.click("a[data-code='AAphoto1']");
    await waitForOverlay(page);
    check((await overlay(page)) !== null, "while a plain click on that same tile does");
    await page.keyboard.press("Escape");

    // --- a post URL opened directly ---
    await page.goto("https://www.instagram.com/p/BBphoto2/", { waitUntil: "domcontentloaded" });
    await waitForOverlay(page);
    o = await overlay(page);
    check(o.img === POSTS.BBphoto2.img, "a direct post URL opens the viewer", o.img);

    console.log(`\n${passed} checks passed.`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("\n" + err.message);
  process.exit(1);
});
