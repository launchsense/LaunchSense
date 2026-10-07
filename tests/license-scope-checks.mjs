import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The MIT boundary, pinned. Three defects, one file of tests.
//
// 1. A directory grant rots: a new file loads a proprietary module and the
//    open set silently stops being standalone. The grant names paths, so the
//    test walks those paths and refuses any module load that resolves outside
//    them. Text reads do not count, only loads.
// 2. The exclusion list rots in either direction: a new proprietary-loading
//    test ships without an exclusion, or a dead exclusion stays. Both are
//    pinned, so the list tracks the tree.
// 3. The licence text drifts from the tree: Section 1 names paths that moved,
//    or the badge and the notice disagree. The test reads the licence and the
//    tree together, so neither can move alone.
//
// No network, no database, and no clock. Everything is repo text.

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

function read(...parts) {
  return readFileSync(join(repo, ...parts), "utf8");
}

const license = read("LICENSE.txt");

// The MIT zone, exactly as LICENSE.txt Section 1 grants it.
const OPEN_DIRS = [
  "shared",
  "convex/adapters",
  "mcp",
  "skills/launchsense",
  "install.sh",
  "scripts",
  "tests",
];
const OPEN_FILES = ["convex/scans/snapshot.ts"];
// Tests that load proprietary modules, and stay proprietary with the
// surfaces they verify. The rule is functional: any test file that imports
// or loads a module outside the open zone stays out of the grant, and this
// list is complete as of this writing.
const EXCLUDED = [
  "tests/ai-lane-gate-checks.mjs",
  "tests/analytics-lane-checks.mjs",
  "tests/analytics-pii-checks.mjs",
  "tests/consent-record-lane-checks.mjs",
  "tests/decision-monitoring-checks.mjs",
  "tests/identity-attribution-checks.mjs",
  "tests/livecheck-ownership-checks.mjs",
  "tests/mcp-provenance-checks.mjs",
  "tests/mcp-remote-checks.mjs",
  "tests/red-team-checks.mjs",
  "tests/signin-resume-checks.mjs",
];

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(join(repo, dir))) {
    if (entry === "node_modules") continue;
    const full = join(repo, dir, entry);
    const rel = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(rel));
    else out.push(rel);
  }
  return out;
}

function inOpenZone(target) {
  const normalized = target.replace(/\\/g, "/");
  if (OPEN_FILES.includes(normalized)) return true;
  return OPEN_DIRS.some(
    (dir) => normalized === dir || normalized.startsWith(`${dir}/`),
  );
}

