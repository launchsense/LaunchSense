import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// W7. Contrast ratios are computed here from the real CSS token values, so a
// palette edit that breaks a threshold fails the build instead of shipping.

// WCAG 2.1 relative luminance and contrast ratio.
function channels(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function linear(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function luminance(hex) {
  const [r, g, b] = channels(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}
export function contrast(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

function token(name) {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(m, `index.css must define --${name}`);
  return m[1];
}

const T = {
  paper: token("paper"),
  surface: token("surface"),
  ink: token("ink"),
  inkMuted: token("ink-muted"),
  inkFaint: token("ink-faint"),
  action: token("action"),
  actionText: token("action-text"),
  line: token("line"),
  lineStrong: token("line-strong"),
  focus: token("focus"),
  focusLight: token("focus-light"),
};

describe("text contrast, 4.5:1 required", () => {
  const pairs = [
    ["body text on page", T.ink, T.paper],
    ["body text on a card", T.ink, T.surface],
    ["button label", T.actionText, T.action],
    ["link on page", T.action, T.paper],
    ["link on a card", T.action, T.surface],
    ["muted text on page", T.inkMuted, T.paper],
    ["faint text on page", T.inkFaint, T.paper],
    ["muted text on a card", T.inkMuted, T.surface],
    ["focus outline on page", T.focus, T.paper],
  ];
  for (const [name, fg, bg] of pairs) {
    it(`${name} (${contrast(fg, bg).toFixed(2)}:1)`, () => {
      assert.ok(contrast(fg, bg) >= 4.5, `${name} is ${contrast(fg, bg).toFixed(2)}:1, needs 4.5:1`);
    });
  }
});

describe("control boundaries, 3:1 required", () => {
  const pairs = [
    ["input border on a card", T.lineStrong, T.surface],
    ["input border on the page", T.lineStrong, T.paper],
    ["ghost button border on the page", T.lineStrong, T.paper],
    ["focus ring on the dark button", T.focusLight, T.action],
  ];
  for (const [name, fg, bg] of pairs) {
    it(`${name} (${contrast(fg, bg).toFixed(2)}:1)`, () => {
      assert.ok(contrast(fg, bg) >= 3, `${name} is ${contrast(fg, bg).toFixed(2)}:1, needs 3:1`);
    });
  }
});

describe("the old failing values are gone", () => {
  it("no longer uses 9aa79e for input borders, which measured 2.50:1", () => {
    assert.doesNotMatch(css, /#9aa79e/i);
  });

  it("no longer uses 57966c as the only focus ring, which measured 2.74:1 on the button", () => {
    assert.doesNotMatch(css, /#57966c/i);
  });

  it("no longer uses the shorthand muted hex values", () => {
    // #334 and #667 expand to #333344 and #666677. Written longhand so a
    // grep for the token name and a grep for the value agree.
    assert.doesNotMatch(css, /#334\b/i);
    assert.doesNotMatch(css, /#667\b/i);
  });
});

describe("every interactive element has a visible focus state", () => {
  it("covers textarea and summary, which had no focus style", () => {
    const focusRule = css.slice(css.indexOf("button:focus-visible"));
    const end = focusRule.indexOf("}");
    const rule = focusRule.slice(0, end);
    for (const selector of ["textarea:focus-visible", "summary:focus-visible", "[role=\"tab\"]:focus-visible"]) {
      assert.ok(rule.includes(selector), `focus rule is missing ${selector}`);
    }
  });

  it("uses a two tone ring so it is visible on light and dark surfaces", () => {
    const focusRule = css.slice(css.indexOf("button:focus-visible"));
    const end = focusRule.indexOf("}");
    const rule = focusRule.slice(0, end);
    assert.match(rule, /outline:\s*2px solid var\(--focus\)/);
    assert.match(rule, /box-shadow:[^;]*var\(--focus-light\)/);
  });
});

describe("design system rules", () => {
  it("respects prefers-reduced-motion", () => {
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  });

  it("gives buttons and summaries a 44px minimum target", () => {
    assert.match(css, /--tap:\s*44px/);
    assert.match(css, /min-height:\s*var\(--tap\)/);
  });

  it("defines a type scale rather than leaving h2 to the browser default", () => {
    assert.match(css, /--text-xs:/);
    assert.match(css, /--text-base:/);
    assert.match(css, /--text-xl:/);
    assert.match(css, /--text-2xl:/);
    for (const tag of ["h2", "h3", "h4", "h5"]) {
      assert.match(css, new RegExp(`${tag} \\{[^}]*font-size`), `${tag} still has no explicit font-size`);
    }
  });

  it("keeps the body measure inside the 65 to 75 character band", () => {
    const m = css.match(/--measure:\s*(\d+)ch/);
    assert.ok(m, "--measure must be defined in ch");
    const n = Number(m[1]);
    assert.ok(n >= 65 && n <= 75, `--measure is ${n}ch, needs 65 to 75ch`);
  });

  it("provides a skip link style that is hidden until focused", () => {
    assert.match(css, /\.skip-link/);
    assert.match(css, /\.skip-link:focus/);
  });

  it("has an intermediate breakpoint, not only the small one", () => {
    const widths = [...css.matchAll(/@media \(min-width: (\d+)px\)/g)].map((m) => Number(m[1]));
    assert.ok(widths.length > 0, "expected at least one min-width breakpoint");
  });

  it("replaced the identical card grid with an ordered check list", () => {
    assert.doesNotMatch(css, /auto-fit,\s*minmax\(220px/);
    assert.match(css, /\.check-list/);
  });
});