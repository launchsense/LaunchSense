// Every new commit carries a Signed-off-by trailer (DCO 1.1). This script
// fails when any commit this branch adds on top of origin/main lacks one.
// Merge commits are skipped: GitHub writes those, not the author. On a
// checkout with no upstream, or exactly at the merge base, there is nothing
// new to check and it passes. History before the DCO rule is grandfathered:
// only the range is checked, never the past.
import { execSync } from "node:child_process";

function sh(command) {
  try {
    return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

const SHAPE = /^Signed-off-by: .+ <.+@.+>$/m;

const range = sh("git rev-list --no-merges origin/main..HEAD");
if (range === null) {
  console.warn("check-dco: no upstream origin/main, checking HEAD only");
  const single = sh("git log --no-walk --format=%B HEAD");
  if (single === null || single.length === 0) {
    console.warn("check-dco: no commits found, skipping");
    process.exit(0);
  }
  if (!SHAPE.test(single)) {
    console.error("check-dco: HEAD is missing a Signed-off-by trailer");
    console.error("check-dco: sign with git commit -s, see CONTRIBUTING.md");
    process.exit(1);
  }
  console.log("check-dco: HEAD signed");
  process.exit(0);
}

const hashes = range.split("\n").map((line) => line.trim()).filter(Boolean);
if (hashes.length === 0) {
  console.log("check-dco: no new commits, nothing to check");
  process.exit(0);
}

let failed = 0;
for (const hash of hashes) {
  const body = sh(`git log --no-walk --format=%B ${hash}`) ?? "";
  const first = body.split("\n")[0] ?? "(empty)";
  if (!SHAPE.test(body)) {
    console.error(`check-dco: ${hash.slice(0, 7)} missing Signed-off-by trailer: ${first}`);
    failed += 1;
  }
}
if (failed > 0) {
  console.error("check-dco: sign with git commit -s, see CONTRIBUTING.md");
  process.exit(1);
}
console.log(`check-dco: ${hashes.length} new commit(s) signed`);
