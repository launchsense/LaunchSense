# LaunchSense, design system

This document describes the interface as built. Every value here is read from
`src/index.css` and `src/index.html`, and `tests/contrast-checks.mjs` recomputes the
contrast ratios from those values on every test run, so this file cannot drift from
the code without the suite going red.

Status: Phase 1. Design is still evolving. This is the current truth, not the
finished target.

## The design problem

This interface has one job that most interfaces do not have: it must not make a
partial check feel like a clean one.

A scanner's failure mode is confidence without evidence. The user reads "no
findings", feels safe, and publishes a repo with a live key in it. Every rule below
serves that: the verdict and its coverage sit together, "unknown" never renders as
"pass", and no surface states more than the code can prove.

So the design goal is not delight. It is that a tired, nontechnical person at 1am,
alone, about to hit publish, cannot be misled.

## Design principles

1. **Scope is never below the verdict.** The line saying how much was not read sits
   inside the same bordered block as the headline. Not beneath the report, not in a
   footnote, not behind a link.
2. **One dominant element per screen.** The verdict is the only heading with real
   size authority, so visual order matches reading order.
3. **Signals, never verdicts.** A readiness band is a band, not a score. A standards
   mapping is a line with a caveat, not a certification.
4. **Say what did not happen.** Empty, partial, failed, and unknown each get their
   own distinct state and their own wording.
5. **Buttons name their action.** `Run scan`, not `Get started`.
6. **Honest before impressive.** No urgency framing, no trophy, no confetti on a
   clean result.

## Tokens

The whole palette, type scale, spacing, and radius live as custom properties on
`:root`. No component rule hardcodes a colour, so a palette change is one edit.

### Colour

| Token | Value | Role | Ratio where used |
|---|---|---|---|
| `--paper` | `#f5f7f3` | Page background | 13.98:1 with ink |
| `--surface` | `#ffffff` | Cards, panels, inputs | 15.07:1 with ink |
| `--ink` | `#172a24` | Body text | 13.98:1 on paper |
| `--ink-muted` | `#333344` | Captions, counts, footer | 11.47:1 on paper |
| `--ink-faint` | `#666677` | Auth state text | 5.22:1 on paper |
| `--action` | `#174e39` | Buttons, links, verdict border | 9.61:1 with white text |
| `--action-text` | `#ffffff` | Button label | 9.61:1 on action |
| `--line` | `#cbd4ca` | Dividers, decorative borders | decorative only |
| `--line-strong` | `#6b7a71` | Input and ghost button borders | 4.52:1 on white |
| `--focus` | `#2d7a52` | Focus outline | 4.85:1 on paper |
| `--focus-light` | `#ffffff` | Focus inner edge | 9.61:1 on action |

### Contrast, measured not estimated

Two failures were found and fixed in this build, both by computing the ratio rather
than eyeballing it:

- Input borders were `#9aa79e`, which measured **2.50:1** on white. WCAG requires
  3:1 for a control boundary. Now `#6b7a71` at **4.52:1**.
- The focus ring was `#57966c`, which measured **2.74:1** against the dark button
  green it was outlining. See focus handling below.

Every text pair passes 4.5:1 and every non-text boundary passes 3:1. `--line` sits
below 3:1 on purpose: it is a decorative divider, never the only boundary of a
control.

### Type scale

One system family. Size carries hierarchy, because weight and colour alone did not
separate the headings before.

| Token | Value | Used for |
|---|---|---|
| `--text-xs` | `0.75rem` | Reserved, currently unused |
| `--text-sm` | `0.875rem` | Footer, auth state |
| `--text-base` | `1rem` | Body, `h5` |
| `--text-md` | `1.125rem` | Lead paragraph, check-list item names |
| `--text-lg` | `1.25rem` | `h4` |
| `--text-xl` | `1.5rem` | `h3`, the verdict headline |
| `--text-2xl` | `2rem` | `h2`, section titles |
| `--text-display` | `clamp(1.8rem, 6vw, 3rem)` | `h1` only |

Before this pass, `h2`, `h3`, `h4`, and `h5` had no author font-size at all and fell
back to browser defaults. That is why every report heading once looked equally loud.

Body measure is `--measure: 70ch`, inside the 65 to 75 character band. Longer lines
are hard to track back to.

## The verdict block

The single most important component in the product.

```html
<section aria-label="Result and scope" class="verdict">
  <h3>Nothing was flagged in the files we read. This is not a clean bill of health.</h3>
  <p class="verdict-scope">We read 200 of 340 files. The other 140 were not read.</p>
  <p class="verdict-counts">Findings: 2 high, 1 medium, 0 low, 3 info.</p>
  <ul class="verdict-stages">...</ul>
  <details class="not-checked"><summary>What was not checked</summary>...</details>
</section>
```

