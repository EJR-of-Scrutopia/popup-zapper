# Instagram Post Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On instagram.com, open a public post's media at original resolution in an overlay, with no login, instead of Instagram's "See this post" wall.

**Architecture:** A new site module `src/lib/instagram/`, inert off instagram.com, wired from `src/main.js`. A capture-phase click listener takes a tile's shortcode before Instagram's own handler runs; the same shortcode reader also runs against `location` at startup and on history changes. The module fetches that post's public embed page cookie-free through `GM_xmlhttpRequest`, parses the media URL and caption out of it, and paints them into a shadow-root lightbox. A corner control swaps the same overlay for a frame of the embed URL, which is also the automatic fallback when parsing yields no media.

**Tech Stack:** Plain ES modules, esbuild bundle, vitest + jsdom, playwright-core for e2e (borrowed exe as in the existing e2e runs), Violentmonkey/Tampermonkey GM APIs.

**Spec:** `docs/superpowers/specs/2026-11-13-instagram-post-viewer-design.md`

## Global Constraints

- Host gate: the module does nothing unless `location.hostname.replace(/^www\./,"")` is `instagram.com`.
- No request to any host other than instagram.com or its CDN. No third-party viewer services.
- All network calls use `GM_xmlhttpRequest` with `anonymous: true`. Never the page's `fetch`.
- Signed-in detection reads the `ds_user_id` cookie. Never `sessionid`, which is HttpOnly.
- Default mode is `"auto"`: active only when `ds_user_id` is absent.
- The viewer is off whenever the library is off or `instagram.com` is in `library.disabledDomains`.
- The overlay's shadow host carries a `data-pz` attribute so `blocker.js` skips it.
- `library.instagram = { mode, view }` goes into `DEFAULT_LIBRARY` with **no** `SCHEMA_VERSION` bump.
- House style: small focused ES modules under `src/lib/instagram/`, one vitest file per module in `tests/`, named `instagram-<module>.test.js`.
- British English in all user-facing copy. No em dashes.

## Review Focus

Five things the spec implies that no task's happy path exercises. Each has its test pinned to the task that owns the code.

