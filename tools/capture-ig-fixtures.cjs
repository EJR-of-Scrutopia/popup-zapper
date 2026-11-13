// Save RENDERED Instagram embed pages as test fixtures.
//
//   node tools/capture-ig-fixtures.cjs "photo=<url>" "carousel=<url>" "reel=<url>" "video=<url>"
//
// Why rendered and not fetched: the embed page ships as a boot script and paints
// the post from a later call of its own, so its raw HTML holds no media at all.
// A plain fetch saves a 518 KB shell. This opens each embed in Chromium with no
// cookies, waits for the post to appear, and saves the DOM as it then stands,
// which is what src/lib/instagram/ reads at runtime.
//
// Each <url> is any public Instagram post link. Nothing here logs in, and the
// embed endpoint only ever answers for a public post.
//
// Paths: PLAYWRIGHT_CORE and CHROMIUM override the defaults, as in e2e/.

const fs = require("fs");
const path = require("path");

const PLAYWRIGHT = process.env.PLAYWRIGHT_CORE
  || "C:/dev/VS code/models/partical simulation/SandboxScience/node_modules/playwright-core";
const OUT_DIR = path.join(__dirname, "..", "tests", "fixtures", "instagram");
const MIN_BYTES = 1024;

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

async function capture(page, name, postUrl) {
  const code = shortcodeOf(postUrl);
  if (!code) throw new Error(`${name}: no shortcode in ${postUrl}`);

  const res = await page.goto(embedUrl(code), { waitUntil: "domcontentloaded", timeout: 45000 });
  if (res && res.status() !== 200) throw new Error(`${name}: HTTP ${res.status()} for ${code}`);
  if (/\/accounts\/login/.test(page.url())) throw new Error(`${name}: redirected to login for ${code}`);

  // The post is painted once the media node carries a real CDN source.
  await page.waitForFunction(() => {
    const m = document.querySelector("img[src*='cdninstagram'], img[src*='fbcdn'], video[src], video source[src]");
    return !!m;
  }, null, { timeout: 45000 }).catch(() => {
    throw new Error(`${name}: no media appeared for ${code} within 45 s`);
  });

  // Let a carousel's later children and the caption settle.
  await page.waitForTimeout(2500);

  const html = await page.content();
  if (html.length < MIN_BYTES) throw new Error(`${name}: only ${html.length} bytes for ${code}`);

  const file = path.join(OUT_DIR, `${name}.html`);
  fs.writeFileSync(file, html, "utf8");

  const seen = await page.evaluate(() => ({
    imgs: [...document.querySelectorAll("img")].map((i) => i.currentSrc || i.src).filter((s) => /cdninstagram|fbcdn/.test(s)).length,
    videos: document.querySelectorAll("video").length,
  }));
  console.log(`${name.padEnd(9)} ${code.padEnd(14)} ${html.length} bytes, ${seen.imgs} media image(s), ${seen.videos} video(s)`);
  return seen;
}

async function main() {
  const pairs = process.argv.slice(2).map((arg) => {
    const at = arg.indexOf("=");
    if (at < 1) throw new Error(`expected name=url, got: ${arg}`);
    return [arg.slice(0, at), arg.slice(at + 1)];
  });

  if (!pairs.length) {
    console.error('usage: node tools/capture-ig-fixtures.cjs "photo=<url>" "carousel=<url>" "reel=<url>" "video=<url>"');
    process.exit(2);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const { chromium } = require(PLAYWRIGHT);
  const browser = await chromium.launch({ executablePath: findChromium(), headless: !process.env.HEADED });
  const context = await browser.newContext({ locale: "en-GB", viewport: { width: 1280, height: 1200 } });
  const page = await context.newPage();

  const failures = [];
  for (const [name, url] of pairs) {
    try {
      await capture(page, name, url);
    } catch (err) {
      failures.push(err.message);
      console.error(`FAILED ${err.message}`);
    }
  }

  await browser.close();

  if (failures.length) process.exit(1);
  console.log(`\n${pairs.length} fixture(s) saved to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
