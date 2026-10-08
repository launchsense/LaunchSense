import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// W7. Accessibility facts that can be read from source. Anything requiring a
// real screen reader or a physical device is not asserted here, because
// asserting it from source would be asserting a guess.

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const tsxFiles = walk(join(repo, "src"));
const app = readFileSync(join(repo, "src/App.tsx"), "utf8");

describe("archived routes render an archived notice", () => {
  it("unroutes share, passport, and licence to Archived", () => {
    for (const route of ['"/s/"', '"/p/"', '"/licence"']) {
      assert.ok(app.includes(route), `App does not handle ${route}`);
    }
    assert.match(app, /<Archived \/>/);
  });
});

describe("skip link", () => {
  it("is the first focusable element on every page", () => {
    const frame = readFileSync(join(repo, "src/features/site/SiteFrame.tsx"), "utf8");
    assert.match(frame, /className="skip-link"/);
    assert.match(frame, /href="#main-content"/);
    assert.match(frame, /Skip to content/);
  });

  it("targets a focusable main landmark", () => {
    const frame = readFileSync(join(repo, "src/features/site/SiteFrame.tsx"), "utf8");
    assert.match(frame, /id="main-content"/);
    assert.match(frame, /tabIndex=\{-1\}/);
    for (const page of ["Home.tsx"]) {
      const source = readFileSync(join(repo, "src/pages", page), "utf8");
      assert.match(source, /SiteFrame/, `${page} does not use the site frame`);
    }
  });
});

describe("every page has one main landmark", () => {
  it("no page renders two", () => {
    const frame = readFileSync(join(repo, "src/features/site/SiteFrame.tsx"), "utf8");
    const mains = [...frame.matchAll(/<main[^>]*id="main-content"/g)];
    assert.equal(mains.length, 1);
    for (const page of ["Home.tsx"]) {
      const source = readFileSync(join(repo, "src/pages", page), "utf8");
      assert.doesNotMatch(source, /<main/, `${page} adds a second main`);
    }
  });
});

describe("interactive controls are real controls", () => {
  it("uses button elements rather than clickable divs", () => {
    for (const file of tsxFiles) {
      const source = readFileSync(file, "utf8");
      const name = file.replace(repo + "/", "");
      assert.doesNotMatch(source, /<div[^>]*onClick/, `${name} uses a clickable div`);
    }
  });

  it("labels every input", () => {
    for (const file of tsxFiles) {
      const source = readFileSync(file, "utf8");
      const name = file.replace(repo + "/", "");
      const inputs = [...source.matchAll(/<input\b/g)].length;
      const labels = [...source.matchAll(/<label\b/g)].length;
      const ariaLabels = [...source.matchAll(/aria-label=/g)].length;
      assert.ok(
        inputs === 0 || labels + ariaLabels >= inputs,
        `${name} has ${inputs} inputs but only ${labels + ariaLabels} labels`,
      );
    }
  });
});

describe("states are announced", () => {
  it("uses no fake dynamic states on a static position page", () => {
    const all = tsxFiles.map((f) => readFileSync(f, "utf8")).join("\n");
    assert.doesNotMatch(all, /role="status"/);
    assert.doesNotMatch(all, /role="alert"/);
  });
});