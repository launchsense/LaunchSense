import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The closing copy: the share image, the warm busy line, and the honest
// privacy page. Read as text, no browser.

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (...parts) => readFileSync(join(repo, ...parts), "utf8");

describe("the share image", () => {
  it("ships a real PNG and names it in absolute tags", () => {
    const img = join(repo, "public/og.png");
    assert.ok(existsSync(img), "public/og.png must exist");
    assert.equal(readFileSync(img).subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.ok(statSync(img).size > 20000, "the image must be a real render, not a stub");
    const html = read("index.html");
    assert.ok(html.includes('property="og:image"'));
    assert.ok(html.includes("https://harmless-chihuahua-667.convex.site/og.png"));
  });
});

describe("the busy line offers the free local path", () => {
  it("Home and Connect both name the local check, with no hosted busy line", () => {
    for (const file of ["src/pages/Home.tsx", "src/pages/Connect.tsx"]) {
      const source = read(...file.split("/"));
      assert.ok(source.includes("local"), `${file} must name the local check`);
    }
    assert.equal(existsSync(join(repo, "src", "features", "scan", "GuestScan.tsx")), false);
  });
});

describe("the privacy page promises no live check", () => {
  it("names no live site or live app check", () => {
    assert.doesNotMatch(read("src", "pages", "Privacy.tsx"), /live (site|app) check/i);
  });
});
