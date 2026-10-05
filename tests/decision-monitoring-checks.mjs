import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { GEMINI_MODEL } from "../convex/adapters/ai.ts";

// The decision-source reading, the usage write route, and the provider-call
// row. Three things this file holds:
//   1. the reading never invents a metric it does not have, and never grades a rung
//   2. the usage route is not an open write
//   3. a stored provider call names the model the lane actually called
//
// Convex modules import `./_generated/*` and `convex/values`, which do not
// resolve outside the Convex runtime. `loadWithStubs` copies a module into a
// temp directory with those imports pointed at stubs, so the real handlers run
// here against a fake ctx instead of being read as text.

const repoRoot = new URL("../", import.meta.url);
const readRepo = (rel) => readFileSync(new URL(rel, repoRoot), "utf8");

const raw = readRepo("convex/decisionMonitoring.ts");
const http = readRepo("convex/http.ts");
const aiExplainRaw = readRepo("convex/scans/aiExplain.ts");
// Comments say what the code must never do, so they are stripped before the
// assertions below look for that behaviour. Only executable code is checked.
const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const tmpRoot = join("/tmp/opencode", "a7-tests");
const madeDirs = [];

const SERVER_STUB = `
export const internalQuery = (spec) => spec;
export const internalMutation = (spec) => spec;
export const query = (spec) => spec;
export const mutation = (spec) => spec;
export const action = (spec) => spec;
export const internalAction = (spec) => spec;
`;
const VALUES_STUB = `
export const v = new Proxy({}, { get: () => () => ({}) });
`;
const API_STUB = `
export const internal = { scans: { store: { fetchScan: "fetchScan", listFindings: "listFindings" } }, mcpLimit: { consumeExplain: "consumeExplain" } };
export const api = {};
export const components = {};
`;

const slug = (specifier) => specifier.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");

// Rewrites an import specifier to something that resolves from the temp copy.
// Convex-only specifiers get a stub, repo modules keep the real file behind an
// absolute file URL.
function mapSpecifier(specifier, relPath, extras) {
  if (specifier.endsWith("_generated/server")) return "./_generated/server.js";
  if (specifier.endsWith("_generated/api")) return "./_generated/api.js";
  if (specifier.endsWith("_generated/dataModel")) return "./_generated/api.js";
  if (specifier === "convex/values") return "./values.js";
  if (Object.prototype.hasOwnProperty.call(extras, specifier)) return `./${slug(specifier)}.js`;
  if (specifier.startsWith(".")) {
    const dir = new URL(".", new URL(relPath, repoRoot));
    const url = new URL(specifier, dir);
    if (url.pathname.endsWith("/")) url.pathname += "index.ts";
    else if (!url.pathname.endsWith(".ts") && !url.pathname.endsWith(".js")) url.pathname += ".ts";
    return url.href;
  }
  return specifier;
}

async function loadWithStubs(relPath, extras = {}) {
  mkdirSync(tmpRoot, { recursive: true });
  const dir = mkdtempSync(join(tmpRoot, "load-"));
  madeDirs.push(dir);
  mkdirSync(join(dir, "_generated"), { recursive: true });
  writeFileSync(join(dir, "_generated", "server.js"), SERVER_STUB);
  writeFileSync(join(dir, "_generated", "api.js"), API_STUB);
  writeFileSync(join(dir, "values.js"), VALUES_STUB);
  for (const [specifier, code] of Object.entries(extras)) {
    writeFileSync(join(dir, `${slug(specifier)}.js`), code);
  }
  const patched = readRepo(relPath)
    .replace(/^[ \t]*import\s+type[^\n]*$/gm, "")
    .replace(/from\s+"([^"]+)"/g, (_match, specifier) => `from "${mapSpecifier(specifier, relPath, extras)}"`);
  writeFileSync(join(dir, "module.ts"), patched);
  return import(pathToFileURL(join(dir, "module.ts")).href);
}

after(() => {
  for (const dir of madeDirs) rmSync(dir, { recursive: true, force: true });
});

