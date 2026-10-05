import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// CI runs the gate on every push, but a red commit should stop before it leaves
// the machine rather than at the pull request. A local pre-push hook runs the
// same command. These rules check the hook exists, runs the whole gate, is
// executable, and is actually wired up by `prepare`.

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (rel) => readFileSync(join(root, rel), "utf8");

describe("a push runs the gate before it leaves the machine", () => {
  it("ships a pre-push hook that runs the same gate CI runs", () => {
    const hook = read(".githooks/pre-push");
    assert.match(hook, /npm run check/, "the hook must run the whole gate, not a subset");
    assert.match(hook, /git push --no-verify/, "the bypass must be documented in the hook itself");
  });

  it("marks the hook executable, or git will not run it", () => {
    const mode = statSync(join(root, ".githooks", "pre-push")).mode;
    assert.ok(mode & 0o111, "the pre-push hook must carry an executable bit");
  });

  it("points git at the hook directory, so the hook is used and not just committed", () => {
    const pkg = JSON.parse(read("package.json"));
    const prepare = pkg.scripts?.prepare ?? "";
    assert.match(
      prepare,
      /core\.hooksPath\s+\.githooks/,
      "an npm install must set core.hooksPath to .githooks, or the hook is dead weight",
    );
  });
});