// Resolve a module load to a repo path, or null for packages, aliases, and
// unreadable shapes. Covers static import and require, dynamic import through
// new URL, and the stub-loader calls the suite uses to load Convex modules
// with fakes. Extensions cover ts, tsx, mjs, js, and go, plus index files,
// and a query string is stripped before resolving.
function resolveLoad(from, spec) {
  const clean = spec.split("?")[0];
  let base;
  if (clean.startsWith(".")) {
    base = resolve(repo, dirname(from), clean);
  } else if (!clean.includes(":") && !clean.startsWith("node:")) {
    base = join(repo, clean);
  } else {
    return null;
  }
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mjs`,
    `${base}.js`,
    `${base}.go`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        return candidate.slice(repo.length + 1).replace(/\\/g, "/");
      }
    } catch {
      continue;
    }
  }
  return null;
}

function loadsOf(file, text) {
  // Only module loads count. A text read (readFileSync, readRepo) asserts on
  // words and executes nothing, so bare new URL targets are ignored and only
  // import(new URL(...)) counts as a load.
  const specs = new Set();
  for (const match of text.matchAll(
    /(?:import|require)\s*(?:[^'"]*from\s*)?['"]([^'"]+)['"]/g,
  )) {
    specs.add(match[1]);
  }
  for (const match of text.matchAll(/import\(\s*new URL\(["']([^"']+)["']/g)) {
    specs.add(match[1]);
  }
  for (const match of text.matchAll(/loadWithStubs\(["']([^"']+)["']/g)) {
    specs.add(match[1]);
  }
  for (const match of text.matchAll(/loadIfPresent\(["']([^"']+)["']/g)) {
    specs.add(match[1]);
  }
  return [...specs];
}

describe("the MIT grant matches the tree", () => {
  it("carries the verbatim MIT grant exactly once, inside a scoped section", () => {
    const grant = (license.match(/Permission is hereby granted, free of charge/g) || []).length;
    assert.equal(grant, 1, "the MIT grant must appear exactly once");
    const warranty = (license.match(/THE SOFTWARE IS PROVIDED "AS IS"/g) || []).length;
    assert.equal(warranty, 1, "the MIT warranty disclaimer must appear exactly once");
    assert.match(license, /apply ONLY to the files under these paths/);
  });

  it("names the open paths and every exclusion", () => {
    for (const path of [...OPEN_DIRS, ...OPEN_FILES]) {
      assert.ok(license.includes(path), `LICENSE.txt Section 1 is missing ${path}`);
    }
    for (const path of EXCLUDED) {
      assert.ok(license.includes(path), `LICENSE.txt must name the exclusion ${path}`);
    }
  });

  it("grants no path that does not exist", () => {
    for (const path of [...OPEN_DIRS, ...OPEN_FILES, ...EXCLUDED]) {
      assert.ok(existsSync(join(repo, path)), `LICENSE.txt names ${path}, which does not exist`);
    }
  });

  it("keeps proprietary module loads out of the open zone", () => {
    // Text reads (readFileSync, readRepo) are not loads: they assert on words,
    // they execute nothing. Only module loads matter, because only a load
    // makes the open file depend on proprietary code at runtime.
    const failures = [];
    const sources = [];
    for (const dir of OPEN_DIRS) {
      if (dir.endsWith(".sh")) {
        sources.push(dir);
        continue;
      }
      sources.push(...listFiles(dir).filter((f) => /\.(ts|tsx|mjs|go)$/.test(f)));
    }
    sources.push(...OPEN_FILES);
    for (const file of sources) {
      if (EXCLUDED.includes(file)) continue;
      let text = "";
      try {
        text = read(file);
      } catch {
        continue;
      }
      for (const spec of loadsOf(file, text)) {
        const resolved = resolveLoad(file, spec);
        if (resolved === null) continue;
        if (!inOpenZone(resolved)) {
          failures.push(`${file} loads proprietary ${resolved}`);
        }
      }
    }
    assert.deepEqual(failures, [], `open files load proprietary modules:\n${failures.join("\n")}`);
  });

  it("excludes every test that loads proprietary modules, and nothing else", () => {
    // The exclusion list is complete: remove one entry and this fails on its
    // loads, add an unneeded one and the count below fails. Both directions
    // are pinned so the list cannot rot in either direction.
    const withLoads = [];
    for (const file of listFiles("tests").filter((f) => f.endsWith(".mjs"))) {
      const text = read(file);
      const bad = loadsOf(file, text)
        .map((spec) => resolveLoad(file, spec))
        .filter((resolved) => resolved !== null && !inOpenZone(resolved));
      if (bad.length > 0) withLoads.push(file);
    }
    assert.deepEqual(
      withLoads.sort(),
      [...EXCLUDED].sort(),
      "the exclusion list drifted from the files that load proprietary modules",
    );
  });
});

describe("the public copy agrees with the grant", () => {
  it("badges and describes open core, not proprietary", () => {
    const readme = read("README.md");
    assert.match(readme, /MIT open core/);
    assert.doesNotMatch(readme, /visible for review only/);
  });

  it("tells the harness the repo is open core", () => {
    assert.match(read("llms.txt"), /open core/);
  });

  it("records contributor sign-off", () => {
    assert.ok(existsSync(join(repo, "CONTRIBUTING.md")), "CONTRIBUTING.md must exist");
    const contributing = read("CONTRIBUTING.md");
    assert.match(contributing, /Signed-off-by/);
    assert.match(contributing, /git commit -s/);
  });
});
