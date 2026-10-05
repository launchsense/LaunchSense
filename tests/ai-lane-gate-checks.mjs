import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Three guards on the explain lane (convex/scans/aiExplain.ts):
//   1. a scan id alone cannot ask for provider spend over and over
//   2. the not-checked box is driven by a structural boolean, never by provider text
//   3. a key-shaped fragment in finding text is refused before anything is posted
//
// Convex modules import `./_generated/*` and `convex/values`, which do not
// resolve outside the Convex runtime. loadWithStubs copies a module into a temp
// directory with those imports pointed at stubs, so the real handler runs here
// against a fake ctx instead of being read as text.

const repoRoot = new URL("../", import.meta.url);
const readRepo = (rel) => readFileSync(new URL(rel, repoRoot), "utf8");

const guestSource = readRepo("src/features/scan/GuestScan.tsx");
const reportSource = readRepo("src/features/report/ScanReport.tsx");
const scopeSource = readRepo("shared/reports/scope.ts");
const explainSource = readRepo("convex/scans/aiExplain.ts");

const tmpRoot = join("/tmp/opencode", "w3-gate-tests");
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
// The gate lives in mcpLimit and runs as an internal mutation, so the stub api
// needs that ref. One test leaves it out on purpose: that is the fail-closed path.
const API_STUB = `
export const internal = {
  scans: { store: { fetchScan: "fetchScan", listFindings: "listFindings", saveProviderCall: "saveProviderCall" } },
  mcpLimit: { consumeExplain: "consumeExplain" },
};
export const api = {};
export const components = {};
`;
const API_STUB_NO_LIMIT = `
export const internal = { scans: { store: { fetchScan: "fetchScan", listFindings: "listFindings", saveProviderCall: "saveProviderCall" } } };
export const api = {};
export const components = {};
`;

// The fake provider lane counts every call and hands the prompt to whatever the
// test installed, so "was the provider called" is measured, not asserted from text.
const AI_STUB = `
export const callAiLane = async (prompt) => {
  globalThis.__W3_CALLS__ = (globalThis.__W3_CALLS__ ?? 0) + 1;
  (globalThis.__W3_PROMPTS__ = globalThis.__W3_PROMPTS__ ?? []).push(prompt);
  return globalThis.__W3_PROVIDER__(prompt);
};
export const GEMINI_MODEL = "gemini-2.5-flash";
export const OLLAMA_DEFAULT_MODEL = "nemotron-3-nano:30b-cloud";
`;

/** Installs the provider answer and resets the call counter. */
function useProvider(answer) {
  globalThis.__W3_PROVIDER__ = typeof answer === "function" ? answer : () => answer;
  globalThis.__W3_CALLS__ = 0;
  globalThis.__W3_PROMPTS__ = [];
  return {
    get calls() {
      return globalThis.__W3_CALLS__;
    },
    get prompts() {
      return globalThis.__W3_PROMPTS__;
    },
  };
}

const slug = (specifier) => specifier.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");

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

