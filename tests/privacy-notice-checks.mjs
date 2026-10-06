import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SIGN_IN_POLICY } from "../shared/copy/signIn.ts";

// NOTICE-REACHABLE. Three defects, one file of tests.
//
// 1. docs/PRIVACY.md existed and src/App.tsx had no /privacy route, so the
//    policy was unreachable from the product. A notice nobody can open is not
//    notice (DPDP s5(1), GDPR Art 13).
// 2. The sign-in dialog had one paragraph and one button. Four separate
//    purposes were bundled behind a single press, with nothing unticked and no
//    way to see which one you were agreeing to.
// 3. The MCP Connect page carried no disclosure at all. The protocol has no
//    consent message, so the page is the only place a person can be told.
//
// Every rule below was written against the string that shipped on 2026-10-05.
// The fixtures are verbatim copies, so a rule cannot pass by matching nothing.

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

function read(...parts) {
  const full = join(repo, ...parts);
  // A file that does not exist reads as empty rather than crashing the runner.
  // The rules below then fail one by one and name what is missing, instead of
  // the whole file dying on the first import.
  return existsSync(full) ? readFileSync(full, "utf8") : "";
}

// Prose is reflowed across lines by the formatter, so every sentence check runs
// against a whitespace-flattened copy. JSX structure checks keep the raw text,
// because there an indent is part of what is being asserted.
function flat(source) {
  return source.replace(/\s+/g, " ");
}

const app = read("src", "App.tsx");
const footer = read("src", "features", "site", "SiteFooter.tsx");
const authPanel = read("src", "features", "auth", "AuthPanel.tsx");
const connect = read("src", "pages", "Connect.tsx");
const privacyPage = read("src", "pages", "Privacy.tsx");
const privacyDoc = read("docs", "PRIVACY.md");

const authPanelText = flat(authPanel);
const connectText = flat(connect);
const privacyPageText = flat(privacyPage);
const privacyDocText = flat(privacyDoc);

// The verbatim string from the old sign-in surface, which bundled four purposes
// into one paragraph behind one button.
const BUNDLED_SIGN_IN = SIGN_IN_POLICY;

describe("the privacy policy is reachable from the product", () => {
  it("has a route, so the page is not a file only a reader can find", () => {
    assert.match(app, /import Privacy from "\.\/pages\/Privacy"/, "App.tsx must import the page");
    assert.match(app, /path === "\/privacy"/, "App.tsx must route /privacy to it");
    assert.match(app, /<Privacy \/>/, "App.tsx must render the page at that route");
  });

  it("is linked from the footer, so every page that uses the frame reaches it", () => {
    assert.match(footer, /href="\/privacy"/, "the footer must link to /privacy");
    const frame = read("src", "features", "site", "SiteFrame.tsx");
    assert.match(frame, /<SiteFooter \/>/, "the frame must render the footer on every page");
  });

  it("names itself and its version, so a reader can tell what they are reading", () => {
    assert.match(privacyPage, /Privacy/, "the page must carry the policy heading");
    assert.match(privacyPage, /2026-10-05/, "the page must carry the version number");
  });

  it("uses the site frame, so it gets the skip link, the menu, and the footer", () => {
    assert.match(privacyPage, /SiteFrame/, "the page must use the site frame");
    assert.doesNotMatch(privacyPage, /<main/, "the frame owns main, the page must not add one");
  });

  it("keeps one h1 and gives every section a heading its region is named by", () => {
    assert.equal([...privacyPage.matchAll(/<h1/g)].length, 1, "exactly one h1");
    for (const [, id] of privacyPage.matchAll(/<h2 id="([^"]+)"/g)) {
      assert.ok(
        privacyPage.includes(`aria-labelledby="${id}"`),
        `section heading ${id} has no region naming it`,
      );
    }
  });

  it("carries the thirteen headings the policy is required to have", () => {
    // R2 section J. The count and the order are both checked, because a notice
    // that silently drops a section is how a required heading goes missing.
    const headings = [...privacyPage.matchAll(/<h2 id="[^"]+">([^<]+)<\/h2>/g)].map((m) => m[1]);
    assert.equal(headings.length, 13, `expected 13 numbered headings, found ${headings.length}`);
    headings.forEach((heading, index) => {
      assert.ok(
        heading.trim().startsWith(`${index + 1}.`),
        `heading ${index + 1} is out of order: ${heading}`,
      );
    });
    const text = headings.join(" ");
    for (const required of [
      "Who we are",
      "What you agree",
      "What you paste",
      "What we store when you sign in",
      "What an AI provider receives",
      "What the coding tool connection sends",
      "Fonts and what the browser sends",
      "How long we keep each thing",
      "Who can see it",
      "Your choices",
      "How to delete your data",
      "Who to complain to",
      "Changes",
    ]) {
      assert.ok(text.includes(required), `the policy is missing a required heading: ${required}`);
    }
  });
});

