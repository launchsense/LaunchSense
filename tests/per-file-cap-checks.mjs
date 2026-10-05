import { test } from "node:test";
import assert from "node:assert/strict";
import { scanSecrets } from "../shared/analyzers/secrets.ts";

// The match cap must be per-FILE, not repo-global. A repo-global cap saturated at
// 20 and hid later files entirely, a silent miss. Each file gets its own budget.

function noisyLines(n) {
  // Each line is a credential-shaped assignment the analyzer will match.
  return Array.from({ length: n }, (_, i) => `password = "Str0ngSecret-Val-${i}xxxx"`).join("\n");
}

test("the cap is per file: a second file still produces findings", () => {
  const files = [
    { path: "a.py", content: noisyLines(25) },
    { path: "b.py", content: noisyLines(5) },
  ];
  const hits = scanSecrets(files);
  const a = hits.filter((h) => h.path === "a.py").length;
  const b = hits.filter((h) => h.path === "b.py").length;
  // First file is capped at 20, but the second file is NOT starved.
  assert.equal(a, 20, "the first file is capped at the per-file limit");
  assert.equal(b, 5, "the second file is judged on its own budget, not starved");
});

test("a single file under the cap is unaffected", () => {
  const hits = scanSecrets([{ path: "small.py", content: noisyLines(3) }]);
  assert.equal(hits.length, 3);
});

test("many small files each keep their own budget", () => {
  const files = Array.from({ length: 10 }, (_, i) => ({
    path: `f${i}.py`,
    content: noisyLines(3),
  }));
  const hits = scanSecrets(files);
  assert.equal(hits.length, 30, "10 files x 3 hits each, none starved by a global cap");
});