// A fake ctx.db that records what the query asked for, so an index range and a
// row cap are checked by what the code does rather than by how it is worded.
function makeCtx(rows) {
  const calls = [];
  const range = {};
  range.gte = (field, value) => {
    calls.push({ rangeOp: "gte", field, value });
    return range;
  };
  range.eq = (field, value) => {
    calls.push({ rangeOp: "eq", field, value });
    return range;
  };
  const ctx = {
    db: {
      query(table) {
        calls.push({ table });
        return {
          withIndex(name, rangeFn) {
            calls.push({ index: name, hasRange: typeof rangeFn === "function" });
            if (typeof rangeFn === "function") rangeFn(range);
            const chain = {
              order(direction) {
                calls.push({ order: direction });
                return chain;
              },
              take: async (n) => {
                calls.push({ take: n });
                return rows.slice(0, n);
              },
              collect: async () => {
                calls.push({ collect: true });
                return rows;
              },
              unique: async () => {
                calls.push({ unique: true });
                return rows[0] ?? null;
              },
            };
            return chain;
          },
        };
      },
    },
  };
  return { ctx, calls };
}

const today = () => new Date().toISOString().slice(0, 10);

const dayRows = [
  { day: today(), orderSource: "table", durationMs: 12, createdAt: Date.now() },
  { day: today(), orderSource: "jev", durationMs: 8, createdAt: Date.now() },
];

describe("decision-source monitoring", () => {
  it("reads only stored fields: counts, a source name, and a duration", () => {
    assert.match(source, /usageDiagnostics/);
    assert.match(source, /orderSource/);
    assert.match(source, /durationMs/);
    // No file text, no repo name, no finding text leaves the table.
    assert.ok(!/fileText|snippet|repoUrl|filePath/.test(source), "the reading must not carry file content");
  });

  it("names the metrics it cannot produce instead of leaving them implied", () => {
    // These live in a returned string, so they are checked against the raw file.
    assert.match(raw, /notMeasured/);
    assert.match(raw, /Rung accuracy against the rule table/);
    assert.match(raw, /Swap consistency/);
    assert.match(raw, /Reorder counts/);
  });

  it("treats an unobserved rung as unobserved, not as a failing one", () => {
    // A source with no rows simply does not appear. Nothing maps absence to bad.
    assert.match(source, /\[...sources\.entries\(\)\]/);
    assert.ok(!/zero.*(fail|bad|broken)/i.test(raw), "absence must not be scored");
  });

  it("never reorders, promotes, or retires a rung", () => {
    for (const forbidden of [/\.sort\([^)]*source[^)]*(asc|<)/i, /retire|promote|reward/i]) {
      assert.ok(!forbidden.test(source), `the reading must not contain ${forbidden}`);
    }
  });

  it("is an internal query: the reading is not a public endpoint", () => {
    assert.match(source, /internalQuery\(/);
    assert.ok(!/export const \w+ = query\(/.test(source), "no public query for this reading");
  });

  it("reads a day index range with a row cap instead of collecting the whole table", async () => {
    const mod = await loadWithStubs("convex/decisionMonitoring.ts");
    const { ctx, calls } = makeCtx(dayRows);
    const result = await mod.decisionSourceDistribution.handler(ctx, { days: 7 });

    const indexCall = calls.find((call) => call.index === "by_day");
    assert.ok(indexCall, "the reading must use the by_day index");
    assert.equal(indexCall.hasRange, true, "the by_day index must be read with a range");

    const gte = calls.find((call) => call.rangeOp === "gte");
    assert.ok(gte, "the range must be a gte on day");
    assert.equal(gte.field, "day");
    const expectedSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    assert.equal(gte.value, expectedSince);

    assert.ok(
      calls.some((call) => typeof call.take === "number"),
      "the reading must cap how many rows one call takes",
    );
    assert.ok(
      !calls.some((call) => call.collect === true),
      "the reading must not collect the whole table",
    );
    assert.equal(result.total, 2, "the window still reports every row it read");
  });

  it("counts table-order rows under an honest name: one table row plus one jev row is 1, not a fallback count", async () => {
    const mod = await loadWithStubs("convex/decisionMonitoring.ts");
    const { ctx } = makeCtx(dayRows);
    const result = await mod.decisionSourceDistribution.handler(ctx, { days: 7 });

    assert.deepEqual(
      Object.fromEntries(result.days[0].bySource.map((entry) => [entry.source, entry.scans])),
      { table: 1, jev: 1 },
      "both sources are counted once",
    );
    assert.equal(result.tableOrderRows, 1, "one stored table row is one table-order row");
    assert.equal(result.days[0].tableOrderRows, 1, "the day block reports the same count");
    assert.equal(result.totalsBySource.find((entry) => entry.source === "table")?.scans, 1);
    assert.ok(
      !("fallbackToTable" in result),
      "a stored table row is not a measured fallback, so the field must be gone",
    );
    assert.ok(
      !("fallbackToTable" in result.days[0]),
      "the day block must not publish a fallback count either",
    );
  });
});

describe("usage write route", () => {
  it("rejects a caller with no matching key, and closes when no key is set", async () => {
    const mod = await loadWithStubs("convex/mcpLimit.ts");
    assert.equal(typeof mod.usageKeyMatches, "function", "the route needs one comparison function");
    assert.equal(mod.USAGE_KEY_HEADER, "x-launchsense-usage-key");
    assert.equal(mod.usageKeyMatches("correct-key", "correct-key"), true);
    assert.equal(mod.usageKeyMatches("wrong-key", "correct-key"), false);
    assert.equal(mod.usageKeyMatches("correct", "correct-key"), false);
    assert.equal(mod.usageKeyMatches(null, "correct-key"), false, "no header is not a key");
    assert.equal(mod.usageKeyMatches("correct-key", undefined), false, "an unset key means closed");
    assert.equal(mod.usageKeyMatches("correct-key", ""), false, "an empty key means closed");
  });

  it("checks the key before reading the body and caps writes per caller", () => {
    const keyAt = http.indexOf('path: "/api/mcp/usage"');
    const keyEnd = http.indexOf('path: "/api/mcp/report"');
    assert.ok(keyAt !== -1 && keyEnd > keyAt, "the usage route must exist to be checked");
    const route = http.slice(keyAt, keyEnd);
    const checkAt = route.indexOf("usageAuthorized(request)");
    const bodyAt = route.indexOf("request.json()");
    assert.ok(checkAt !== -1, "the usage route must call the credential check");
    assert.ok(bodyAt !== -1 && checkAt < bodyAt, "the key is checked before the body is read");
    assert.match(route, /401/, "a missing or wrong key must be rejected");
    assert.match(route, /internal\.mcpLimit\.consumeUsageWrite/, "a caller must be rate limited");

    // The check itself must read the header and a server-side env value, and
    // must not echo either one back.
    assert.match(
      http,
      /usageKeyMatches\(\s*request\.headers\.get\(USAGE_KEY_HEADER\),\s*process\.env\[[^\]]+\]\s*\)/,
      "the credential check must compare the header to a server env value",
    );
  });

  it("never records an unnamed source as a table answer", () => {
    const keyAt = http.indexOf('path: "/api/mcp/usage"');
    const keyEnd = http.indexOf('path: "/api/mcp/report"');
    const route = http.slice(keyAt, keyEnd);
    assert.ok(
      !/orderSource:[^\n]*"table"/.test(route),
      "an absent orderSource must not be stored as a table row",
    );
    assert.match(route, /orderSource:[^\n]*"unspecified"/);
  });
});