1. **Modifier and middle clicks must pass through.** Ctrl, Cmd, Shift or middle-button on a tile means "open in a new tab" and must not be swallowed by the viewer. Pinned to Task 9.
2. **A private, deleted or age-gated post** returns an embed page with no media. The overlay must say so in one line and offer the frame view, never hang on an empty box. Pinned to Task 4 (parse returns `null`) and Task 6 (the overlay's empty state).
3. **The grid re-renders under an open lightbox.** Instagram replaces tile nodes as you scroll, so the stored previous/next list goes stale. Stepping must skip detached nodes rather than throw. Pinned to Task 9.
4. **A 429 or a redirect to the login page** from fetching the embed, likely when arrowing quickly through a grid. Must drop to the frame view with a one-line reason. Pinned to Task 5.
5. **A signed-in visit under the default mode** must leave the page completely alone: no listener effect, no overlay, the click reaches Instagram. Pinned to Task 3 and re-checked in Task 9.

---

### Task 1: Capture the embed fixtures

The parser is written against real markup. This session's shell has no network, so Param runs the capture. Everything downstream of Task 4 depends on these four files existing.

**Files:**
- Create: `tools/capture-ig-fixtures.mjs`
- Create (by running it): `tests/fixtures/instagram/photo.html`, `carousel.html`, `reel.html`, `video.html`

**Interfaces:**
- Produces: four fixture HTML files, read by Tasks 4 and 5.

- [ ] **Step 1: Write `tools/capture-ig-fixtures.mjs`**

A node script, no dependencies, run as `node tools/capture-ig-fixtures.mjs photo=<url> carousel=<url> reel=<url> video=<url>`. For each `name=url` pair it extracts the shortcode with the same pattern as Task 2, fetches `https://www.instagram.com/p/<code>/embed/captioned/` with a desktop browser `User-Agent` and no cookies, and writes the body to `tests/fixtures/instagram/<name>.html`. It prints the byte count per file and exits non-zero if any response is not 200 or is under 1 KB.

- [ ] **Step 2: Hand Param the command and wait**

He supplies four public post URLs, one per kind. Do not write fixtures by hand and do not proceed to Task 4 without them.

- [ ] **Step 3: Verify the four files exist and each is over 1 KB**

Run: `node -e "for(const n of ['photo','carousel','reel','video']){const s=require('fs').statSync('tests/fixtures/instagram/'+n+'.html');console.log(n,s.size)}"`
Expected: four lines, each size over 1024.

- [ ] **Step 4: Commit**

```bash
git add tools/capture-ig-fixtures.mjs tests/fixtures/instagram/
git commit -m "test(instagram): capture embed fixtures for the four post kinds"
```

---

### Task 2: Shortcode extraction

**Files:**
- Create: `src/lib/instagram/shortcode.js`
- Test: `tests/instagram-shortcode.test.js`

**Interfaces:**
- Produces:
  - `shortcodeFromPath(path: string) -> string | null`
  - `shortcodeFromAnchor(el: Element | null) -> string | null` — walks up to the nearest `<a href>`, then defers to `shortcodeFromPath`.
  - `embedUrl(shortcode: string) -> string` — returns `https://www.instagram.com/p/<code>/embed/captioned/`.

- [ ] **Step 1: Write the failing tests**

```js
describe("shortcodeFromPath", () => {
  it("takes a bare post path", () => expect(shortcodeFromPath("/p/BsOGulcndj-/")).toBe("BsOGulcndj-"));
  it("takes a username-prefixed post path", () => expect(shortcodeFromPath("/lucyhcraig/p/C1x_yZ2a/")).toBe("C1x_yZ2a"));
  it("takes a reel path", () => expect(shortcodeFromPath("/reel/C9aB-cD_e/")).toBe("C9aB-cD_e"));
  it("takes a tv path", () => expect(shortcodeFromPath("/tv/Abc123/")).toBe("Abc123"));
  it("ignores a profile path", () => expect(shortcodeFromPath("/lucyhcraig/")).toBe(null));
  it("ignores an explore path with no shortcode", () => expect(shortcodeFromPath("/explore/tags/cats/")).toBe(null));
  it("ignores an empty shortcode", () => expect(shortcodeFromPath("/p//")).toBe(null));
});
```

Plus, for `shortcodeFromAnchor`: a click target nested inside a tile anchor returns the anchor's shortcode; a target under an anchor to `/accounts/login/` returns `null`; a `null` target returns `null`.

And for `embedUrl`: `embedUrl("Abc123")` is `"https://www.instagram.com/p/Abc123/embed/captioned/"`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/instagram-shortcode.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the three functions in `src/lib/instagram/shortcode.js`**

The path pattern matches a `/p/`, `/reel/` or `/tv/` segment anywhere in the path, followed by one or more of `[A-Za-z0-9_-]`. Anchored-at-start would miss `/<username>/p/<code>/`, which is the point of the loosening.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/instagram-shortcode.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/instagram/shortcode.js tests/instagram-shortcode.test.js
git commit -m "feat(instagram): read a post shortcode from a path or an anchor"
```

---

### Task 3: Preferences and the active check

**Files:**
- Create: `src/lib/instagram/prefs.js`
- Modify: `src/lib/storage.js` (add `instagram` to `DEFAULT_LIBRARY`)
- Test: `tests/instagram-prefs.test.js`

**Interfaces:**
- Produces:
  - `DEFAULT_INSTAGRAM = { mode: "auto", view: "ours" }`
  - `readPrefs(library) -> { mode, view }` — fills missing keys from the default.
  - `writePrefs(library, patch) -> library` — merges and returns the same library object.
  - `isSignedIn(cookieString) -> boolean` — true when a `ds_user_id` cookie is present and non-empty.
  - `isActive({ library, hostname, cookie }) -> boolean`

- [ ] **Step 1: Write the failing tests**

```js
it("is off away from instagram", () => expect(isActive({library: lib(), hostname: "example.com", cookie: ""})).toBe(false));
it("is on when signed out under auto", () => expect(isActive({library: lib(), hostname: "instagram.com", cookie: "csrftoken=x"})).toBe(true));
it("is off when signed in under auto", () => expect(isActive({library: lib(), hostname: "instagram.com", cookie: "ds_user_id=123; csrftoken=x"})).toBe(false));
it("ignores an empty ds_user_id", () => expect(isSignedIn("ds_user_id=; a=b")).toBe(false));
it("does not match a lookalike cookie name", () => expect(isSignedIn("not_ds_user_id=123")).toBe(false));
it("is on when signed in under mode on", () => expect(isActive({library: lib({mode: "on"}), hostname: "instagram.com", cookie: "ds_user_id=123"})).toBe(true));
it("is off under mode off", () => expect(isActive({library: lib({mode: "off"}), hostname: "instagram.com", cookie: ""})).toBe(false));
it("is off when the library is disabled", () => ...library.enabled false...);
it("is off when instagram is in disabledDomains", () => ...);
it("defaults a library with no instagram key", () => expect(readPrefs({})).toEqual({mode: "auto", view: "ours"}));
```

Plus a `storage.test.js` addition: `parseLibrary(JSON.stringify({version: 1, enabled: true}))` returns an object whose `instagram` equals the default, proving an older stored library gains the key rather than being reset.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/instagram-prefs.test.js tests/storage.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/instagram/prefs.js` and add `instagram: { mode: "auto", view: "ours" }` to `DEFAULT_LIBRARY`**

`isSignedIn` must match the cookie name at a boundary, not as a substring. Do not touch `SCHEMA_VERSION`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/instagram-prefs.test.js tests/storage.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/instagram/prefs.js src/lib/storage.js tests/instagram-prefs.test.js tests/storage.test.js
git commit -m "feat(instagram): view preference, mode, and the active check"
```

---

### Task 4: Parse the embed page

**Files:**
- Create: `src/lib/instagram/embed.js`
- Test: `tests/instagram-embed.test.js`

**Interfaces:**
- Consumes: the fixtures from Task 1.
- Produces: `parseEmbed(html: string) -> Post | null`, where

```js
Post = {
  shortcode: string | null,
  kind: "photo" | "video" | "carousel",
  media: [{ type: "image" | "video", url: string | null, poster: string | null, width: number | null, height: number | null, index: number }],
  caption: string,
  author: { username: string, name: string, avatar: string | null },
  timestamp: string | null,
  likes: number | null,
  comments: number | null,
  source: "json" | "meta" | "img",
}
```

`null` when no media URL can be found by any of the three routes. `media` is never empty when a Post is returned.

- [ ] **Step 1: Read the four fixtures and find the real key paths**

Before writing tests, open each fixture and locate the JSON blob, the meta tags and the main image. Write down in the test file's header comment which key path each field came from, per kind. The spec deliberately leaves these to be discovered, not guessed.

- [ ] **Step 2: Write the failing tests**

One `describe` per fixture. For `photo.html`: `kind` is `"photo"`, `media` has length 1 and `media[0].type` is `"image"`, `media[0].url` starts with `"https://"` and contains no `/s\d+x\d+/` size segment, `caption` is non-empty, `author.username` is non-empty, `source` is `"json"`.

For `carousel.html`: `kind` is `"carousel"` and `media.length` is greater than 1.
For `reel.html` and `video.html`: `kind` is `"video"` and `media[0]` is either a `"video"` with a URL or an `"image"` poster frame, asserted as whichever the fixture actually carries.

Fallback and failure tests, from hand-written minimal HTML rather than fixtures:
```js
it("falls back to og:image when there is no JSON", () => expect(parseEmbed(ogOnlyHtml).source).toBe("meta"));
it("falls back to the largest srcset candidate", () => expect(parseEmbed(imgOnlyHtml).media[0].url).toBe("https://cdn/large.jpg"));
it("returns null for a page with no media", () => expect(parseEmbed("<html><body>Sorry, this page isn't available.</body></html>")).toBe(null));
it("returns null for an empty string", () => expect(parseEmbed("")).toBe(null));
it("does not throw on malformed JSON in the blob", () => expect(() => parseEmbed(brokenJsonHtml)).not.toThrow());
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/instagram-embed.test.js`
Expected: FAIL.

- [ ] **Step 4: Implement `parseEmbed` in `src/lib/instagram/embed.js`**

Three routes tried in order, each wrapped so a throw falls through to the next rather than out of the function: the embed's JSON blob, then `og:`/`twitter:` meta tags, then the main `<img>` taking the largest `srcset` candidate. Parse with `DOMParser` where a DOM helps; the module must work under jsdom.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/instagram-embed.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/instagram/embed.js tests/instagram-embed.test.js
git commit -m "feat(instagram): parse media, caption and author out of an embed page"
```

---

### Task 5: Fetch the embed

**Files:**
- Modify: `src/lib/instagram/embed.js`
- Test: `tests/instagram-embed.test.js`

**Interfaces:**
- Produces: `fetchPost(shortcode, { gmXhr }) -> Promise<{ ok: true, post: Post } | { ok: false, reason: string }>`

`reason` is one short British-English sentence for the overlay to show. `gmXhr` is the `GM_xmlhttpRequest`-shaped function, injected so tests can fake it.

- [ ] **Step 1: Write the failing tests**

```js
it("requests the embed URL anonymously", async () => {
  const gmXhr = fake(200, photoFixture);
  await fetchPost("Abc123", { gmXhr });
  expect(gmXhr.mock.calls[0][0].url).toBe("https://www.instagram.com/p/Abc123/embed/captioned/");
  expect(gmXhr.mock.calls[0][0].anonymous).toBe(true);
});
it("returns the parsed post on 200", async () => expect((await fetchPost("Abc123", {gmXhr: fake(200, photoFixture)})).ok).toBe(true));
it("reports rate limiting on 429", async () => {
  const r = await fetchPost("Abc123", { gmXhr: fake(429, "") });
  expect(r).toEqual({ ok: false, reason: "Instagram is rate limiting us. Try again in a moment." });
});
it("reports a login redirect", async () => {
  const r = await fetchPost("Abc123", { gmXhr: fake(200, "", "https://www.instagram.com/accounts/login/") });
  expect(r.ok).toBe(false);
  expect(r.reason).toMatch(/login/i);
});
it("reports an unavailable post when the parse finds nothing", async () => {
  const r = await fetchPost("Abc123", { gmXhr: fake(200, "<html><body>not available</body></html>") });
  expect(r.ok).toBe(false);
  expect(r.reason).toMatch(/not available/i);
});
it("reports a network error without throwing", async () => expect((await fetchPost("Abc123", {gmXhr: failingXhr})).ok).toBe(false));
```

The fake's third argument is `finalUrl`, which is how a login redirect is detected.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/instagram-embed.test.js`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement `fetchPost`**

Wrap `gmXhr` in a promise; never let a rejection escape. A `finalUrl` containing `/accounts/login` counts as a failure whatever the status.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/instagram-embed.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/instagram/embed.js tests/instagram-embed.test.js
git commit -m "feat(instagram): fetch an embed page cookie-free, with reasons for failure"
```

---

### Task 6: The lightbox, our view

**Files:**
- Create: `src/lib/instagram/lightbox.js`
- Test: `tests/instagram-lightbox.test.js`

**Interfaces:**
- Produces: `createLightbox({ doc, onClose, onStep, onSave, onViewChange }) -> { open, showPost, showMessage, showFrame, close, isOpen, el }`
  - `open()` mounts the shadow host; `showPost(post, { view })` renders; `showMessage(reason, { shortcode })` renders the one-line failure state with a "Show Instagram's own view" button; `close()` unmounts.
  - `onStep(direction: -1 | 1)`, `onSave(mediaItem)`, `onViewChange(view: "ours" | "embed")` are callbacks; the lightbox owns no fetching and no preferences.

- [ ] **Step 1: Write the failing tests**

Under jsdom:
```js
it("mounts a shadow host carrying data-pz", () => { lb.open(); expect(doc.querySelector("[data-pz]").shadowRoot).toBeTruthy(); });
it("renders the image at its original URL", () => { lb.open(); lb.showPost(photoPost, {view:"ours"}); expect(img().src).toBe(photoPost.media[0].url); });
it("renders the caption and author", () => ...);
it("renders a video element for a video post", () => ...);
it("shows the poster and a line when a video carries no URL", () => {
  lb.showPost(posterOnlyPost, {view:"ours"});
  expect(img().src).toBe(posterOnlyPost.media[0].poster);
  expect(text()).toMatch(/not available/i);
  expect(frameButton()).toBeTruthy();
});
it("renders carousel dots matching the child count", () => expect(dots().length).toBe(carouselPost.media.length));
it("closes on Escape", () => { press("Escape"); expect(onClose).toHaveBeenCalled(); });
it("closes on a backdrop click but not on a click on the image", () => ...);
it("calls onStep(1) on ArrowRight and onStep(-1) on ArrowLeft", () => ...);
it("steps within a carousel before stepping to the next post", () => ...);
it("shows the reason and a frame button in showMessage", () => { lb.showMessage("Instagram is rate limiting us. Try again in a moment."); expect(text()).toContain("rate limiting"); expect(frameButton()).toBeTruthy(); });
it("renders no media node in showMessage", () => expect(img()).toBe(null));
```

Review Focus 2 is the `showMessage` pair: a post with no media never leaves an empty box.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/instagram-lightbox.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `createLightbox`**

A shadow root so Instagram's stylesheet cannot reach in. Styling follows the existing panel look in `src/lib/ui.js`; read it before writing the CSS rather than inventing a second visual language. Keyboard listeners are bound on open and removed on close.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/instagram-lightbox.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/instagram/lightbox.js tests/instagram-lightbox.test.js
git commit -m "feat(instagram): a shadow-root lightbox for a parsed post"
```

---

### Task 7: The second view and the toggle

**Files:**
- Modify: `src/lib/instagram/lightbox.js`
- Test: `tests/instagram-lightbox.test.js`

- [ ] **Step 1: Write the failing tests**

```js
it("renders an iframe of the embed URL in the embed view", () => {
  lb.showPost(photoPost, { view: "embed" });
  expect(frame().src).toBe("https://www.instagram.com/p/" + photoPost.shortcode + "/embed/captioned/");
});
it("shows a view toggle in both views", () => ...);
it("calls onViewChange with the other view when the toggle is pressed", () => ...);
it("swaps the body without closing the overlay", () => { const host = lb.el; toggle(); expect(lb.el).toBe(host); expect(lb.isOpen()).toBe(true); });
it("shows the frame when showMessage's frame button is pressed", () => ...);
it("zooms to 1:1 on an image click and back on a second click", () => ...);
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/instagram-lightbox.test.js`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement the embed view, the corner toggle, and click-to-zoom**

The frame is built with the same `embedUrl` from Task 2, not a second copy of that string.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/instagram-lightbox.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/instagram/lightbox.js tests/instagram-lightbox.test.js
git commit -m "feat(instagram): switch the overlay between our view and Instagram's embed"
```

---

### Task 8: Save the original

**Files:**
- Create: `src/lib/instagram/save.js`
- Test: `tests/instagram-save.test.js`

**Interfaces:**
- Produces: `saveMedia(item, { shortcode, gmXhr, doc }) -> Promise<{ ok: boolean, reason?: string }>` and `fileNameFor(item, shortcode) -> string`.

- [ ] **Step 1: Write the failing tests**

```js
it("names a photo by shortcode and extension", () => expect(fileNameFor({url:"https://cdn/x/abc.jpg?efg=1", type:"image"}, "Abc123")).toBe("instagram-Abc123.jpg"));
it("numbers carousel children", () => expect(fileNameFor({url:"https://cdn/x/abc.jpg", type:"image", index:2}, "Abc123")).toBe("instagram-Abc123-2.jpg"));
it("defaults the extension to jpg for an image with none", () => ...);
it("defaults to mp4 for a video with none", () => ...);
it("requests the media as an anonymous blob", async () => { await saveMedia(item, ctx); expect(ctx.gmXhr.mock.calls[0][0].responseType).toBe("blob"); expect(ctx.gmXhr.mock.calls[0][0].anonymous).toBe(true); });
it("revokes the object URL afterwards", async () => { await saveMedia(item, ctx); expect(revoke).toHaveBeenCalled(); });
it("returns a reason rather than throwing on failure", async () => expect((await saveMedia(item, {...ctx, gmXhr: failingXhr})).ok).toBe(false));
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/instagram-save.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `saveMedia` and `fileNameFor`**

Blob through `gmXhr`, object URL, a synthetic anchor click, then revoke in a `finally`. No new header grant.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/instagram-save.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/instagram/save.js tests/instagram-save.test.js
git commit -m "feat(instagram): save the original media through an anonymous blob fetch"
```

---

### Task 9: The tool, click capture and location watching

**Files:**
- Create: `src/lib/instagram/tool.js`
- Test: `tests/instagram-tool.test.js`

**Interfaces:**
- Consumes: Tasks 2, 3, 4, 5, 6, 7, 8.
- Produces: `createInstagramTool({ doc, win, library, gmXhr, getCookie, saveLibrary }) -> { start, stop, openShortcode, isActive }`

`start()` installs a capture-phase `click` listener on `doc` and a history watcher on `win`; both are removed by `stop()`.

- [ ] **Step 1: Write the failing tests**

```js
it("swallows a plain left click on a tile and opens the viewer", () => { click(tile); expect(ev.defaultPrevented).toBe(true); expect(overlayShown()).toBe(true); });
it("lets a ctrl-click through", () => { click(tile, {ctrlKey: true}); expect(ev.defaultPrevented).toBe(false); });
it("lets a meta-click, a shift-click and a middle click through", () => ...);
it("lets a click on a non-post link through", () => ...);
it("does nothing at all when signed in under auto", () => { cookie = "ds_user_id=1"; click(tile); expect(ev.defaultPrevented).toBe(false); expect(overlayShown()).toBe(false); });
it("opens the viewer for a post URL present at start", () => { location = "/p/Abc123/"; tool.start(); expect(openShortcode).toHaveBeenCalledWith("Abc123"); });
it("opens the viewer on a history change to a post URL", () => ...);
it("does not reopen for the same shortcode twice in a row", () => ...);
it("defers a click that lands before the preference resolves, then opens", async () => ...);
it("passes a deferred click through when the feature resolves to off", async () => ...);
it("skips detached tiles when stepping", () => { grid.removeChild(tiles[1]); step(1); expect(opened).toBe(shortcodeOf(tiles[2])); });
it("stops stepping at the end of the grid rather than throwing", () => ...);
it("shows the failure message when fetchPost reports a reason", async () => ...);
it("honours the stored view preference when opening", () => ...);
it("writes the preference when the lightbox toggles the view", () => ...);
```

Review Focus 1, 3 and 5 live here.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/instagram-tool.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `createInstagramTool`**

The listener installs immediately at document-start; until the library has resolved it records the pending click, prevents the default, and either opens or replays the navigation once the answer arrives. The tile order for stepping is read fresh from the DOM at each step, not cached at open, which is what makes a re-rendered grid harmless.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/instagram-tool.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/instagram/tool.js tests/instagram-tool.test.js
git commit -m "feat(instagram): catch tile clicks and direct post URLs, and drive the viewer"
```

---

### Task 10: Wire into main and Settings

**Files:**
- Modify: `src/main.js`
- Modify: `src/lib/ui.js`
- Test: `tests/ui.test.js`

- [ ] **Step 1: Write the failing tests**

In `tests/ui.test.js`: the settings panel renders an "Instagram" section with a mode control offering auto, on and off, and a view control offering our view and Instagram's embed; changing either calls the settings `onChange` with the new `instagram` value.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/ui.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement the Settings section and the `main.js` wiring**

In `main.js`: import `createInstagramTool`, construct it after the library resolves, call `start()`. Register a `GM_registerMenuCommand("Instagram view")` that flips `view` between the two and reports the new value in the status strip, alongside the existing commands near line 474.

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS, with the new instagram files included and no existing test broken.

- [ ] **Step 5: Commit**

```bash
git add src/main.js src/lib/ui.js tests/ui.test.js
git commit -m "feat(instagram): wire the viewer into boot, Settings and the menu"
```

---

### Task 11: End-to-end against a fake Instagram

**Files:**
- Create: `e2e/instagram-site.cjs`
- Create: `e2e/instagram.e2e.cjs`
- Modify: `package.json` (add `"e2e:instagram": "node e2e/instagram.e2e.cjs"`)

- [ ] **Step 1: Build the fake site**

`instagram-site.cjs` serves a profile page with a grid of tile anchors, a login dialog that the page's own click handler raises for any tile, and an `/p/<code>/embed/captioned/` route returning the Task 1 fixtures. Follow the shape of `e2e/recorder-site.cjs`, which already does the two-origin server dance; this one needs a single origin.

- [ ] **Step 2: Write the e2e run**

`instagram.e2e.cjs` loads the built userscript into a Chromium page, in the pattern of `e2e/batch.e2e.cjs`, borrowing playwright-core and the Chromium 1243 executable the existing runs use. It asserts: clicking a tile shows the overlay and never the site's login dialog; the image in the overlay has the fixture's original URL; the view toggle swaps to an iframe and back; Escape closes; a ctrl-click does not open the overlay; loading `/p/<code>/` directly opens the overlay on load.

- [ ] **Step 3: Run it**

Run: `npm run e2e:instagram`
Expected: PASS, all assertions reported.

- [ ] **Step 4: Commit**

```bash
git add e2e/instagram-site.cjs e2e/instagram.e2e.cjs package.json
git commit -m "test(instagram): chromium e2e against a fake instagram with a login wall"
```

---

### Task 12: Release v2.5.0

**Files:**
- Modify: `package.json`, `package-lock.json`, `dist/popup-zapper.user.js`

- [ ] **Step 1: Bump to 2.5.0 by hand**

Run: `npm version minor --no-git-tag-version`
Not `npm run release`, which does a patch bump and pushes.

- [ ] **Step 2: Build and confirm the version landed in the header**

Run: `npm run build && grep -m1 "@version" dist/popup-zapper.user.js`
Expected: `// @version      2.5.0`.

- [ ] **Step 3: Run everything once more**

Run: `npm test && npm run e2e:instagram && npm run e2e:batch && npm run e2e:recorder`
Expected: all PASS.

- [ ] **Step 4: Commit and tag locally**

```bash
git add -f dist/popup-zapper.user.js
git add package.json package-lock.json
git commit -m "chore(release): v2.5.0, see Instagram posts without a login"
git tag -a v2.5.0 -m "v2.5.0"
```

`dist/` is gitignored but the built file is tracked, so it needs `-f`.

- [ ] **Step 5: Stop. Param pushes.**

Do not push. Tell him the command: `git -C "C:\dev\VS code\Random\popup-zapper" push origin master --follow-tags`.
