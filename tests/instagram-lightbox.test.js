import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLightbox } from "../src/lib/instagram/lightbox.js";

const photoPost = {
  kind: "photo",
  media: [{ type: "image", url: "https://x.cdninstagram.com/v/t51.82787-15/a.jpg", poster: null, index: 0 }],
  hasMore: false,
  caption: "a caption",
  author: { username: "nasa", avatar: "https://x.cdninstagram.com/v/t51.2885-19/av.jpg" },
  source: "dom",
};

const videoPost = {
  ...photoPost,
  kind: "video",
  media: [{ type: "video", url: "https://x.cdninstagram.com/o1/v/t2/f2/m86/clip.mp4", poster: "https://x.cdninstagram.com/p.jpg", index: 0 }],
};

const posterOnlyPost = {
  ...photoPost,
  kind: "video",
  media: [{ type: "video", url: null, poster: "https://x.cdninstagram.com/p.jpg", index: 0 }],
};

const carouselPost = { ...photoPost, kind: "carousel", hasMore: true };

let lb, cb;

function root() {
  const host = document.querySelector("[data-pz]");
  return host && host.shadowRoot;
}
const q = (sel) => root() && root().querySelector(sel);
const text = () => (root() ? root().textContent : "");
const img = () => q("img[data-pz-media]");
const frame = () => q("iframe");
const toggleBtn = () => q("[data-pz-view-toggle]");
const frameBtn = () => q("[data-pz-show-frame]");

function press(key) {
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = "";
  cb = { onClose: vi.fn(), onStep: vi.fn(), onSave: vi.fn(), onViewChange: vi.fn() };
  lb = createLightbox({ doc: document, shortcode: "Abc123", ...cb });
});
afterEach(() => lb.close());

describe("mounting", () => {
  it("mounts a shadow host carrying data-pz so the blocker skips it", () => {
    lb.open();
    const host = document.querySelector("[data-pz]");
    expect(host).toBeTruthy();
    expect(host.shadowRoot).toBeTruthy();
  });
  it("reports whether it is open", () => {
    expect(lb.isOpen()).toBe(false);
    lb.open();
    expect(lb.isOpen()).toBe(true);
    lb.close();
    expect(lb.isOpen()).toBe(false);
  });
  it("takes the host away on close", () => {
    lb.open();
    lb.close();
    expect(document.querySelector("[data-pz]")).toBe(null);
  });
  it("opening twice reuses the one host", () => {
    lb.open();
    const first = lb.el;
    lb.open();
    expect(lb.el).toBe(first);
    expect(document.querySelectorAll("[data-pz]")).toHaveLength(1);
  });
});