async function loadWithStubs(relPath, extras = {}, apiStub = API_STUB) {
  mkdirSync(tmpRoot, { recursive: true });
  const dir = mkdtempSync(join(tmpRoot, "load-"));
  madeDirs.push(dir);
  mkdirSync(join(dir, "_generated"), { recursive: true });
  writeFileSync(join(dir, "_generated", "server.js"), SERVER_STUB);
  writeFileSync(join(dir, "_generated", "api.js"), apiStub);
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

// A fake rateLimits table, so the gate's own bump path is driven for real. Only
// the calls the gate makes are implemented, so the test cannot pass against a
// table the gate never reads.
function makeRateCtx() {
  const rows = new Map();
  const ctx = {
    db: {
      query(table) {
        if (table !== "rateLimits") throw new Error(`unexpected table ${table}`);
        return {
          withIndex(name, rangeFn) {
            if (name !== "by_key") throw new Error(`unexpected index ${name}`);
            let key = null;
            rangeFn({
              eq(field, value) {
                if (field !== "key") throw new Error(`unexpected index field ${field}`);
                key = value;
                return { field, value };
              },
            });
            return {
              async unique() {
                return rows.get(key) ?? null;
              },
            };
          },
        };
      },
      async patch(table, id, patch) {
        if (table !== "rateLimits") throw new Error(`unexpected patch on ${table}`);
        Object.assign(rows.get(id.key), patch);
      },
      async insert(table, doc) {
        if (table !== "rateLimits") throw new Error(`unexpected insert into ${table}`);
        rows.set(doc.key, { _id: { key: doc.key }, ...doc });
        return { key: doc.key };
      },
    },
  };
  return { ctx, rows };
}

// A fake action ctx: a scan that is already analyzed, a findings list, a gate
// answer, and a record of every query and mutation the lane made.
function makeCtx(options = {}) {
  const mutations = [];
  const queries = [];
  const ctx = {
    auth: options.auth,
    async runQuery(ref) {
      queries.push(ref);
      if (ref === "fetchScan") return options.scan ?? { analyzedAt: 1, status: "completed" };
      if (ref === "listFindings") return options.findings ?? [];
      throw new Error(`unexpected query ${ref}`);
    },
    async runMutation(ref, args) {
      mutations.push({ ref, args });
      if (ref === "saveProviderCall") return null;
      if (ref === "consumeExplain") {
        if (options.gateThrows === true) throw new Error("gate unavailable");
        return options.gate ?? { allowed: true, reason: "allowed" };
      }
      throw new Error(`unexpected mutation ${ref}`);
    },
  };
  return { ctx, mutations, queries };
}

async function loadExplain(apiStub = API_STUB) {
  return loadWithStubs("convex/scans/aiExplain.ts", { "../adapters/ai": AI_STUB }, apiStub);
}

const okAnswer = (model = "gemini-2.5-flash") => ({
  ok: true,
  source: "gemini",
  json: { explanations: [], notActionable: [] },
  model,
  latencyMs: 2,
  error: null,
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
});

// A plan that covers every fingerprint it is handed, so validation passes and the
// provider's wording is what the reader gets.
const coveringAnswer = (fingerprints) => ({
  ...okAnswer(),
  json: {
    explanations: fingerprints.map((fingerprint) => ({ fingerprint, plain: "Plain words." })),
    notActionable: [],
  },
});

// Drops every actionable finding, so validation refuses the plan.
const rejectedAnswer = () => ({
  ...okAnswer(),
  json: { explanations: [], notActionable: [] },
});

const noProviderAnswer = () => ({
  ok: false,
  source: "deterministic",
  json: null,
  model: null,
  latencyMs: 0,
  error: "No AI provider available.",
  usage: { inputTokens: null, outputTokens: null, totalTokens: null },
});

// A finding whose `why` carries a key-shaped fragment. Built from parts, so no
// key-shaped literal sits in this file. It is not a real key either way.
const FAKE_KEY = ["sk", "-", "Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9", "St0Uv"].join("");
// Exactly the shape the guard looks for: AKIA plus sixteen upper-case characters,
// so a word boundary lands at the end.
const FAKE_AWS = ["AK", "IA", "Z", "Y7X6W5V4U3T2S1R"].join("");

function findingWith(why, severity = "medium") {
  return {
    ruleId: "secret.credential-pattern",
    fingerprint: "secret.credential-pattern:v1:src/app.ts:abcdef01",
    severity,
    title: "Hardcoded credential",
    why,
  };
}

describe("explain spend gate", () => {
  it("allows the first press and the second, then stops at the per-scan cap", async () => {
    const mod = await loadWithStubs("convex/mcpLimit.ts");
    const { ctx } = makeRateCtx();
    assert.equal((await mod.consumeExplain.handler(ctx, { scanId: "scan1" })).allowed, true);
    assert.equal((await mod.consumeExplain.handler(ctx, { scanId: "scan1" })).allowed, true);
    const third = await mod.consumeExplain.handler(ctx, { scanId: "scan1" });
    assert.equal(third.allowed, false, "a scan id alone must not buy repeated provider calls");
    assert.equal(third.reason, "scan_limit");
    assert.equal(mod.EXPLAIN_SCAN_LIMIT, 2);
  });

  it("gives every scan its own budget, so one scan cannot starve another", async () => {
    const mod = await loadWithStubs("convex/mcpLimit.ts");
    const { ctx } = makeRateCtx();
    for (let i = 0; i < mod.EXPLAIN_SCAN_LIMIT; i += 1) {
      await mod.consumeExplain.handler(ctx, { scanId: "scan1" });
    }
    assert.equal((await mod.consumeExplain.handler(ctx, { scanId: "scan1" })).allowed, false);
    assert.equal(
      (await mod.consumeExplain.handler(ctx, { scanId: "scan2" })).allowed,
      true,
      "one scan's spending must not block another scan",
    );
  });

  it("caps a signed-in account on its own bucket, separate from other accounts", async () => {
    const mod = await loadWithStubs("convex/mcpLimit.ts");
    assert.ok(
      mod.EXPLAIN_CALLER_LIMIT > mod.EXPLAIN_SCAN_LIMIT,
      "the caller cap must sit above the per-scan cap, so it can only bind across scans",
    );
    const { ctx } = makeRateCtx();
    // One account, one fresh scan per press: the per-scan cap never trips, so
    // this walks the caller bucket on its own.
    for (let i = 0; i < mod.EXPLAIN_CALLER_LIMIT; i += 1) {
      const press = await mod.consumeExplain.handler(ctx, { scanId: `scan${i}`, caller: "user1" });
      assert.equal(press.allowed, true, `press ${i + 1} of the caller budget must be allowed`);
    }
    const over = await mod.consumeExplain.handler(ctx, { scanId: "scan-over", caller: "user1" });
    assert.equal(over.allowed, false, "one account must not spend without a cap of its own");
    assert.equal(over.reason, "caller_limit");
    assert.equal(
      (await mod.consumeExplain.handler(ctx, { scanId: "scanA", caller: "user2" })).allowed,
      true,
      "the cap is per caller, not global",
    );
  });

  it("counts in the same table, on the same hourly window, as the MCP limits", async () => {
    const mod = await loadWithStubs("convex/mcpLimit.ts");
    const { ctx, rows } = makeRateCtx();
    const realNow = Date.now;
    try {
      Date.now = () => Date.parse("2026-10-05T10:30:00.000Z");
      await mod.consumeExplain.handler(ctx, { scanId: "scan1" });
      await mod.consumeExplain.handler(ctx, { scanId: "scan1" });
      assert.equal(
        [...rows.keys()].every((key) => key.includes("2026-10-05T10")),
        true,
        "a counter row is keyed by the hour, like the mcp limits",
      );
      assert.equal([...rows.values()].every((row) => row.day === "2026-10-05"), true);
      assert.equal((await mod.consumeExplain.handler(ctx, { scanId: "scan1" })).allowed, false);

      Date.now = () => Date.parse("2026-10-05T11:05:00.000Z");
      assert.equal(
        (await mod.consumeExplain.handler(ctx, { scanId: "scan1" })).allowed,
        true,
        "the budget resets with the hour, so a later press still works",
      );
    } finally {
      Date.now = realNow;
    }
  });

  it("makes no provider call when the gate denies, and says so in plain words", async () => {
    const mod = await loadExplain();
    const provider = useProvider(okAnswer());
    const { ctx } = makeCtx({ gate: { allowed: false, reason: "scan_limit" } });
    const result = await mod.explainScan.handler(ctx, { scanId: "scan1" });

    assert.equal(provider.calls, 0, "a denied gate must not reach the provider");
    assert.equal(result.source, "deterministic");
    assert.equal(result.providerCalled, false);
    assert.match(result.note, /limit/i);
  });

  it("fails closed when the gate cannot be reached at all", async () => {
    // The generated api has no limit ref and the mutation throws: nothing may be
    // spent when the limit cannot be checked.
    const mod = await loadExplain(API_STUB_NO_LIMIT);
    const provider = useProvider(okAnswer());
    const { ctx } = makeCtx({ gateThrows: true });
    const result = await mod.explainScan.handler(ctx, { scanId: "scan1" });

    assert.equal(provider.calls, 0, "an unreachable gate must not become a spend");
    assert.equal(result.source, "deterministic");
    assert.equal(result.providerCalled, false);
    assert.match(result.note, /limit/i);
  });

  it("still answers the plain wording on the first press, so the guest flow works", async () => {
    const mod = await loadExplain();
    useProvider(noProviderAnswer());
    const { ctx } = makeCtx({ findings: [findingWith("A credential is hardcoded in the file.")] });
    const result = await mod.explainScan.handler(ctx, { scanId: "scan1" });
    assert.equal(result.source, "deterministic");
    assert.equal(result.explanations.length, 1, "the plain wording still covers the finding");
    assert.equal(result.note, "No AI provider answered. Plain wording is shown instead.");
  });
});

describe("the not-checked box does not read provider text", () => {
  it("reports providerCalled structurally: true when a provider wrote the wording", async () => {
    const mod = await loadExplain();
    const finding = findingWith("A credential is hardcoded in the file.");
    useProvider(coveringAnswer([finding.fingerprint]));
    const { ctx } = makeCtx({ findings: [finding] });
    const result = await mod.explainScan.handler(ctx, { scanId: "scan1" });
    assert.equal(result.providerCalled, true);
  });

  it("a provider string cannot move the disclosure, even when it names the failure", async () => {
    // The provider chooses the model name, and the model name lands in the note a
    // reader sees. A boolean derived from that text could be flipped by whoever
    // answers, so it must not be derived from it.
    const mod = await loadExplain();
    useProvider(okAnswer("No AI provider (this model answered)"));
    const { ctx } = makeCtx();
    const result = await mod.explainScan.handler(ctx, { scanId: "scan1" });
    assert.match(result.note, /No AI provider/, "the provider text is still shown to the reader");
    assert.equal(
      result.providerCalled,
      true,
      "the structural boolean must not follow the provider's own words",
    );
  });

  it("reports providerCalled false when no provider answered", async () => {
    const mod = await loadExplain();
    useProvider(noProviderAnswer());
    const { ctx } = makeCtx();
    const result = await mod.explainScan.handler(ctx, { scanId: "scan1" });
    assert.equal(result.providerCalled, false);
  });

  it("reports providerCalled false when the provider answer was rejected, because the reader then sees our wording", async () => {
    const mod = await loadExplain();
    useProvider(rejectedAnswer());
    const { ctx } = makeCtx({
      findings: [findingWith("A credential is hardcoded in the file.")],
    });
    const result = await mod.explainScan.handler(ctx, { scanId: "scan1" });
    assert.equal(result.rejected, true, "the answer was refused");
    assert.equal(result.providerCalled, false, "the wording on screen is ours, not the provider's");
    assert.equal(result.note.startsWith("AI output was rejected"), true);
  });

  it("returns the boolean as part of the validated action result", () => {
    assert.match(explainSource, /providerCalled:\s*v\.boolean\(\)/);
  });

  it("the guest report no longer decides the disclosure with a regex over the note", () => {
    assert.doesNotMatch(
      guestSource,
      /No AI provider\/i/,
      "a provider string must not decide whether a disclosure is printed",
    );
    assert.match(guestSource, /providerAnswered/);
    assert.match(guestSource, /setProviderAnswered\(result\.providerCalled\)/);
    assert.match(guestSource, /aiConfigured=\{providerAnswered\}/);
  });

  it("keeps the exact wording of the not-checked line", () => {
    assert.ok(
      scopeSource.includes('"Plain word explanations. No AI provider answered this scan."'),
      "the disclosure wording must not drift",
    );
    assert.match(
      reportSource,
      /aiConfigured:\s*boolean/,
      "the report still takes the boolean, not text",
    );
  });
});

describe("the writing lane refuses key-shaped finding text", () => {
  it("posts nothing when a finding carries a key-shaped fragment", async () => {
    const mod = await loadExplain();
    const provider = useProvider(okAnswer());
    const { ctx } = makeCtx({
      findings: [findingWith(`The value looks like ${FAKE_KEY} and belongs in the environment.`)],
    });
    const result = await mod.explainScan.handler(ctx, { scanId: "scan1" });

    assert.equal(provider.calls, 0, "a key-shaped fragment must never be posted to a provider");
    assert.equal(result.source, "deterministic");
    assert.equal(result.providerCalled, false);
    assert.ok(!result.note.includes(FAKE_KEY), "the refusal must never echo the fragment");
    assert.ok(!result.note.includes(FAKE_KEY.slice(0, 14)), "not even the first part of it");
    assert.match(result.note, /key|credential|secret/i);
    assert.equal(
      result.explanations.length,
      1,
      "the plain wording still covers the finding, so the reader is not left blank",
    );
  });

  it("refuses an AWS key shape the same way", async () => {
    const mod = await loadExplain();
    const provider = useProvider(okAnswer());
    const { ctx } = makeCtx({ findings: [findingWith(`A key ${FAKE_AWS} is committed.`, "high")] });
    const result = await mod.explainScan.handler(ctx, { scanId: "scan1" });
    assert.equal(provider.calls, 0);
    assert.ok(!result.note.includes(FAKE_AWS));
  });

  it("still posts ordinary finding text, so the lane is not simply switched off", async () => {
    const mod = await loadExplain();
    const finding = findingWith("A credential is hardcoded in the file. Move it to the environment.");
    const provider = useProvider(coveringAnswer([finding.fingerprint]));
    const { ctx } = makeCtx({ findings: [finding] });
    const result = await mod.explainScan.handler(ctx, { scanId: "scan1" });
    assert.equal(provider.calls, 1, "clean text must still reach the provider");
    assert.equal(result.providerCalled, true);
    assert.equal(result.source, "gemini");
  });

  it("uses the same guard the reorder lane runs, not a second list of shapes", () => {
    assert.match(
      explainSource,
      /from\s+"\.\.\/adapters\/decision"/,
      "the writing lane must reuse the reorder lane's secret guard",
    );
    assert.match(explainSource, /looksLikeSecret\(/);
  });

  it("leaves the deterministic fallback wording alone", () => {
    const deterministic = readRepo("shared/ai/deterministic.ts");
    assert.match(deterministic, /\$\{f\.title\}\. \$\{f\.why\}/);
    assert.match(deterministic, /Informational only\. No action needed before you share\./);
  });
});

// The lane reads the scan row, so it owes the reader the same ownership rule the
// report queries run. A scan id alone is not proof of a right to read a signed-in
// scan, and this lane posts the finding text off that row to a provider.
describe("the explain lane checks ownership", () => {
  const ownedScan = { analyzedAt: 1, status: "completed", signedIn: true, userId: "user-a" };
  const asUser = (subject) => ({ getUserIdentity: async () => ({ subject }) });

  it("refuses a signed-in scan the caller does not own, and posts nothing", async () => {
    const mod = await loadExplain();
    const finding = findingWith("A credential is hardcoded in the file.");
    const provider = useProvider(coveringAnswer([finding.fingerprint]));
    const { ctx } = makeCtx({
      scan: ownedScan,
      findings: [finding],
      auth: asUser("user-b"),
    });
    const result = await mod.explainScan.handler(ctx, { scanId: "scan-of-user-a" });

    assert.equal(provider.calls, 0, "another account's finding text must never be posted");
    assert.equal(provider.prompts.length, 0);
    assert.equal(result.source, "deterministic", "the refusal shows our wording");
    assert.equal(result.providerCalled, false, "so the not-checked disclosure stays in place");
    assert.match(result.note, /not available|sign in|your account/i);
    assert.equal(
      result.explanations.length,
      0,
      "a refused scan carries no explanations, so nothing of the scan reaches the screen",
    );
    assert.ok(
      !result.note.includes("A credential is hardcoded"),
      "the refusal must not quote the finding text it refused",
    );
  });

  it("explains the caller's own signed-in scan, so the check is a rule and not a switch", async () => {
    const mod = await loadExplain();
    const finding = findingWith("A credential is hardcoded in the file.");
    const provider = useProvider(coveringAnswer([finding.fingerprint]));
    const { ctx } = makeCtx({ scan: ownedScan, findings: [finding], auth: asUser("user-a") });
    const result = await mod.explainScan.handler(ctx, { scanId: "scan-of-user-a" });

    assert.equal(provider.calls, 1, "the owner still gets the wording the lane exists for");
    assert.equal(result.providerCalled, true);
    assert.equal(result.source, "gemini");
  });

  it("keeps a guest scan of a public repo readable by its id, with no identity at all", async () => {
    const mod = await loadExplain();
    const finding = findingWith("A credential is hardcoded in the file.");
    const provider = useProvider(coveringAnswer([finding.fingerprint]));
    // A guest scan carries no owner, so it is the shareable case by design.
    const { ctx } = makeCtx({ scan: { analyzedAt: 1, status: "completed" }, findings: [finding] });
    const result = await mod.explainScan.handler(ctx, { scanId: "guest-scan" });

    assert.equal(provider.calls, 1, "a guest scan of a public repo stays id-addressed");
    assert.equal(result.providerCalled, true);
  });

  it("refuses a signed-in scan with no identity at all, rather than treating it as a guest", async () => {
    const mod = await loadExplain();
    const provider = useProvider(okAnswer());
    const { ctx } = makeCtx({ scan: ownedScan, findings: [findingWith("A credential is hardcoded in the file.")] });
    const result = await mod.explainScan.handler(ctx, { scanId: "scan-of-user-a" });
    assert.equal(provider.calls, 0, "no identity is not a pass");
    assert.equal(result.providerCalled, false);
  });

  it("reads the one shared ownership helper, the same one the report queries read", () => {
    assert.match(
      explainSource,
      /from\s+"\.\.\/\.\.\/shared\/reports\/scanAccess"/,
      "the lane must import the rule the report queries already enforce",
    );
    assert.match(explainSource, /canReadScan\(/);
    const queries = readRepo("convex/scans/queries.ts");
    assert.match(queries, /canReadScan\(/, "the rule exists on the read path already");
    // Both paths must derive the viewer the same way, or the ownership rule
    // compares two different values and refuses its own owner's scan. Convex
    // Auth reads the user id as the part of the subject before the "|".
    assert.match(
      explainSource,
      /getUserIdentity\(\)[\s\S]{0,400}subject\.split\("\|"\)\[0\]/,
      "the lane must read the user id out of the identity subject, the way getAuthUserId does",
    );
  });
});

// The caps have to bind a caller who holds many scan ids, and they have to bind
// the lane in total. Measured with the real handler against a real rateLimits
// table, not read out of the source.
describe("the explain lane has a ceiling a scan id cannot buy past", () => {
  it("stops a caller with no identity at one shared bucket, so many scan ids stop helping", async () => {
    const mod = await loadWithStubs("convex/mcpLimit.ts");
    assert.ok(
      Number.isInteger(mod.EXPLAIN_GUEST_CALLER_LIMIT) && mod.EXPLAIN_GUEST_CALLER_LIMIT > 0,
      "the lane must name a cap for a caller with no identity",
    );
    const { ctx } = makeRateCtx();
    const attempts = 40;
    let allowed = 0;
    for (let i = 0; i < attempts; i += 1) {
      for (let press = 0; press < mod.EXPLAIN_SCAN_LIMIT; press += 1) {
        const result = await mod.consumeExplain.handler(ctx, { scanId: `scan-${i}` });
        if (result.allowed) allowed += 1;
      }
    }
    assert.equal(
      allowed,
      mod.EXPLAIN_GUEST_CALLER_LIMIT,
      `${attempts} fresh scan ids must stop at the named cap, not at ${attempts * mod.EXPLAIN_SCAN_LIMIT}`,
    );
    assert.equal(
      mod.explainCallerKey(null),
      "guest",
      "the shared bucket must not be derived from the scan, or a new scan id is a new budget",
    );
  });

  it("still gives every scan its own small budget inside the shared guest bucket", async () => {
    const mod = await loadWithStubs("convex/mcpLimit.ts");
    const { ctx } = makeRateCtx();
    for (let i = 0; i < mod.EXPLAIN_SCAN_LIMIT; i += 1) {
      const press = await mod.consumeExplain.handler(ctx, { scanId: "scan-a" });
      assert.equal(press.allowed, true, `the first press of a guest's scan must work (press ${i + 1})`);
    }
    assert.equal(
      (await mod.consumeExplain.handler(ctx, { scanId: "scan-a" })).allowed,
      false,
      "one scan id must not buy repeated calls",
    );
    assert.equal(
      (await mod.consumeExplain.handler(ctx, { scanId: "scan-b" })).allowed,
      true,
      "a second scan is a second press for the same visitor, which the shared bucket still allows",
    );
  });

  it("caps the lane in total, above the scan and caller caps", async () => {
    const mod = await loadWithStubs("convex/mcpLimit.ts");
    assert.ok(
      Number.isInteger(mod.EXPLAIN_GLOBAL_LIMIT) && mod.EXPLAIN_GLOBAL_LIMIT > mod.EXPLAIN_CALLER_LIMIT,
      "the lane must name a total cap, and it must sit above the per-caller one",
    );
    const { ctx, rows } = makeRateCtx();
    let allowed = 0;
    // One fresh scan and one fresh account per press, so neither of the caps
    // below can be what stops this: only the total can.
    for (let i = 0; i < mod.EXPLAIN_GLOBAL_LIMIT + 20; i += 1) {
      const press = await mod.consumeExplain.handler(ctx, { scanId: `scan-${i}`, caller: `user-${i}` });
      if (press.allowed) allowed += 1;
    }
    assert.equal(allowed, mod.EXPLAIN_GLOBAL_LIMIT, "the lane must stop at its named total");
    assert.ok(
      [...rows.keys()].some((key) => key.includes("explain-scan-global")),
      "the total has to be a bucket in the same table, so it is read and enforced for real",
    );
  });

  it("claims the limit before it reads the scan or the findings, so a denied press does no work", async () => {
    const mod = await loadExplain();
    const provider = useProvider(okAnswer());
    const { ctx, queries } = makeCtx({ gate: { allowed: false, reason: "scan_limit" } });
    const result = await mod.explainScan.handler(ctx, { scanId: "scan1" });

    assert.equal(provider.calls, 0);
    assert.equal(result.providerCalled, false);
    assert.match(result.note, /limit/i);
    assert.deepEqual(
      queries,
      [],
      "a denied press must not read the scan row or the findings, so it costs a caller with many ids nothing",
    );
  });
});