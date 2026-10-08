import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The one link: /start holds the whole setup in order, for every harness.
// Read as text, no browser.

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (...parts) => readFileSync(join(repo, ...parts), "utf8");

const app = read("src", "App.tsx");
const start = read("src", "pages", "Start.tsx");

describe("the start page is the one link", () => {
  it("App routes /start to it", () => {
    assert.match(app, /import Start from "\.\/pages\/Start"/);
    assert.match(app, /path === "\/start"/);
    assert.match(app, /<Start \/>/);
  });

  it("the page uses the site frame, one heading, no second main", () => {
    assert.match(start, /SiteFrame/);
    assert.equal((start.match(/<h1/g) || []).length, 1);
    assert.doesNotMatch(start, /<main/);
  });

  it("covers three steps plus stuck help, with the setup prompt to copy", () => {
    for (const step of ["1. Paste one line", "2. Answer two questions", "3. Paste the setup prompt", "4. What happens next", "If you get stuck"]) {
      assert.ok(start.includes(step), `the start page is missing: ${step}`);
    }
    assert.match(start, /SETUP_PROMPT/);
  });

  it("shows no commands and sends agents to the brief", () => {
    assert.doesNotMatch(start, /git clone/);
    assert.match(start, /\/install\.txt/);
    const brief = read("public", "install.txt");
    for (const name of ["Cursor", "Claude Code", "Codex", "OpenCode", "Antigravity", "Grok"]) {
      assert.ok(brief.includes(name), `the brief names no ${name} setup`);
    }
    assert.match(brief, /launchsense-policy/);
    assert.match(brief, /LAUNCHSENSE_ROOT/);
  });

  it("says honestly where a web page cannot reach", () => {
    assert.match(start, /a web page cannot reach your machine/);
  });
});

describe("house style and honest copy", () => {
  it("uses no em dash, en dash, ellipsis, or middle dot", () => {
    for (const code of [0x2014, 0x2013, 0x2026, 0x00b7]) {
      const character = String.fromCharCode(code);
      assert.ok(!start.includes(character), `Start.tsx contains U+${code.toString(16)}`);
    }
  });

  it("promises nothing the code does not do", () => {
    for (const pattern of [/fully\s+scans?/i, /every file/i, /guaranteed?/i, /deeper scan/i, /coming soon/i, /secure your project/i]) {
      assert.doesNotMatch(start, pattern, `Start.tsx claims ${pattern}`);
    }
  });
});
