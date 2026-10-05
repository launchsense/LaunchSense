import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

// The front end calls Convex functions by name: `api.scans.queries.getResults`.
// If a Convex function is renamed or removed, TypeScript catches most of it, but
// a string or a dynamic call can slip through, and the generated bindings only
// check the module, not every function. This reads the source on both sides and
// requires every `api.<module>.<fn>` used in src/ to exist in convex/.

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "_generated" || name === "dist") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

function usedReferences() {
  const refs = new Map();
  for (const file of walk("src")) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/\bapi\.([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)\.([a-zA-Z0-9_]+)/g)) {
      const modulePath = m[1];
      const fn = m[2];
      if (modulePath === "internal" || fn === "internal") continue;
      refs.set(`${modulePath}.${fn}`, { modulePath, fn, file });
    }
  }
  return refs;
}

describe("src/ references match convex/ functions", () => {
  const refs = usedReferences();

  it("finds api references to check", () => {
    assert.ok(refs.size > 5, `expected several api references, found ${refs.size}`);
  });

  it("resolves every referenced function to an export", () => {
    const missing = [];
    for (const { modulePath, fn, file } of refs.values()) {
      const convexFile = join("convex", `${modulePath.split(".").join("/")}.ts`);
      if (!existsSync(convexFile)) {
        missing.push(`${file}: api.${modulePath}.${fn} has no module ${convexFile}`);
        continue;
      }
      const source = readFileSync(convexFile, "utf8");
      if (!new RegExp(`export const ${fn}\\b`).test(source)) {
        missing.push(`${file}: api.${modulePath}.${fn} is not exported by ${convexFile}`);
      }
    }
    assert.deepEqual(missing, [], `missing Convex functions:\n${missing.join("\n")}`);
  });
});
