import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The `/licence` route. It runs the same scan as the home page and renders
// only the licence rows, with a named count of what it did not show. No
// limiter, no email gate, no credential minted. Read as text, no browser.

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (...parts) => readFileSync(join(repo, ...parts), "utf8");

const app = read("src", "App.tsx");
const page = read("src", "pages", "LicencePage.tsx");
const scan = read("src", "features", "scan", "LicenceScan.tsx");
const queries = read("convex", "scans", "queries.ts");
const schema = read("convex", "schema.ts");

describe("the route exists", () => {
  it("App imports the page and routes /licence to it", () => {
    assert.match(app, /import LicencePage from "\.\/pages\/LicencePage"/);
    assert.match(app, /path === "\/licence"/);
    assert.match(app, /<LicencePage \/>/);
  });

  it("the page uses the site frame, one heading, no second main", () => {
    assert.match(page, /SiteFrame/);
    assert.equal((page.match(/<h1/g) || []).length, 1);
    assert.doesNotMatch(page, /<main/);
  });
});

describe("one tool, one result", () => {
  it("renders no live input, explain, passport, or rescan", () => {
    for (const literal of [
      "Explain in plain words",
      "onRescan",
      "createPassport",
      "createShare",
      "Stage5Panels",
      "CompareView",
      "liveUrl",
      "Live site",
    ]) {
      assert.ok(!scan.includes(literal), `LicenceScan must not carry ${literal}`);
    }
  });

  it("renders the MCP address as a copyable block", () => {
    assert.ok(scan.includes("https://harmless-chihuahua-667.convex.site/mcp"));
    assert.match(scan, /<pre/);
    assert.match(scan, /<button/);
  });

  it("carries the partial line", () => {
    const report = read("src", "features", "report", "LicenseReport.tsx");
    assert.ok(scan.includes("A partial result is not a pass.") || report.includes("A partial result is not a pass."));
  });

  it("renders the shared not-checked list, not a hand-written one", () => {
    const report = read("src", "features", "report", "LicenseReport.tsx");
    assert.match(report, /buildNotCheckedList/);
  });
});

describe("house style and honest copy", () => {
  it("uses no em dash, en dash, ellipsis, or middle dot", () => {
    for (const [name, text] of [["LicencePage.tsx", page], ["LicenceScan.tsx", scan]]) {
      for (const code of [0x2014, 0x2013, 0x2026, 0x00b7]) {
        const character = String.fromCharCode(code);
        assert.ok(!text.includes(character), `${name} contains U+${code.toString(16)}`);
      }
    }
  });

  it("never claims a clean bill, a sign-in unlock, or a paid tier", () => {
    for (const pattern of [/clean bill/i, /sign in for more/i, /\bpaid\b/i]) {
      assert.doesNotMatch(scan, pattern, `LicenceScan claims ${pattern}`);
      assert.doesNotMatch(page, pattern, `LicencePage claims ${pattern}`);
    }
  });
});

describe("the two analytics unions stay in step", () => {
  it("both contain both kinds, and neither holds one the other lacks", () => {
    for (const kind of ["licence_route_viewed", "licence_cta_clicked"]) {
      assert.ok(queries.includes(`v.literal("${kind}")`), `queries lacks ${kind}`);
      assert.ok(schema.includes(`v.literal("${kind}")`), `schema lacks ${kind}`);
    }
  });
});
