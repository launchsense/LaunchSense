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

## The rules we design by

1. **The coverage line never sits below the answer.** The sentence saying how much
   was not read stays inside the same box as the headline. Not further down the page,
   not in a footnote, not behind a link.
2. **One clear thing per screen.** The answer is the biggest text on the page, so
   what stands out matches what you read first.
3. **A signal is not a score.** Readiness is a band, not a mark out of ten. A
   standards line is a line with a caveat, not a certificate.
4. **Say what did not happen.** Empty, partial, failed, and unknown each get their
   own words. A check that did not run never looks like a check that passed.
5. **Buttons say what they do.** `Run scan`, not `Get started`.
6. **Honest beats impressive.** No fake urgency, no trophy, no celebration when the
   result is clean.
7. **The site is the front door.** The page can explain the harness. It does not
   look like the harness already ran on the visitor's machine. Coverage stays in
   the same box as the answer.

## Colours and sizes

Every colour, text size, page width, and corner roundness is set once at the top of
`src/index.css` and reused everywhere. Change it in one place and the whole product
follows. A test checks that no colour is written anywhere else.

Spacing is the one exception. Padding and margin are written where they are used,
because the layout is simple and inventing a spacing scale now would be tidier on
paper and useless in practice. If a third layout arrives, it becomes a set of
`--space-*` values.

### Colours

"Ratio" is how easy the colour pair is to read. The goal is 4.5 to 1 or better for
text, and 3 to 1 for a line or border you have to see.

| Name | Value | Where it is used | Ratio |
|---|---|---|---|
| `--paper` | `#f5f7f3` | Page background | 13.98:1 with ink |
| `--surface` | `#ffffff` | Cards, panels, inputs | 15.07:1 with ink |
| `--ink` | `#172a24` | Body text | 13.98:1 on paper |
| `--ink-muted` | `#333344` | Captions, counts, footer | 11.47:1 on paper |
| `--ink-faint` | `#666677` | Sign-in status text | 5.22:1 on paper |
| `--action` | `#174e39` | Buttons, links, answer box border | 9.61:1 with white text |
| `--action-text` | `#ffffff` | Button text | 9.61:1 on the button |
| `--line` | `#cbd4ca` | Dividers between sections | decorative only |
| `--line-strong` | `#6b7a71` | Input borders, ghost button borders | 4.52:1 on white |
| `--focus` | `#2d7a52` | Focus outline | 4.85:1 on paper |
| `--focus-light` | `#ffffff` | Focus inner edge | 9.61:1 on action |

### Contrast, worked out not guessed

Two pairs were failing, and both were caught by working out the ratio instead of
trusting how they looked:

- Input borders were `#9aa79e`, which came out at **2.50:1** on white. A border you
  have to see needs at least 3:1. Now `#6b7a71` at **4.52:1**.
- The focus ring was `#57966c`, which came out at **2.74:1** against the dark green
  button it was outlining. That is fixed below.

Every text pair passes 4.5:1 and every border you have to see passes 3:1. `--line`
is below 3:1 on purpose. It is only a divider, and it is never the only thing
marking where a control is.

### Text sizes

One font. Size does the ranking, because weight and colour alone were not enough to
separate the headings.

**The font: Public Sans.** Not applied in `src/index.css` yet (it still says
`system-ui, sans-serif`). This is the choice to apply in the next UI pass.

Why this one:

- It is the font the US government built for public information, so its whole job is
  "readable by someone who is not an expert and is a little worried." That is exactly
  our reader.
- It is plain without being the default everyone reaches for. `Inter` is the most
  common font in AI-made interfaces right now, and `system-ui` is what gets used when
  nobody chose. Both were turned down on purpose.
- It is free and open, so it ships inside the build.

**Keep the font on our own server, never a CDN.** The package is
`@fontsource/public-sans`, imported in `src/main.tsx`. This is not only about speed.
A Google Fonts link, or any font loaded from someone else's server, sends every
visitor's IP address to a third party on every page load. That would make the privacy
section of `PRODUCT.md` false. Keeping the font local keeps that promise true.

```css
--font-sans: "Public Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
body { font-family: var(--font-sans); }
```

Load three weights only: 400 regular, 600 semibold, 700 bold. Every extra weight is
more to download and more chances to emphasise the wrong thing.

| Size | Used for |
|---|---|
| `--text-xs` `0.75rem` | Set, not used yet |
| `--text-sm` `0.875rem` | Footer, sign-in status |
| `--text-base` `1rem` | Body text, `h5` |
| `--text-md` `1.125rem` | Opening paragraph, check-list item names |
| `--text-lg` `1.25rem` | `h4` |
| `--text-xl` `1.5rem` | `h3`, the answer headline |
| `--text-2xl` `2rem` | `h2`, section titles |
| `--text-display` `clamp(1.8rem, 6vw, 3rem)` | `h1` only |

