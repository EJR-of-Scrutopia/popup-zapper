// Save RENDERED Instagram embed pages as test fixtures.
//
//   node tools/capture-ig-fixtures.cjs https://www.instagram.com/nasa/
//   node tools/capture-ig-fixtures.cjs "photo=<post url>" "reel=<post url>" ...
//
// Given a PROFILE url it does the finding itself: opens the grid logged out,
// reads the tile links, works out each tile's kind from its grid icon, and
// captures one photo, one carousel, one reel and one video. Given name=url
// pairs it captures exactly those.
//
// Why rendered and not fetched: the embed page ships as a boot script and paints
// the post from a later call of its own, so its raw HTML holds no media at all.
// A plain fetch saves a 518 KB shell. This opens each embed in Chromium with no
// cookies, waits for the post to appear, and saves the DOM as it then stands,
// which is what src/lib/instagram/ reads at runtime.
//
// Nothing here logs in, and the embed endpoint only ever answers for a public
// post.
//
// Paths: PLAYWRIGHT_CORE and CHROMIUM override the defaults, as in e2e/.
// HEADED=1 shows the browser.

const fs = require("fs");
const path = require("path");

const PLAYWRIGHT = process.env.PLAYWRIGHT_CORE
  || "C:/dev/VS code/models/partical simulation/SandboxScience/node_modules/playwright-core";
const OUT_DIR = path.join(__dirname, "..", "tests", "fixtures", "instagram");
const MIN_BYTES = 1024;
const WANTED = ["photo", "carousel", "reel", "video"];
const MAX_TILES = 24;

// Must stay in step with src/lib/instagram/shortcode.js.
const SHORTCODE = /\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/;

function findChromium() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const root = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  const builds = fs.readdirSync(root)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const build of builds) {
    for (const folder of ["chrome-win64", "chrome-win"]) {
      const exe = path.join(root, build, folder, "chrome.exe");
      if (fs.existsSync(exe)) return exe;
    }
  }
  throw new Error("No Chromium found; set CHROMIUM");
}

function shortcodeOf(url) {
  const m = SHORTCODE.exec(String(url));
  return m ? m[1] : null;
}

function embedUrl(code) {
  return `https://www.instagram.com/p/${code}/embed/captioned/`;
}

// Read the grid's tiles and guess each one's kind from its icon. Instagram
// labels the overlay svg: "Carousel", "Reel"/"Clip", "Video". No icon = photo.
async function tilesOnProfile(page, profileUrl) {
  await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector("a[href*='/p/'], a[href*='/reel/']", { timeout: 45000 });
  await page.waitForTimeout(2000);

  return page.evaluate(() => {
    const out = [];
    const seen = new Set();
    for (const a of document.querySelectorAll("a[href*='/p/'], a[href*='/reel/'], a[href*='/tv/']")) {
      const href = a.getAttribute("href");
      if (!href || seen.has(href)) continue;
      seen.add(href);
      const labels = [...a.querySelectorAll("svg[aria-label]")].map((s) => s.getAttribute("aria-label").toLowerCase());
      const label = labels.join(" ");
      let kind = "photo";
      if (/carousel/.test(label)) kind = "carousel";
      else if (/reel|clip/.test(label) || /\/reel\//.test(href)) kind = "reel";
      else if (/video/.test(label)) kind = "video";
      out.push({ href, kind, labels });
    }
    return out;
  });
}

async function capture(page, name, postUrl) {
  const code = shortcodeOf(postUrl);
  if (!code) throw new Error(`${name}: no shortcode in ${postUrl}`);

  const res = await page.goto(embedUrl(code), { waitUntil: "domcontentloaded", timeout: 45000 });
  if (res && res.status() !== 200) throw new Error(`${name}: HTTP ${res.status()} for ${code}`);
  if (/\/accounts\/login/.test(page.url())) throw new Error(`${name}: redirected to login for ${code}`);

  await page.waitForFunction(() => {
    return !!document.querySelector("img[src*='cdninstagram'], img[src*='fbcdn'], video[src], video source[src]");
  }, null, { timeout: 45000 }).catch(() => {
    throw new Error(`${name}: no media appeared for ${code} within 45 s`);
  });

  await page.waitForTimeout(2500);

  const html = await page.content();
  if (html.length < MIN_BYTES) throw new Error(`${name}: only ${html.length} bytes for ${code}`);

  fs.writeFileSync(path.join(OUT_DIR, `${name}.html`), html, "utf8");

  const seen = await page.evaluate(() => ({
    imgs: [...document.querySelectorAll("img")].map((i) => i.currentSrc || i.src).filter((s) => /cdninstagram|fbcdn/.test(s)).length,
    videos: document.querySelectorAll("video").length,
  }));
  console.log(`  saved ${name.padEnd(9)} ${code.padEnd(14)} ${html.length} bytes, ${seen.imgs} media image(s), ${seen.videos} video(s)`);
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error("usage: node tools/capture-ig-fixtures.cjs https://www.instagram.com/<public account>/");
    console.error('   or: node tools/capture-ig-fixtures.cjs "photo=<post url>" "carousel=<post url>" ...');
    process.exit(2);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const { chromium } = require(PLAYWRIGHT);
  const browser = await chromium.launch({ executablePath: findChromium(), headless: !process.env.HEADED });
  const context = await browser.newContext({ locale: "en-GB", viewport: { width: 1280, height: 1200 } });
  const page = await context.newPage();

  const failures = [];
  const explicit = args.filter((a) => a.includes("=") && a.indexOf("=") > 0 && !/^https?:/i.test(a));

  try {
    if (explicit.length) {
      for (const arg of explicit) {
        const at = arg.indexOf("=");
        const name = arg.slice(0, at);
        const url = arg.slice(at + 1);
        try { await capture(page, name, url); } catch (e) { failures.push(e.message); console.error(`FAILED ${e.message}`); }
      }
    } else {
      const profile = args[0];
      console.log(`Reading the grid at ${profile}`);
      const tiles = await tilesOnProfile(page, profile);
      console.log(`  ${tiles.length} tile(s): ` + WANTED.map((k) => `${k} ${tiles.filter((t) => t.kind === k).length}`).join(", "));
      if (!tiles.length) throw new Error("no tiles on that profile page; is it public, and did the grid render?");

      for (const want of WANTED) {
        const candidates = tiles.filter((t) => t.kind === want).slice(0, 3);
        if (!candidates.length) {
          failures.push(`${want}: no tile of that kind on this profile`);
          console.error(`FAILED ${want}: no tile of that kind on this profile, try another account`);
          continue;
        }
        let done = false;
        for (const tile of candidates.slice(0, MAX_TILES)) {
          try { await capture(page, want, tile.href); done = true; break; }
          catch (e) { console.error(`  retrying ${want}: ${e.message}`); }
        }
        if (!done) { failures.push(`${want}: every candidate failed`); console.error(`FAILED ${want}: every candidate failed`); }
      }
    }
  } finally {
    await browser.close();
  }

  const saved = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith(".html"));
  console.log(`\n${saved.length} fixture(s) in ${OUT_DIR}: ${saved.join(", ") || "none"}`);
  if (failures.length) process.exit(1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
