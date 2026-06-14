import { describe, it, expect } from "vitest";
import { scorePopupCandidate, findBestGuess } from "../src/lib/learner.js";

function el(html) {
  document.body.innerHTML = html;
  return document.body.firstElementChild;
}

describe("scorePopupCandidate", () => {
  it("scores fixed + high z-index + wall text higher than plain content", () => {
    const popup = el(`<div style="position:fixed;z-index:9999">Please sign in to continue</div>`);
    const popupScore = scorePopupCandidate(popup);
    const article = el(`<div style="position:static">Just an article paragraph</div>`);
    expect(popupScore).toBeGreaterThan(scorePopupCandidate(article));
  });
});

describe("findBestGuess", () => {
  it("returns the highest-scoring element on the page", () => {
    document.body.innerHTML = `
      <div id="content" style="position:static">article body text</div>
      <div id="gate" style="position:fixed;z-index:5000">Subscribe to read more</div>
    `;
    const guess = findBestGuess(document);
    expect(guess.id).toBe("gate");
  });

  it("returns null when nothing looks like a popup", () => {
    document.body.innerHTML = `<div style="position:static">plain</div>`;
    expect(findBestGuess(document)).toBeNull();
  });

  it("ignores other browser extensions' injected roots", () => {
    document.body.innerHTML =
      `<div id="protonpass-root-8218" style="position:fixed;z-index:99999">Sign in</div>`;
    expect(findBestGuess(document)).toBeNull();
  });
});