describe("stored provider calls", () => {
  const aiStub = () => `
export const callAiLane = async () => ({
  ok: true,
  source: "gemini",
  json: {},
  model: ${JSON.stringify(GEMINI_MODEL)},
  latencyMs: 3,
  error: null,
  usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
});
export const GEMINI_MODEL = ${JSON.stringify(GEMINI_MODEL)};
export const OLLAMA_DEFAULT_MODEL = "nemotron-3-nano:30b-cloud";
`;

  it("records the model the lane actually called, not a name written here", async () => {
    const mod = await loadWithStubs("convex/scans/aiExplain.ts", { "../adapters/ai": aiStub() });
    const saved = [];
    const ctx = {
      runQuery: async (ref) => (ref === "fetchScan" ? { analyzedAt: 1 } : []),
      runMutation: async (_ref, args) => {
        if (_ref === "consumeExplain") return { allowed: true, reason: "allowed" };
        saved.push(args);
        return null;
      },
    };
    await mod.explainScan.handler(ctx, { scanId: "scan1" });
    assert.equal(saved.length, 1, "one explain call is one stored row");
    assert.equal(saved[0].source, "gemini");
    assert.equal(
      saved[0].model,
      GEMINI_MODEL,
      "the stored model must be the one the lane called",
    );
    assert.equal(GEMINI_MODEL, "gemini-2.5-flash", "the lane calls gemini-2.5-flash");
  });

  it("holds no retired model name in the explain path", () => {
    assert.ok(
      !/gemini-2\.0-flash/.test(aiExplainRaw),
      "a retired model name must not be written into a stored row",
    );
  });
});