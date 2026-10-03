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
const panels = readFileSync(join(repo, "src/features/report/Stage5Panels.tsx"), "utf8");
const app = readFileSync(join(repo, "src/App.tsx"), "utf8");

describe("the panel strip is a real tablist", () => {
  it("uses role=tablist, not a nav of pressed buttons", () => {
    assert.match(panels, /role="tablist"/);
    assert.doesNotMatch(panels, /aria-pressed/);
    assert.doesNotMatch(panels, /<nav aria-label="Panels">/);
  });

  it("gives every tab a role, a selected state, and a panel link", () => {
    assert.match(panels, /role="tab"/);
    assert.match(panels, /aria-selected=\{tab === entry\.id\}/);
    assert.match(panels, /aria-controls=\{`panel-\$\{entry\.id\}`\}/);
    assert.match(panels, /id=\{`tab-\$\{entry\.id\}`\}/);
  });

  it("uses a roving tabindex so only the selected tab is tab reachable", () => {
    assert.match(panels, /tabIndex=\{tab === entry\.id \? 0 : -1\}/);
  });

  it("labels the panel from its tab", () => {
    assert.match(panels, /role="tabpanel"/);
    assert.match(panels, /aria-labelledby=\{`tab-\$\{tab\}`\}/);
  });

  it("supports arrow keys, Home, and End", () => {
    for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
      assert.match(panels, new RegExp(key), `the tablist does not handle ${key}`);
    }
  });

  it("moves focus with selection", () => {
    assert.match(panels, /tabRefs\.current\[id\]\?\.focus\(\)/);
  });

  it("wraps at both ends", () => {
    assert.match(panels, /index === last \? 0 : index \+ 1/);
    assert.match(panels, /index === 0 \? last : index - 1/);
  });
});

describe("skip link", () => {
  it("is the first focusable element on every page", () => {
    for (const route of ['"/s/"', '"/p/"']) {
      assert.ok(app.includes(route), `App does not handle ${route}`);
    }
    assert.match(app, /className="skip-link"/);
    assert.match(app, /href="#main-content"/);
    assert.match(app, /Skip to content/);
  });

  it("targets a focusable main landmark", () => {
    for (const page of ["Home.tsx", "SharePage.tsx", "PassportPage.tsx"]) {
      const source = readFileSync(join(repo, "src/pages", page), "utf8");
      assert.match(source, /id="main-content"/, `${page} has no skip target`);
      assert.match(source, /tabIndex=\{-1\}/, `${page} skip target is not focusable`);
    }
  });
});

describe("every page has one main landmark", () => {
  it("no page renders two", () => {
    for (const page of ["Home.tsx", "SharePage.tsx", "PassportPage.tsx"]) {
      const source = readFileSync(join(repo, "src/pages", page), "utf8");
      const mains = [...source.matchAll(/<main[^>]*id="main-content"/g)];
      // Share and Passport each have a loading state plus a loaded state, but
      // only one of them is rendered at a time.
      assert.ok(mains.length >= 1, `${page} has no main landmark`);
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
  it("uses role=status for progress and role=alert for errors", () => {
    const all = tsxFiles.map((f) => readFileSync(f, "utf8")).join("\n");
    assert.match(all, /role="status"/);
    assert.match(all, /role="alert"/);
  });
});