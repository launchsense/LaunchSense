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

function newCommits() {
  const range = sh("git rev-list --no-merges origin/main..HEAD");
  if (range !== null) return range.split("\n").map((line) => line.trim()).filter(Boolean);
  // No upstream: shallow CI checkouts and fresh clones. If HEAD is a merge
  // commit (a pull request checkout), the branch side is its second parent.
  const parents = sh("git rev-list --parents --no-walk HEAD");
  const parts = parents === null ? [] : parents.split(/\s+/).filter(Boolean);
  if (parts.length > 2) {
    const pr = sh(`git rev-list --no-merges ${parts[0]}^2 --not ${parts[0]}^1`);
    if (pr === null) return null;
    return pr.split("\n").map((line) => line.trim()).filter(Boolean);
  }
  return parts.length >= 1 ? [parts[0]] : null;
}

const hashes = newCommits();
if (hashes === null) {
  console.warn("check-dco: history is not walkable here, skipping");
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
