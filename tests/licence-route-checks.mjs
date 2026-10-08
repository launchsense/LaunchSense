import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The `/licence`, `/s/`, and `/p/` routes are archived. No scan runs here.
// Read as text, no browser.

import { existsSync } from "node:fs";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (...parts) => readFileSync(join(repo, ...parts), "utf8");

const app = read("src", "App.tsx");

describe("the route is archived", () => {
  it("App unroutes /licence and the share and passport pages", () => {
    assert.doesNotMatch(app, /import LicencePage from "\.\/pages\/LicencePage"/);
    assert.doesNotMatch(app, /<LicencePage \/>/);
    assert.doesNotMatch(app, /<SharePage/);
    assert.doesNotMatch(app, /<PassportPage/);
    assert.match(app, /path\.startsWith\("\/s\/"\)/);
    assert.match(app, /path\.startsWith\("\/p\/"\)/);
    assert.match(app, /path === "\/licence"/);
    assert.match(app, /<Archived \/>/);
  });

  it("the archived files are deleted", () => {
    for (const f of [
      "src/pages/LicencePage.tsx",
      "src/features/scan/LicenceScan.tsx",
      "src/pages/SharePage.tsx",
      "src/pages/PassportPage.tsx",
      "src/features/scan/GuestScan.tsx",
    ]) {
      assert.equal(existsSync(join(repo, ...f.split("/"))), false, `${f} must be deleted`);
    }
  });
});