The `aria-label="Result and scope"` is not decoration. A test asserts the headline
and the scope line are siblings inside that one region, and that the scope follows
the headline with nothing meaningful between them.

Per-stage lines use only the four states, labelled `Checked`, `Partial`,
`Not checked`, `Unknown`. No other word is permitted in that list.

## Report order

Ordering is a trust decision, so it is fixed and tested:

1. Verdict and scope, together.
2. Top 3 fix prompt.
3. The rest of the fix list.
4. Live app check.
5. Findings, with path and line evidence.
6. Re-scan and explain.
7. Share, with the permanence disclosure above the buttons.
8. Framework signals.

Two defects were fixed here. The live panel used to sit between the top 3 and the
rest of the list, splitting the sentence "These are the items after the top 3
above." And the share block used to sit above re-scan, so the page implied "share
now" before "fix, then re-scan."

## What it checks, and what it checks is not cards

The home page check list was six identical cards in `auto-fit minmax(220px, 1fr)`.
That is the generic default, and it gave six different kinds of check exactly equal
visual weight.

It is now an ordered list with a named item and a rule between entries. Weight
follows meaning: secrets first, because that is what actually hurts.

## Accessibility

Verified by reading source. Not verified with a real screen reader or a physical
device, and that gap is stated rather than papered over.

- **Skip link.** First focusable element on every route, targeting `#main-content`
  with `tabIndex={-1}` so the anchor lands somewhere focusable.
- **Focus.** Covers `button`, `input`, `textarea`, `a`, `summary`, and `[role=tab]`.
  The ring is two-tone: a dark `2px` outline for light surfaces, offset by a white
  `box-shadow` edge that stays visible on the dark button green. No single colour
  can pass 3:1 on both.
- **Real tabs.** The panel strip is `role="tablist"` with `role="tab"`,
  `aria-selected`, `aria-controls`, a roving tabindex, and arrow keys plus Home and
  End that wrap and move focus. It was previously a `nav` of `aria-pressed` buttons,
  which is the wrong pattern and had no arrow keys.
- **Tap targets.** 44px minimum on buttons, summaries, and tabs.
- **Reduced motion.** `prefers-reduced-motion: reduce` kills animation and smooth
  scrolling.
- **Landmarks.** One `main` per page, with `role="status"` for progress and
  `role="alert"` for errors.
- **Semantics.** Real `button` elements, no clickable `div`s, every input labelled.

## Responsiveness

Two breakpoints, plus the fluid base.

- **420px and below.** Buttons go full width, tabs stack, the top menu wraps.
- **721px to 1023px.** Content narrows to 680px on the report and 720px on the home
  page, so line length stays readable on a tablet instead of stretching.
- **Base.** Body is fluid, `--measure` caps the measure, `--layout` caps the report
  at 720px, `--layout-wide` the home page at 980px.

## Language rules

These are interface rules, not just content guidance.

- No em dashes or en dashes anywhere.
- No single-character ellipsis. Loading states are words: `Fetching files`,
  `Analyzing files`, `Checking live site`.
- No tracked all-caps eyebrow above a heading. Removed from all three pages.
- Section numbers only when the sequence carries information.
- Raw backend error messages are never rendered. `src/features/scan/userError.ts` is
  the single boundary: it allowlists the few throws written for humans and returns a
  plain sentence for everything else, because a raw message can carry file paths,
  hostnames, or upstream API text.

## Enforced, not intended

Intent does not survive a deadline. These are build failures:

| Rule | Enforced by |
|---|---|
| No em dash or ellipsis in source | `tests/language-checks.mjs` |
| Removed overstatements stay removed | `tests/language-checks.mjs` |
| Verdict and scope adjacent | `tests/scope-checks.mjs` |
| Report order fixed | `tests/share-truth-checks.mjs` |
| Tab semantics and arrow keys | `tests/a11y-checks.mjs` |
| Contrast thresholds | `tests/contrast-checks.mjs` |
| No copy claiming expiry or revocation the backend lacks | `scripts/check-claims.mjs` |
| No raw error message rendered | `tests/language-checks.mjs` |

The claim guard exists because a copy rule that only lives in a document rots.
Each of its 12 rules was written against a string that was genuinely in this
product, and during this build it caught three of our own new strings.

## Not verified

Stated plainly rather than implied:

- No screen reader run.
- No keyboard traversal in a real browser.
- No zoom or reflow test at 200%.
- No physical touch device.
- No real browser screenshots.

Contrast numbers are computed from the same hex values the CSS ships, so those are
trustworthy. Everything else needs a browser and a person.