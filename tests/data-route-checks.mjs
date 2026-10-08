import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The /data page maps every place data can sit to the code behind it.
// Read as text, no browser.

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (...parts) => readFileSync(join(repo, ...parts), "utf8");

const app = read("src", "App.tsx");
const page = read("src", "pages", "DataPolicy.tsx");
const footer = read("src", "features", "site", "SiteFooter.tsx");

describe("the data page exists and is linked", () => {
  it("App routes /data to it", () => {
    assert.match(app, /import DataPolicy from "\.\/pages\/DataPolicy"/);
    assert.match(app, /path === "\/data"/);
    assert.match(app, /<DataPolicy \/>/);
  });

  it("the page uses the site frame, one heading, no second main", () => {
    assert.match(page, /SiteFrame/);
    assert.equal((page.match(/<h1/g) || []).length, 1);
    assert.doesNotMatch(page, /<main/);
  });

  it("the footer links it beside privacy, plus the creator in a new tab", () => {
    assert.match(footer, /href="\/data"/);
    assert.match(footer, /href="\/privacy"/);
    assert.match(footer, /href="https:\/\/www\.withkeshav\.com"/);
    assert.match(footer, /target="_blank"/);
    assert.match(footer, /Keshav Maheshwari/);
  });
});

describe("every claim names the code behind it", () => {
  it("states the local read caps the review sets", () => {
    const entry = read("mcp", "review-entry.ts");
    assert.match(entry, /MAX_FILES = 5000/);
    assert.match(entry, /MAX_BYTES = 40_000_000/);
    assert.match(entry, /FILE_CAP = 100_000/);
    assert.match(page, /5,000 files and 40MB in all, 100KB per file/);
  });

  it("states the 30 day purge the retention job runs", () => {
    const retention = read("convex", "analytics", "retention.ts");
    assert.match(retention, /USAGE_EVENT_TTL_MS\s*=\s*30 \* 24 \* 60 \* 60 \* 1000/);
    assert.match(page, /deleted after 30 days/);
  });

  it("states the counter holds no network address and diagnostics stay off by default", () => {
    const flatPage = page.replace(/\s+/g, " ");
    assert.match(flatPage, /the counter holds no part of your network address/i);
    assert.match(page, /LAUNCHSENSE_DIAGNOSTICS=off/);
    assert.doesNotMatch(page, /sign in/i);
  });
});

describe("house style and honest copy", () => {
  it("uses no em dash, en dash, ellipsis, or middle dot", () => {
    for (const code of [0x2014, 0x2013, 0x2026, 0x00b7]) {
      const character = String.fromCharCode(code);
      assert.ok(!page.includes(character), `DataPolicy.tsx contains U+${code.toString(16)}`);
    }
  });

  it("claims no login, no account, and no deletion button", () => {
    assert.match(page, /No account exists anywhere/);
    assert.match(page, /What is not built yet/);
  });
});
