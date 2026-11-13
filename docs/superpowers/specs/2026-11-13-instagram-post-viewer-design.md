# Instagram post viewer

Design, 2026-11-13. For Popup Zapper v2.5.0.

## Intent and why

Instagram now gates every post behind a "See this post / Sign up or log in" box.
A public profile still paints its thumbnail grid for a logged-out visitor, but
clicking any tile raises the wall, and there is nothing hidden underneath it to
reveal: Instagram simply never sends the post to a client without a session.

Param wants to click a tile on a public profile and see the picture properly,
at full resolution, without an account and without being walked to a login page.
He also asked for comments; they are not obtainable, see Non-goals.

The way through is Instagram's own public embed endpoint. A cookie-less fetch of
`https://www.instagram.com/p/<shortcode>/embed/captioned/` on 2026-11-13 returned
the author, the caption, the like and comment counts, and an image URL carrying no
size segment, which is the original upload rather than a resized copy. That is the
material this feature is built from.

## Goals

- Click a grid tile on instagram.com and see that post's media in place, with no
  login, no navigation away, and no wall.
- The same when a post URL is opened directly, whether a link someone sent, a paste
  into the bar, or a refresh on a post page. Param's call, 2026-11-13: the viewer
  takes over there too, so a shared link does not dead-end at the wall.
- Media at its original resolution, with a way to zoom to 1:1 and to save it.
- Caption, author, date and counts where the embed carries them.
- Two presentations, switchable at any moment, so Param can see both and settle on
  the one he prefers: Zapper's own lightbox, and the raw Instagram embed in a frame.
- Degrade rather than die. If the parse fails, the overlay shows the frame instead.

## Non-goals

- **Comments.** Instagram serves none to a logged-out client. The only sources are
  third-party viewer sites running their own logged-in backends; they would route
  Param's browsing through an unknown middleman, they cap free use at roughly the
  first fifteen comments, and they break constantly. Ruled out.
- Commenting, liking, following, saving to an account, or anything else needing one.
- Private accounts, close-friends posts, stories, highlights, direct messages.
- Making a logged-out grid load past Instagram's first batch. Instagram stops
  feeding the grid on scroll and a userscript cannot refill it. The feature works on
  whatever tiles the page has.

## Anti-goals

These would make it a failure even if the pictures appeared.

- Any request to a host other than instagram.com or its CDN.
- Touching, reading or storing Instagram credentials or session state.
- Breaking a logged-in visit. If Param has a session and the site works normally,
  the feature must stay out of his way.
- Degrading Popup Zapper anywhere else. It is one site module, inert off instagram.com.

## Constraints

- Existing userscript: Violentmonkey and Tampermonkey, `@match *://*/*`,
  `@run-at document-start`, `@noframes`. The grants it needs, `GM_xmlhttpRequest`
  and `unsafeWindow`, are already in the header.
- House shape: small ES modules under `src/lib/`, wired from `src/main.js`, vitest
  plus jsdom unit tests, a Chromium e2e against a fake page. Matches `src/lib/batch/`
  and `src/lib/recorder/`.
- Instagram is a single-page app. Tiles are re-rendered constantly and the URL
  changes without a navigation, so binding must be delegated, not one-shot.
- The embed HTML is undocumented and will change without notice. Parsing is
  defensive and the fallback is automatic, never a dead end.
- `@noframes` means the script will not run inside the frame we inject. That is
  wanted: no recursion.

## Approaches

**A. Frame the embed and nothing else.** Catch the tile click, read the shortcode,
drop the embed URL into an overlay frame. Least code and the most durable, because
it is Instagram's own page doing the rendering. But the embed paints the image at
its own modest display width rather than the original, it brings Instagram's chrome
inside the overlay, and its "view all comments" link leads straight back to the wall.

**B. Fetch the embed and render it ourselves.** The script is already on
instagram.com, so it can fetch that URL, pull the original media URL and the caption
out of the response, and paint them into Zapper's own lightbox: true resolution,
zoom, keyboard navigation between tiles, a save button, no Instagram chrome. More
code, and it breaks if Instagram reshuffles the embed markup.

**C. A third-party comment viewer as the source.** The only route that yields
comments. Rejected on privacy and reliability, as above.

**Chosen: B, with A as both the automatic fallback and a view Param can select.**
The fallback costs one branch and buys most of A's durability; offering A as a
selectable view is what lets him compare the two, which he asked for.

## The how, as decided

### Shape

A new `src/lib/instagram/` directory following the `batch/` and `recorder/` pattern:
`shortcode.js` (URL to shortcode), `embed.js` (fetch and parse), `lightbox.js` (the
overlay and its two views), `tool.js` (wiring, state, preference). Wired from
`src/main.js` behind a hostname check, active only when the host is instagram.com.

### Catching the click

A capture-phase click listener on `document`. If the event path holds an anchor whose
href path contains a `/p/`, `/reel/` or `/tv/` segment followed by a shortcode, take
the shortcode, stop the event, and open the viewer. Everything else passes through
untouched. Capture phase is what puts us ahead of Instagram's own handler, so the wall
is never raised rather than being dismissed after the fact.

The segment is matched anywhere in the path, not anchored at its start: Instagram
serves grid tiles as `/<username>/p/<code>/` in places and bare `/p/<code>/` in
others, and an anchored pattern would silently match neither on some pages. Builder
check call, 2026-11-13.