describe("the page and the repository file say the same thing", () => {
  function docHeadings() {
    return [...privacyDoc.matchAll(/^## (.+)$/gm)].map((m) => flat(m[1]).trim());
  }

  function pageHeadings() {
    return [...privacyPage.matchAll(/<h2 id="[^"]+">([\s\S]*?)<\/h2>/g)].map((m) => flat(m[1]).trim());
  }

  it("has the same headings on both sides", () => {
    assert.deepEqual(docHeadings(), pageHeadings(), "docs/PRIVACY.md and /privacy have drifted apart");
  });

  it("has no section on either side that the other one lost", () => {
    // Named separately from the deepEqual so a failure says which direction
    // the drift went rather than printing two long lists.
    const onPage = new Set(pageHeadings());
    for (const heading of docHeadings()) {
      assert.ok(onPage.has(heading), `docs/PRIVACY.md has a heading the page does not: ${heading}`);
    }
  });

  it("keeps the two limits that were true before the move", () => {
    // Both sentences were in the file on 2026-10-05 and are the ones a reader
    // needs most. A rewrite that drops them loses the notice's honesty.
    for (const sentence of [
      "We store no copy of your code in our database",
      "We never change your code and we never write to your repository",
      "There is no automatic deletion today",
      "not deleted when a session expires on its own",
    ]) {
      assert.ok(privacyDocText.includes(sentence), `docs/PRIVACY.md lost this line: ${sentence}`);
      assert.ok(privacyPageText.includes(sentence), `/privacy lost this line: ${sentence}`);
    }
  });

  it("says what is not built instead of writing it in the present tense", () => {
    for (const gap of [
      "What is not built yet",
      "no self-service deletion button",
      "Those rows are not deleted automatically today",
      "There is no automatic deletion today",
    ]) {
      assert.ok(privacyPageText.includes(gap), `/privacy must keep this honest gap: ${gap}`);
    }
  });
});

describe("sign in asks once for all four purposes", () => {
  it("has one checkbox, not four", () => {
    assert.equal(
      [...authPanel.matchAll(/type="checkbox"/g)].length,
      1,
      "one tick covers all four purposes",
    );
    assert.match(authPanel, /id="purpose-all"/, "the single box has a stable id");
    assert.match(authPanel, /htmlFor="purpose-all"/, "the label points at the box");
  });

  it("starts unticked", () => {
    assert.doesNotMatch(
      authPanel,
      /defaultChecked/,
      "a pre-ticked box is not a decision: ICO and DPDP s6(1) both rule it out",
    );
    assert.doesNotMatch(authPanel, /checked=\{(true|false)\}/, "no box may be fixed at build time");
    assert.match(authPanel, /useState\(false\)/, "empty state means unticked");
  });

  it("names every purpose as keywords in the label", () => {
    for (const keyword of [
      "token storage",
      "one repository read",
      "AI explanations",
      "anonymous usage counts",
    ]) {
      assert.ok(authPanelText.includes(keyword), `the single label is missing: ${keyword}`);
    }
  });

  it("keeps the four purposes recorded behind the tick", () => {
    assert.match(authPanel, /PURPOSES\.map\(\(purpose\) => purpose\.id\)/, "the tick grants all four ids");
    assert.match(authPanel, /grantedFor: \(\) => accepted === true/, "one tick grants every purpose or none");
  });

  it("says what each purpose stores or sends, not just that it exists", () => {
    for (const detail of [
      "plaintext string",
      "1,000 files and about 8MB",
      "fingerprint, the severity, the title, and the reason",
      "Rule id counts, the harness name, the version",
    ]) {
      assert.ok(authPanelText.includes(detail), `a purpose does not say what leaves: ${detail}`);
    }
  });

  it("blocks the sign-in button until the box is ticked", () => {
    assert.match(authPanel, /disabled=\{!accepted\}/, "the sign-in button must be disabled until ticked");
    assert.match(authPanel, /role="status"/, "the reader is told the box is unticked");
  });

  it("says signing in turns on all four, because no per-purpose switch exists yet", () => {
    assert.ok(
      authPanelText.includes("Signing in turns on all four"),
      "one tick that silently records four purposes must say so",
    );
  });

  it("links the privacy notice from the sign-in surface", () => {
    assert.match(authPanel, /href="\/privacy"/, "the sign-in surface must link the notice");
    assert.match(authPanel, /Read the privacy notice/);
  });

  it("still states the signed-in token policy, and still bundles nothing into it", () => {
    // The old paragraph stays, because it is the plain statement of what the
    // signed-in read does. It may not grow into a catch-all for the boxes.
    assert.match(authPanel, /SIGN_IN_POLICY/, "the signed-in policy sentence must stay");
    assert.ok(BUNDLED_SIGN_IN.startsWith("When you are signed in"), "fixture drifted");
  });

  it("does not sell a capability the code does not have", () => {
    for (const phrase of [/deeper scan/i, /saved history/i, /paid/i, /sign in is optional/i]) {
      assert.doesNotMatch(authPanel, phrase, `the sign-in surface must not claim ${phrase}`);
    }
  });

  it("uses no em dash, en dash, ellipsis, or middle dot", () => {
    for (const character of [/\u2014/, /\u2013/, /\u2026/, /\u00b7/]) {
      assert.doesNotMatch(authPanel, character, `the sign-in surface contains ${character}`);
    }
  });
});

describe("the Connect page discloses what the connection does", () => {
  it("says what the address can reach, and what it cannot", () => {
    for (const line of [
      "Before you add this address",
      "one public",
      "up to 200 files and about 2MB",
      "We do not read the repository on your machine",
      "We do not read private repositories through this address",
      "We do not need an account for this address",
    ]) {
      assert.ok(connectText.includes(line), `the Connect page is missing a disclosure line: ${line}`);
    }
  });

  it("carries one unticked box", () => {
    assert.equal([...connect.matchAll(/type="checkbox"/g)].length, 1, "one disclosure box");
    assert.doesNotMatch(connect, /defaultChecked/, "the box must not start ticked");
    assert.match(connect, /useState\(false\)/, "the box state starts false");
  });

  it("labels the box", () => {
    assert.match(connect, /id="connect-ack"/);
    assert.match(connect, /htmlFor="connect-ack"/);
    assert.match(connect, /I have read what this connection does and what it stores/);
  });

  it("names it a disclosure and never calls it consent", () => {
    assert.match(connect, /<legend>Disclosure<\/legend>/, "the box must be labelled a disclosure");
    assert.match(connect, /This box is a disclosure, not an agreement/);
    assert.doesNotMatch(
      connect,
      /(I agree|you consent|by ticking this you agree|consent to)/i,
      "an unticked box on a page cannot be a consent basis, so the page must not call it one",
    );
  });

  it("says the box does not create an account and does not sign you in", () => {
    assert.ok(
      connectText.includes("does not create an account and does not sign you in"),
      "the box must say what it is not",
    );
  });

  it("links the privacy notice", () => {
    assert.match(connect, /href="\/privacy"/, "the Connect page must link the notice");
    assert.match(connect, /Read the privacy notice/);
  });

  it("keeps the running text and the partial-result warning", () => {
    assert.match(connect, /A partial result is not a pass\. License lines are signals/);
    assert.match(connect, /launchsense_scan_public/);
  });
});

// Heading parity alone let a body drift through. On 2026-10-05 a validator
// changed the file's read cap to "900MB" while the page still said "2MB", and
// every rule above passed. These rules pin the load-bearing facts to the
// constants the code actually uses, so a change in shared/ or convex/ fails here
// and the copy has to change with it, on both sides at once.
describe("the load-bearing facts match on both copies and match the code", () => {
  function constant(source, name) {
    const match = source.match(new RegExp(`${name}\\s*=\\s*([0-9_]+)`));
    assert.ok(match, `${name} must exist in the source under test`);
    return Number(match[1].replace(/_/g, ""));
  }

  const scanCaps = read("shared", "scanCaps.ts");
  const redaction = read("shared", "redaction.ts");
  const live = read("convex", "adapters", "live.ts");

  function bothSides(sentence, why) {
    for (const [name, text] of [
      ["docs/PRIVACY.md", privacyDocText],
      ["/privacy", privacyPageText],
    ]) {
      assert.ok(text.includes(sentence), `${name} must ${why}: "${sentence}"`);
    }
  }

  it("states the guest read cap the code sets", () => {
    const files = constant(scanCaps, "GUEST_MAX_FILES");
    const mb = Math.round(constant(scanCaps, "GUEST_MAX_BYTES") / 1_000_000);
    bothSides(`stops at ${files} files and about ${mb}MB`, "state the guest cap");
  });

  it("states the signed-in read cap the code sets", () => {
    const files = constant(scanCaps, "SIGNED_MAX_FILES");
    const mb = Math.round(constant(scanCaps, "SIGNED_MAX_BYTES") / 1_000_000);
    bothSides(
      `up to ${files.toLocaleString("en-US")} files and about ${mb}MB`,
      "state the signed-in cap",
    );
  });

  it("states the snippet cap the code sets", () => {
    const chars = constant(redaction, "MAX_SNIPPET_CHARS");
    bothSides(`capped at ${chars} characters`, "state the snippet cap");
  });

  it("states the redirect cap the code sets", () => {
    const hops = constant(live, "LIVE_MAX_HOPS");
    const words = { 1: "one", 2: "two", 3: "three", 4: "four", 5: "five" }[hops] ?? String(hops);
    bothSides(`follows up to ${words} redirects`, "state the redirect cap");
  });

  it("names the same guest file cap on both sides", () => {
    const files = constant(scanCaps, "GUEST_MAX_FILES");
    assert.ok(
      privacyDocText.includes(`stops at ${files} files`) &&
        privacyPageText.includes(`stops at ${files} files`),
      "both copies must name the same guest file cap, so one number cannot move alone",
    );
  });
});

// The disclosure in section 6 and on the Connect page says the rate limit
// counter holds no part of the caller's network address. That is a claim about
// convex/, so it is checked against convex/ here. If the routes ever read the
// address header again, this fails and the copy has to change with it.
describe("the counter disclosure is true of the code", () => {
  const http = read("convex", "http.ts");
  const limit = read("convex", "mcpLimit.ts");

  it("no route reads the caller address header into a key", () => {
    assert.doesNotMatch(
      http,
      /x-forwarded-for/,
      "convex/http.ts must not read the caller address: the notice says the counter holds none",
    );
    assert.doesNotMatch(
      limit,
      /\bcaller:\s*v\.string\(\)/,
      "convex/mcpLimit.ts must not take a caller value: the notice says the counter holds none",
    );
  });

  it("the notice and the Connect page both say the same thing", () => {
    for (const [name, source] of [
      ["/privacy", privacyPageText],
      ["Connect", connectText],
    ]) {
      assert.ok(
        source.includes("the counter holds no part of your network address"),
        `${name} must state that the rate limit counter holds no network address`,
      );
    }
    assert.ok(
      privacyDocText.includes("the counter holds no part of your network address"),
      "docs/PRIVACY.md must state it too",
    );
  });
});

describe("no new copy breaks the house style", () => {
  it("uses no em dash, en dash, ellipsis, or middle dot in the new surfaces", () => {
    for (const [name, source] of [
      ["Privacy.tsx", privacyPage],
      ["Connect.tsx", connect],
      ["SiteFooter.tsx", footer],
    ]) {
      for (const character of [/\u2014/, /\u2013/, /\u2026/, /\u00b7/]) {
        assert.doesNotMatch(source, character, `${name} contains ${character}`);
      }
    }
  });
});