import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Three breakages arrived with Wave 6 and left production scans failing, the
// report 500ing, and the nightly rollup empty. These read the source so the
// exact defects cannot come back.

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (rel) => readFileSync(join(root, rel), "utf8");

function bracedBody(text, startRe) {
  const match = text.match(startRe);
  assert.ok(match, `pattern not found: ${startRe}`);
  let i = match.index + match[0].length;
  let depth = 1;
  let out = "";
  while (i < text.length && depth > 0) {
    const ch = text[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    if (depth > 0) out += ch;
    i += 1;
  }
  return out;
}

function fieldNames(body) {
  return [...body.matchAll(/^ {2,4}([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)].map((m) => m[1]);
}

describe("the tree is requested by the tree sha, not the commit sha", () => {
  // GitHub echoes the requested value in the tree response's `sha`. Requesting by
  // the commit sha returns the commit sha, so the cross-check against
  // commit.tree.sha rejected every valid scan.
  for (const file of ["convex/scans/actions.ts", "convex/scans/rescan.ts"]) {
    it(`${file} builds the tree url from commitTreeSha`, () => {
      const source = read(file);
      assert.match(source, /const treeRef = commitTreeSha \?\? sha;/);
      assert.match(source, /treeRequestUrl\(owner, repo, treeRef\)/);
      assert.doesNotMatch(
        source,
        /treeRequestUrl\(owner, repo, sha\)/,
        "the tree must not be requested by the commit sha",
      );
    });
  }
});

describe("the public scan shape mirrors the schema", () => {
  const schema = read("convex/schema.ts");
  const queries = read("convex/scans/queries.ts");
  const schemaFields = fieldNames(bracedBody(schema, /scans:\s*defineTable\(\{/));
  const shape = bracedBody(queries, /const scanFields\s*=\s*\{/);
  const shapeFields = fieldNames(shape);

  it("declares every scans field, so a new scan row is not rejected", () => {
    const missing = schemaFields.filter((name) => !shapeFields.includes(name));
    assert.deepEqual(
      missing,
      [],
      `scanFields is missing ${missing.join(", ")}; a public validator rejects a row that carries an undeclared field`,
    );
  });
});

describe("the rollup uses no paginated query", () => {
  it("does not call .paginate(), which Convex allows only once per function", () => {
    const rollup = read("convex/analytics/rollup.ts");
    // Comments may name the call this lane removed; code may not make it.
    const code = rollup.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    assert.doesNotMatch(
      code,
      /\.paginate\(/,
      "two tables in one function cannot both paginate; use a bounded .take() instead",
    );
    assert.match(code, /\.take\(scanCap\)/);
    assert.match(code, /\.take\(transitionCap\)/);
  });
});
