import { describe, it, expect, vi } from "vitest";
import { loadPost } from "../src/lib/instagram/loader.js";

// A stand-in for an iframe. jsdom will not fetch a real one, so the document it
// would have painted is supplied directly and revealed after `paintAfter` polls.
function fakeFrame({ html, paintAfter = 0, href = null, throwOnRead = false }) {
  let polls = 0;
  const frame = {
    style: {},
    setAttribute(k, v) { frame[k] = v; },
    get contentDocument() {
      if (throwOnRead) throw new Error("cross-origin");
      polls += 1;
      if (polls <= paintAfter) return new DOMParser().parseFromString("<html><body></body></html>", "text/html");
      return new DOMParser().parseFromString(html, "text/html");
    },
    get contentWindow() {
      return { location: { href: href || "https://www.instagram.com/p/Abc123/embed/captioned/" } };
    },
    remove: vi.fn(),
  };
  return frame;
}

function fakeDoc(frame) {
  const appended = [];
  return {
    appended,
    createElement: () => frame,
    body: { appendChild: (n) => appended.push(n) },
    documentElement: { appendChild: (n) => appended.push(n) },
  };
}

const PHOTO = `<html><body>
  <img class="EmbeddedMediaImage" src="https://x.cdninstagram.com/v/t51.82787-15/a.jpg">
  <div class="Caption"><span class="CaptionUsername">nasa</span> a caption</div>
  <div class="UsernameText">nasa</div>
</body></html>`;

const ctx = (frame) => ({ doc: fakeDoc(frame), timeoutMs: 1000, pollMs: 1 });

describe("loadPost", () => {
  it("points the frame at the captioned embed", async () => {
    const frame = fakeFrame({ html: PHOTO });
    await loadPost("Abc123", ctx(frame));
    expect(frame.src).toBe("https://www.instagram.com/p/Abc123/embed/captioned/");
  });

  it("mounts the frame offscreen, not in view", async () => {
    const frame = fakeFrame({ html: PHOTO });
    const c = ctx(frame);
    await loadPost("Abc123", c);
    expect(c.doc.appended).toContain(frame);
    expect(frame.style.position).toBe("fixed");
    expect(parseInt(frame.style.width, 10)).toBeGreaterThan(0);
  });

  it("returns the post once the frame paints", async () => {
    const r = await loadPost("Abc123", ctx(fakeFrame({ html: PHOTO })));
    expect(r.ok).toBe(true);
    expect(r.post.media[0].url).toBe("https://x.cdninstagram.com/v/t51.82787-15/a.jpg");
    expect(r.post.author.username).toBe("nasa");
  });

  it("waits through polls where nothing has painted yet", async () => {
    const r = await loadPost("Abc123", ctx(fakeFrame({ html: PHOTO, paintAfter: 4 })));
    expect(r.ok).toBe(true);
  });

  it("takes the frame away again whether it worked or not", async () => {
    const good = fakeFrame({ html: PHOTO });
    await loadPost("Abc123", ctx(good));
    expect(good.remove).toHaveBeenCalled();

    const bad = fakeFrame({ html: "<html><body></body></html>" });
    await loadPost("Abc123", ctx(bad));
    expect(bad.remove).toHaveBeenCalled();
  });

  it("gives up with a reason when nothing ever paints", async () => {
    const r = await loadPost("Abc123", ctx(fakeFrame({ html: "<html><body></body></html>" })));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not available|did not/i);
  });

  it("reports a login redirect", async () => {
    const frame = fakeFrame({ html: "<html><body></body></html>", href: "https://www.instagram.com/accounts/login/?next=/p/Abc123/" });
    const r = await loadPost("Abc123", ctx(frame));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/log ?in/i);
  });

  it("reports rather than throws when the frame cannot be read", async () => {
    const r = await loadPost("Abc123", ctx(fakeFrame({ html: PHOTO, throwOnRead: true })));
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
  });

  it("refuses an empty shortcode without touching the page", async () => {
    const frame = fakeFrame({ html: PHOTO });
    const c = ctx(frame);
    const r = await loadPost("", c);
    expect(r.ok).toBe(false);
    expect(c.doc.appended).toHaveLength(0);
  });
});