Before this pass, `h2`, `h3`, `h4`, and `h5` had no size set at all, so the browser
picked. That is why every heading in the report once looked equally loud.

Body text is capped at `--measure: 70ch`, between 65 and 75 characters a line. Longer
lines are hard to read back to the start of.

## The answer box

The single most important part of the product.

```html
<section aria-label="Result and scope" className="verdict">
  <h3>Nothing was flagged in the files we read. This is not a clean bill of health.</h3>
  <p className="verdict-scope">We read 200 of 340 files. The other 140 were not read.</p>
  <p className="verdict-counts">Findings: 2 high, 1 medium, 0 low, 3 info.</p>
  <ul className="verdict-stages">...</ul>
  <details className="not-checked">
    <summary>What was not checked</summary>
    <ul>...</ul>
  </details>
</section>
```

The `aria-label="Result and scope"` is not just a label. A test checks that the
headline and the coverage line sit together in that one box, with nothing important
between them.

The lines under it use only four words: `Checked`, `Partial`, `Not checked`,
`Unknown`. No other word is allowed there.

## The order of the report

The order is a trust decision, so it is fixed and a test holds it in place:

1. The answer and what was not checked, together.
2. One lead, then up to three separate prompts, then the line that says a model only reorders inside one severity.
3. The rest of the fix list.
4. Live app check.
5. All findings, each with its file and line.
6. Re-scan and explain.
7. Share, with the "this link cannot be taken back" notice above the buttons.
8. The signals and missions panels.

Two things were wrong here and are fixed. The live-app panel used to sit between the
top three and the rest of the list, cutting the sentence "These are the items after
the top 3 above" in half. And the share buttons used to sit above the re-scan
buttons, which told the reader to share before they had fixed anything.

## What it checks, and why it is not a row of cards

The home page check list used to be six identical cards. Every card looked the same,
so "we check your secrets" had the same weight as "we check your README". That is
false. Secrets matter more.

It is now a plain list, each line naming one real check, with a thin rule between
them. Secrets come first because that is what actually hurts someone.

## Getting around, and reading it

This part was checked by reading the code. It has **not** been tested with a screen
reader or on a real phone, and that gap is stated here instead of hidden.

- **Skip link.** The first thing a keyboard reaches on any page, jumping straight to
  the content.
- **Focus.** A clear outline on every control: buttons, inputs, text boxes, links,
  the details toggles, and the panel tabs. The ring is two colours, because one
  colour cannot be seen clearly on both the light page and the dark green button.
- **Panel tabs.** The four panel buttons work like real tabs: arrow keys move
  between them, Home and End jump to the ends, and the focus follows. Before this
  they were plain buttons with no keyboard movement.
- **Tap targets.** Every button, toggle, and tab is at least 44px tall, which is the
  smallest a finger reliably hits.
- **Reduced motion.** If the visitor has asked their system to reduce motion, the
  animation and smooth scrolling are turned off.
- **One `main` per page**, and status and error messages are announced to screen
  readers.
- **Real buttons**, no clickable boxes, and every input has a label.

### What has not been checked

Said plainly, because the next person should not upgrade these into facts:

- No screen reader has been run.
- No keyboard walkthrough in a real browser.
- No zoom test at 200%.
- No test on a real phone or tablet.
- No real screenshots.

The colour ratios are trustworthy because they are worked out from the exact values
the site ships. Everything else needs a browser and a person.
- **Landmarks.** One `main` per page, with `role="status"` for progress and
  `role="alert"` for errors.
- **Semantics.** Real `button` elements, no clickable `div`s, every input labelled.

## Responsive behaviour

Three widths, plus the fluid base.

- **420px and below.** Buttons go full width, panels stack, the top menu wraps.
- **721px to 1023px.** Content narrows so lines stay readable on a tablet rather
  than stretching across it.
- **Base.** Body text is fluid. `--measure` caps line length, `--layout` caps the
  report at 720px, `--layout-wide` the home page at 980px.

## How it talks

These are rules for the words on screen, not just for documents.

- No em dashes or en dashes anywhere.
- No single-character ellipsis. Waiting is shown in words: `Fetching files`,
  `Analyzing files`, `Checking live site`.
- No small all-caps label above a heading. Removed from all three pages.
- Numbered sections only when the order actually means something.
- No raw error text from the backend, ever. `src/features/scan/userError.ts` is the
  one place that reads an error message. It passes through the few messages written
  for people and returns a plain sentence for everything else, because a raw message
  can carry file paths, hostnames, or text from another service.

