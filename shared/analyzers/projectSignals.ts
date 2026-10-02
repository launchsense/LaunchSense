// One implementation of the project-shape signals. Both the analyzers and the
// Repo DNA panel must read these from here, otherwise a repo can be told both
// "no tests" and "you have tests" in one report.

const TEST_RUNNER_FILES = [
  "vitest.config",
  "jest.config",
  "playwright.config",
  "cypress.config",
  "pytest.ini",
  "tox.ini",
  "karma.conf",
  "vitest.workspace",
  "conftest.py",
];

export function hasTestsIn(paths: string[]): boolean {
  return paths.some((p) => {
    const lower = p.toLowerCase();
    if (lower.includes("__tests__/")) return true;
    // ".test." must be followed by a source extension, so a fixture named
    // latest.test.data.json is not mistaken for a test file.
    if (/\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb|java|kt|php|cs|swift|rs)$/.test(lower)) {
      return true;
    }
    if (/(^|\/)(test|tests|spec)\//.test(lower)) return true;
    if (/^test_.*\.py$/.test(lower)) return true;
    if (/^.*_test\.(py|go)$/.test(lower)) return true;
    // A runner config or dependency means tests exist even if we only see config.
    if (TEST_RUNNER_FILES.some((f) => lower.includes(f))) return true;
    if (/(^|\/)(vitest|jest|playwright|cypress|mocha)/.test(lower)) return true;
    return false;
  });
}

export function hasReadmeIn(paths: string[]): boolean {
  return paths.some((p) => {
    const base = (p.split("/").pop() ?? p).toLowerCase();
    return base === "readme.md" || base.startsWith("readme.");
  });
}

export function hasCIIn(paths: string[]): boolean {
  return paths.some((p) => p.toLowerCase().startsWith(".github/workflows/"));
}

export function hasLicenseIn(paths: string[]): boolean {
  return paths.some((p) => {
    const base = (p.split("/").pop() ?? p).toLowerCase();
    return (
      base === "license" ||
      base.startsWith("license.") ||
      base.startsWith("licence") ||
      base === "copying"
    );
  });
}