On top of the click path, the same shortcode extraction runs against `location`
at startup and on every history change, so a post opened directly, pasted, shared or
refreshed opens in the viewer as well. One shortcode reader feeds both paths.

### Fetching

`GM_xmlhttpRequest` with `anonymous: true`, not the page's `fetch`. Two reasons: it
cannot be reshaped by Instagram's own fetch wrappers, and `anonymous` guarantees the
request carries no cookies, so it behaves identically whether or not Param is signed
in and his session is never attached to a request he did not make.

### Parsing

From the response, in order of preference:

1. The JSON blob the embed page carries, for media URL, `is_video`, video URL,
   carousel children, caption, owner, timestamp and counts.
2. The `og:image` / `og:video` / `twitter:image` meta tags.
3. The main `<img>`, taking the largest candidate in its `srcset`.

If none of the three yields a media URL, the overlay opens on the frame view and says
why in one line.

### The lightbox

An overlay in a shadow root, so Instagram's stylesheet cannot reach into it. Dark
backdrop; media centred at natural size up to the viewport; click to zoom to 1:1 with
drag; caption, author and date beneath; Esc or a backdrop click to close; left and
right arrows to step to the previous and next tile of the grid; a save button that
downloads the original; a link out to the post on Instagram.

Carousels get dots and in-post arrow keys when the parse yields children. Video and
reels get a `<video controls>` when a video URL is present; where the embed withholds
one, the poster frame is shown with a line saying the video is not available
logged out and the frame view one click away, since the embed will often play what
the parse cannot reach.

### The two views

A small control in the lightbox corner, "Our view / Instagram embed", swapping the
body of the same overlay for a frame of the embed URL. The choice is remembered in
the library under a new `instagram` key and defaults to our view. It is also a row in
Settings and a menu command, so he can flip it without opening a post first.

### Settings and safety

A new "Instagram" section in Settings: the view preference, and an on/off for the
whole feature.

Signed-in detection does **not** use `sessionid`, which Instagram sets HttpOnly and
no userscript can read; an earlier draft of this document had that wrong. It uses
`ds_user_id`, which Instagram sets readable and only while signed in. Builder check
call, 2026-11-13.

The stored shape is `library.instagram = { mode, view }`. `mode` is `"auto"` by
default, meaning active only when `ds_user_id` is absent, so a signed-in visit is
left completely alone; `"on"` forces it even when signed in, `"off"` disables it.
`view` is `"ours"` by default or `"embed"`. Added to `DEFAULT_LIBRARY` without a
`SCHEMA_VERSION` bump: `parseLibrary` spreads the defaults under the stored object,
so an older stored library gains the key rather than being reset. Builder check call.

### Living with the rest of Zapper

Builder check calls, 2026-11-13.

- The viewer obeys the existing per-site switch. If "Toggle zapper (this site)" has
  instagram.com in `disabledDomains`, or the library is off wholesale, the viewer
  stays out. One switch to reach for, not two.
- The overlay's shadow host carries `data-pz`, which `blocker.js` already skips, so
  Zapper's own blocking and cleanup passes cannot eat our lightbox or the frame
  inside it.
- The click listener installs at document-start, ahead of the async library load, but
  until the library and preference have arrived it only records the click and
  defers; it never swallows one it might not be entitled to. A click landing in that
  window opens the viewer once the preference resolves, or passes through if the
  feature turns out to be off.

### Saving the original

`GM_xmlhttpRequest` with `responseType: "blob"` and `anonymous: true`, then a save
from an object URL. A plain `<a download>` is ignored by the browser for a
cross-origin CDN image, and this keeps the header grants as they are rather than
adding `GM_download`. Builder check call, 2026-11-13.

## What is left to the builder

- The exact key path in the embed response, and the exact selectors. These must be
  discovered against real posts, covering at least a single photo, a carousel, a reel
  and an in-feed video, not guessed from this document.
- Whether `/embed/captioned/` or plain `/embed/` carries more for video; use whichever
  does, per post kind if they differ.
- Visual detail of the lightbox within Zapper's existing panel styling.
- Where the ordered tile list for the previous/next arrows comes from, and how it
  copes with the grid re-rendering under it.
- Tests: vitest for shortcode extraction, for embed parsing against saved fixture
  HTML of each post kind, and for the view preference round-tripping through storage;
  a Chromium e2e against a fake instagram-like page carrying a login dialog and an
  embed endpoint, in the shape of the existing `e2e:batch` and `e2e:recorder` runs.
- How a failed fetch is reported: an HTTP 429 or a redirect to login drops to the
  frame view with a one-line reason rather than an empty overlay.

## Fixtures

The parser is written against real embed markup, not guesswork. Param's call,
2026-11-13: he captures the fixtures, since this session's shell has no network
access. The first task of the plan is therefore to hand him one short command that
saves four embed pages into the repo's test fixtures, one each for a single photo, a
carousel, a reel and an in-feed video, from public accounts. Parser work starts once
those land.

## Release

v2.5.0. Manual minor bump rather than the `release` script, which does a patch bump
and pushes; build so the tracked `dist/popup-zapper.user.js` is regenerated
(`git add -f`, it is gitignored but tracked), tag locally, and leave the push to
Param, as with every release since v2.1.1.
