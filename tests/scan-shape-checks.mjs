import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// A Convex return validator rejects a document that carries a field it does not
// name. So the shape a query returns must declare every field the table can
// hold, or the query throws on a real row in every lane that reads it. This was
// not theoretical: fullScanDoc was missing surface, channel, attributed,
// attributedCallerId, commitSha, and treeSha, and fetchScan threw on every row
// createScan writes, silently breaking the live check, the rescan, and the
// explain lane. Tests that stub `v` cannot see it, so this reads the source.

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const schema = readFileSync(join(root, "convex", "schema.ts"), "utf8");
const store = readFileSync(join(root, "convex", "scans", "store.ts"), "utf8");

/** The body of a `{ ... }` block that starts at the first regex match. */
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

/** Top-level field names, which sit at 2 to 4 spaces of indentation. */
function fieldNames(body) {
  return [...body.matchAll(/^ {2,4}([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)].map((m) => m[1]);
}

describe("the fetched scan shape mirrors the schema, or the read throws", () => {
  const schemaFields = fieldNames(bracedBody(schema, /scans:\s*defineTable\(\{/));
  const docFields = fieldNames(bracedBody(store, /const fullScanDoc\s*=\s*v\.object\(\{/));

  it("finds the two shapes it is comparing", () => {
    assert.ok(schemaFields.length > 20, `expected the scans table fields, got ${schemaFields.length}`);
    assert.ok(docFields.length > 20, `expected the fullScanDoc fields, got ${docFields.length}`);
  });

  it("declares every scans field in fullScanDoc, so no real row is rejected", () => {
    const missing = schemaFields.filter((name) => !docFields.includes(name));
    assert.deepEqual(
      missing,
      [],
      `fullScanDoc is missing ${missing.join(", ")}; a Convex return validator rejects a row that carries an undeclared field`,
    );
  });

  it("declares the Convex system fields, which every document carries", () => {
    for (const field of ["_id", "_creationTime"]) {
      assert.ok(docFields.includes(field), `fullScanDoc must declare ${field}`);
    }
  });
});
