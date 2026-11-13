import { describe, it, expect, vi, beforeEach } from "vitest";
import { saveMedia, fileNameFor } from "../src/lib/instagram/save.js";

const item = { type: "image", url: "https://x.cdninstagram.com/v/t51.82787-15/abc.jpg?efg=1", index: 0 };

function okXhr(blob = new Blob(["x"])) {
  return vi.fn((opts) => opts.onload({ status: 200, response: blob }));
}
function failXhr() {
  return vi.fn((opts) => opts.onerror(new Error("network down")));
}
function statusXhr(status) {
  return vi.fn((opts) => opts.onload({ status, response: null }));
}

let ctx, clicked, revoked;
beforeEach(() => {
  clicked = [];
  revoked = [];
  globalThis.URL.createObjectURL = vi.fn(() => "blob:fake");
  globalThis.URL.revokeObjectURL = vi.fn((u) => revoked.push(u));
  const doc = {
    createElement: () => ({
      setAttribute(k, v) { this[k] = v; },
      style: {},
      click() { clicked.push(this.href || this.download); },
      remove() {},
    }),
    body: { appendChild() {}, removeChild() {} },
  };
  ctx = { shortcode: "Abc123", gmXhr: okXhr(), doc };
});

describe("fileNameFor", () => {
  it("names a photo by shortcode and extension, without the query", () => {
    expect(fileNameFor(item, "Abc123")).toBe("instagram-Abc123.jpg");
  });
  it("numbers a carousel child", () => {
    expect(fileNameFor({ ...item, index: 2 }, "Abc123")).toBe("instagram-Abc123-2.jpg");
  });
  it("defaults an extensionless image to jpg", () => {
    expect(fileNameFor({ type: "image", url: "https://x/none", index: 0 }, "Abc")).toBe("instagram-Abc.jpg");
  });
  it("defaults an extensionless video to mp4", () => {
    expect(fileNameFor({ type: "video", url: "https://x/none", index: 0 }, "Abc")).toBe("instagram-Abc.mp4");
  });
  it("keeps a real video extension", () => {
    expect(fileNameFor({ type: "video", url: "https://x/a/clip.mp4?x=1", index: 0 }, "Abc")).toBe("instagram-Abc.mp4");
  });
  it("refuses an odd extension rather than trusting it", () => {
    expect(fileNameFor({ type: "image", url: "https://x/a/evil.php", index: 0 }, "Abc")).toBe("instagram-Abc.jpg");
  });
});

describe("saveMedia", () => {
  it("asks for the media as an anonymous blob", async () => {
    await saveMedia(item, ctx);
    const opts = ctx.gmXhr.mock.calls[0][0];
    expect(opts.url).toBe(item.url);
    expect(opts.responseType).toBe("blob");
    expect(opts.anonymous).toBe(true);
    expect(opts.method).toBe("GET");
  });
  it("reports success", async () => {
    expect(await saveMedia(item, ctx)).toEqual({ ok: true });
  });
  it("clicks a download link", async () => {
    await saveMedia(item, ctx);
    expect(clicked).toHaveLength(1);
  });
  it("revokes the object URL eventually", async () => {
    vi.useFakeTimers();
    const p = saveMedia(item, ctx);
    await vi.advanceTimersByTimeAsync(60000);
    await p;
    expect(revoked).toContain("blob:fake");
    vi.useRealTimers();
  });
  it("gives a reason rather than throwing on a network error", async () => {
    const r = await saveMedia(item, { ...ctx, gmXhr: failXhr() });
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
  });
  it("gives a reason on a bad status", async () => {
    const r = await saveMedia(item, { ...ctx, gmXhr: statusXhr(403) });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/403|could not/i);
  });
  it("revokes the object URL even when the click throws", async () => {
    const doc = { ...ctx.doc, createElement: () => ({ setAttribute() {}, style: {}, click() { throw new Error("boom"); }, remove() {} }) };
    vi.useFakeTimers();
    const p = saveMedia(item, { ...ctx, doc });
    await vi.advanceTimersByTimeAsync(60000);
    const r = await p;
    expect(r.ok).toBe(false);
    expect(revoked).toContain("blob:fake");
    vi.useRealTimers();
  });
  it("refuses an item with no URL", async () => {
    const r = await saveMedia({ type: "video", url: null, index: 0 }, ctx);
    expect(r.ok).toBe(false);
    expect(ctx.gmXhr).not.toHaveBeenCalled();
  });
});

describe("the object URL outlives the click that reads it", () => {
  it("does not revoke in the same task as the click", async () => {
    vi.useFakeTimers();
    const p = saveMedia(item, ctx);
    await vi.advanceTimersByTimeAsync(0);
    await p;
    expect(revoked).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(60000);
    expect(revoked).toContain("blob:fake");
    vi.useRealTimers();
  });
});