## Held in place by tests, not by intention

Good intentions do not survive a deadline. These are build failures:

| Rule | Held by |
|---|---|
| No em dash or ellipsis in the code | `tests/language-checks.mjs` |
| Removed overstatements stay removed | `tests/language-checks.mjs` |
| The answer and its coverage line stay together | `tests/scope-checks.mjs` |
| The report order stays fixed | `tests/share-truth-checks.mjs` |
| Tabs work with arrow keys | `tests/a11y-checks.mjs` |
| Colour contrast thresholds | `tests/contrast-checks.mjs` |
| No copy promising expiry or revocation the code does not have | `scripts/check-claims.mjs` |
| No raw error message shown to a user | `tests/language-checks.mjs` |

The copy guard matters because a rule that lives only in a document rots. It carries
33 rules, and it reads these two documents like it reads the interface.

## What has not been checked

Said plainly, because the next person should not upgrade these into facts:

- No screen reader has been run.
- No keyboard walkthrough in a real browser.
- No zoom test at 200%.
- No test on a real phone or tablet.
- No real screenshots.

The colour ratios are trustworthy because they are worked out from the exact values
the site ships. Everything else needs a browser and a person.

## References

Named examples to borrow from, with the boundary said out loud. "Take X, ignore Y"
is the point. A reference without a boundary is how a project drifts into looking
like someone else's product.

### The verdict block: take from a medical test result, ignore the lab aesthetic

Take: the ordering of a test result. A one-line result, then the reference range it
was measured against, then the plain-language note. A patient learns "your level is
3, normal is under 5, here is what that means" and nothing is hidden behind a tap.

Ignore: the clinical white, the tiny monospaced ranges, the sense of a hospital
form. This product is a friend looking over your shoulder, not a lab report.

Applied: `verdict.headline`, then `verdict.scope` immediately under it, then the
counts, then per-stage states. The scope line is the "reference range."

### The fix list: take from a recipe card, ignore a project management board

Take: an ordered list where step 1 is the first thing you actually do, and each step
carries its own reason. A recipe never makes you cross-reference another page to
learn why you are sifting flour.

Ignore: Kanban columns, status chips, drag handles, assignees. This is one person
doing three things in order, not a team managing work.

Applied: `The rest of the fix list` is an `<ol>` with a title, a why, and a
checklist per step. The top-3 prompt is the same list, cut to the first three.

### The check list on Home: take from a menu, ignore a pricing page

Take: a plain menu where each line is a real thing, separated by a rule, and the
reader can scan it in five seconds.

Ignore: the six-tile feature grid from every SaaS pricing page. That is the generic
default, and it gives "we check your secrets" the same visual weight as "we check
your README", which is false.

Applied: `.check-list` is an ordered list, secrets first, each item a named thing
with a rule between entries. Weight follows meaning.

### Severity: take from a traffic light, ignore badges

Take: the instant read of "this one first." High means stop, and the reader should
not have to parse a word to know that.

Ignore: shield icons, score dials, coloured pills with rounded corners and a drop
shadow. Those read as decoration and this product has already banned them.

Applied: `high` uses `--action` for colour and a heavier weight, via
`.severity-high`. Medium, low, and info stay plain text. No badge, no icon, no
shadow.

### Loading and progress: take from a download, ignore a spinner

Take: a named operation and, where it exists, real progress. "Reading files, 40 of
200."

Ignore: the spinning circle, the skeleton screen, the indeterminate bar. A spinner
says "wait" and nothing else.

Applied: `Fetching files`, `Analyzing files`, `Checking live site`, all as words,
with a real `<progress>` element when a file count exists.

### The share disclosure: take from a bank transfer confirmation, ignore a cookie banner

Take: a short, unskippable statement of what happens, before the action. A bank
tells you the money is gone and cannot be recalled before you press send.

Ignore: the dismissible, greyed-out cookie notice that trains people to click
through without reading. This statement is not dismissible, and it sits above the
button, not beside it.

Applied: `Before you create a link` is a bordered block above the buttons, stating
audience, contents, and that the link cannot be taken back.

### What this product must never look like

- A security dashboard. Dark panels, green terminal text, threat counters.
- A generic AI product. Inter, a warm cream background, a terracotta accent, rounded
  cards with a soft shadow.
- A marketing page. Hero metric, three feature icons, testimonial row.

The first would scare the reader. The second is the tell the design skills name
directly. The third has no place in a tool that is honest about what it did not
check.