describe("our view", () => {
  beforeEach(() => lb.open());

  it("renders the image at its original URL", () => {
    lb.showPost(photoPost, { view: "ours" });
    expect(img().getAttribute("src")).toBe(photoPost.media[0].url);
  });
  it("renders the caption and the author", () => {
    lb.showPost(photoPost, { view: "ours" });
    expect(text()).toContain("a caption");
    expect(text()).toContain("nasa");
  });
  it("renders a video element for a video post", () => {
    lb.showPost(videoPost, { view: "ours" });
    const v = q("video");
    expect(v).toBeTruthy();
    expect(v.getAttribute("src")).toBe(videoPost.media[0].url);
    expect(v.hasAttribute("controls")).toBe(true);
  });
  it("shows the poster and a line when a video carries no URL", () => {
    lb.showPost(posterOnlyPost, { view: "ours" });
    expect(q("video")).toBe(null);
    expect(img().getAttribute("src")).toBe(posterOnlyPost.media[0].poster);
    expect(text()).toMatch(/not available/i);
    expect(frameBtn()).toBeTruthy();
  });
  it("says a carousel has more behind it", () => {
    lb.showPost(carouselPost, { view: "ours" });
    expect(text()).toMatch(/more picture|rest of|Instagram's own/i);
  });
  it("offers a save button for a photo", () => {
    lb.showPost(photoPost, { view: "ours" });
    expect(q("[data-pz-save]")).toBeTruthy();
  });
  it("calls onSave with the media item", () => {
    lb.showPost(photoPost, { view: "ours" });
    q("[data-pz-save]").click();
    expect(cb.onSave).toHaveBeenCalledWith(photoPost.media[0]);
  });
  it("links out to the post on Instagram", () => {
    lb.showPost(photoPost, { view: "ours" });
    expect(q("a[href*='/p/Abc123/']")).toBeTruthy();
  });
});

describe("closing and stepping", () => {
  beforeEach(() => {
    lb.open();
    lb.showPost(photoPost, { view: "ours" });
  });

  it("closes on Escape", () => {
    press("Escape");
    expect(cb.onClose).toHaveBeenCalled();
  });
  it("closes on a backdrop click", () => {
    q("[data-pz-backdrop]").click();
    expect(cb.onClose).toHaveBeenCalled();
  });
  it("does not close on a click on the image", () => {
    img().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(cb.onClose).not.toHaveBeenCalled();
  });
  it("steps forward on ArrowRight and back on ArrowLeft", () => {
    press("ArrowRight");
    expect(cb.onStep).toHaveBeenCalledWith(1);
    press("ArrowLeft");
    expect(cb.onStep).toHaveBeenCalledWith(-1);
  });
  it("stops listening to the keyboard once closed", () => {
    lb.close();
    cb.onStep.mockClear();
    cb.onClose.mockClear();
    press("ArrowRight");
    press("Escape");
    expect(cb.onStep).not.toHaveBeenCalled();
    expect(cb.onClose).not.toHaveBeenCalled();
  });
  it("zooms on an image click and back on a second click", () => {
    const first = img().getAttribute("data-pz-zoom");
    img().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(img().getAttribute("data-pz-zoom")).not.toBe(first);
    img().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(img().getAttribute("data-pz-zoom")).toBe(first);
  });
});

describe("the message state", () => {
  beforeEach(() => lb.open());

  it("shows the reason and a way to Instagram's own view", () => {
    lb.showMessage("Instagram asked that one to log in.");
    expect(text()).toContain("log in");
    expect(frameBtn()).toBeTruthy();
  });
  it("renders no media node", () => {
    lb.showMessage("nope");
    expect(img()).toBe(null);
    expect(q("video")).toBe(null);
  });
  it("switches to the frame when that button is pressed", () => {
    lb.showMessage("nope");
    frameBtn().click();
    expect(frame()).toBeTruthy();
  });
});

describe("the two views", () => {
  beforeEach(() => lb.open());

  it("renders a frame of the embed URL in the embed view", () => {
    lb.showPost(photoPost, { view: "embed" });
    expect(frame().getAttribute("src")).toBe("https://www.instagram.com/p/Abc123/embed/captioned/");
  });
  it("shows a view toggle in both views", () => {
    lb.showPost(photoPost, { view: "ours" });
    expect(toggleBtn()).toBeTruthy();
    lb.showPost(photoPost, { view: "embed" });
    expect(toggleBtn()).toBeTruthy();
  });
  it("calls onViewChange with the other view", () => {
    lb.showPost(photoPost, { view: "ours" });
    toggleBtn().click();
    expect(cb.onViewChange).toHaveBeenCalledWith("embed");
  });
  it("swaps the body without closing or remounting the overlay", () => {
    lb.showPost(photoPost, { view: "ours" });
    const host = lb.el;
    lb.showPost(photoPost, { view: "embed" });
    expect(lb.el).toBe(host);
    expect(lb.isOpen()).toBe(true);
    expect(img()).toBe(null);
  });
  it("defaults a carousel to the embed view, where Instagram's arrows work", () => {
    lb.showPost(carouselPost, { view: "ours" });
    expect(frame()).toBeTruthy();
  });
});
