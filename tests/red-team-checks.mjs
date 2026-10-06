// W3-RED. Red team for the wave 2 and wave 3 changes in this worktree.
//
// This file ATTACKS. It never fixes anything. Every test asserts the CURRENT
// behaviour of the shipped code, and every title carries the verdict:
//
//   [OPEN]     a hole is reachable today. The assertion pins the hole, so a
//              future fix flips it and the failure says so.
//   [DEFENDED] the attack did not land. The assertion pins why it cannot.
//
// A test that cannot fail is worthless here, so each one names the input that
// was tried and the number that came back. Anything unknown is written as
// unknown, not as a pass.
//
// The six targets come from the W3-RED section of state/subagent-brief.md:
//   1. the mcpLimit constant-style slug rule (W3-FIX)
//   2. provider-shape ordering against that rule
//   3. the explain spend gate (W3-GATE)
//   4. the structural not-checked disclosure (W3-GATE)
//   5. the fingerprint occurrence number (WS-4)
//   6. the local server review root (W3-INSTALL-ROOT)
//
// No secret or environment value is printed here. Every key-shaped fixture is
// built by joining parts, so no provider-shaped literal sits in this file, and
// none of them is a real key.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { looksLikeSecretValue, PROVIDER_SHAPES } from "../shared/analyzers/secretValue.ts";
import { isHardcodedCredential, nameLooksLikeCredential, scanSecrets } from "../shared/analyzers/secrets.ts";
import { fingerprintFinding, occurrenceFor } from "../shared/redaction.ts";
import { questionIdFor } from "../shared/reports/priority.ts";
import { canReadScan } from "../shared/reports/scanAccess.ts";
import { buildNotCheckedList } from "../shared/reports/scope.ts";
import { ANALYZER_VERSION } from "../shared/analyzers/version.ts";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const readRepo = (rel) => readFileSync(join(REPO, rel), "utf8");

const VERDICTS = [];
/** Records a verdict so the file prints one honest table at the end. */
function verdict(target, state, line) {
  VERDICTS.push({ target, state, line });
}

// Values that are the shape under test. Assembled from parts on purpose.
const SLUG = ["correct", "-", "horse", "-", "battery", "-", "staple"].join("");
const SLUG_DIGIT = ["correct", "-", "horse", "-", "battery", "-", "s", "1"].join("");
const SLUG_UPPER = ["Correct", "-", "horse", "-", "battery"].join("");
const HEADER_LABEL = ["x", "-", "launchsense", "-", "usage", "-", "key"].join("");
const OPENROUTER = ["sk", "-", "or", "-", "v1-", "ab", "cd", "ef", "gh", "ij", "kl", "mn", "op", "qr", "uv"].join("");
const SLACK = ["xox", "b-", "abcd", "efgh", "ijkl", "mnop", "qrst"].join("");
const OPENAI = ["sk-", "abcdefghij", "klmnopqrst", "uvwxyzabcd"].join("");
const GITLAB = ["glpat-", "abcdefghij", "klmnopqrst", "uvwxyz"].join("");
const AWS = ["AK", "IA", "Z", "Y7X6W5V4U3T2S1R"].join("");
const GITHUB_CLASSIC = ["ghp_", "abcdefghij", "klmnopqrst", "uvwxyz0123"].join("");
const GITHUB_FINE = ["github_pat_", "abcdefghij", "klmnopqrst", "uvwxyz0123"].join("");
const STRIPE = ["sk_live_", "abcdefghij", "1234"].join("");
const ANTHROPIC = ["sk-ant-", "abcdefghij", "1234"].join("");
const GOOGLE = ["AIza", "abcdefghij", "klmnopqrst", "uvwxyz0123", "4567"].join("");
const GOOGLE_OAUTH = ["ya29", ".", "abcdefghij", "klmnopqrst"].join("");
const SENDGRID = ["SG", ".", "abcdefghij", ".", "klmnopqrst"].join("");
const TWILIO = ["SK", "0123456789abcdef0123456789abcdef"].join("");
const DIGITALOCEAN = ["dop_v1_", "a".repeat(64)].join("");
const NPM_TOKEN = ["npm_", "abcdefghij", "klmnopqrst", "uvwxyz012345"].join("");
const WEBHOOK = ["whsec_", "abcdefghij", "klmnopqrst", "uvwxyz"].join("");
const PEM_HEAD = ["-----BEGIN ", "RSA ", "PRIVATE KEY-----"].join("");
const JWT = [
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkNJIn0",
  "dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
].join(".");

/** One minimal sample per entry in PROVIDER_SHAPES, so no shape is untested. */
const PROVIDER_SAMPLES = [
  ["aws", AWS],
  ["github-classic", GITHUB_CLASSIC],
  ["github-fine", GITHUB_FINE],
  ["slack", SLACK],
  ["stripe", STRIPE],
  ["anthropic", ANTHROPIC],
  ["openrouter", OPENROUTER],
  ["openai", OPENAI],
  ["google-api-key", GOOGLE],
  ["google-oauth", GOOGLE_OAUTH],
  ["sendgrid", SENDGRID],
  ["twilio", TWILIO],
  ["gitlab", GITLAB],
  ["digitalocean", DIGITALOCEAN],
  ["npm", NPM_TOKEN],
  ["stripe-webhook", WEBHOOK],
  ["pem", PEM_HEAD],
];

// ---------------------------------------------------------------------------
// 1. The constant-style slug rule (W3-FIX)
//
// The rule exempts a pure lowercase hyphenated value when the NAME looks like a
// constant. It exists to silence the HTTP header LABEL at convex/mcpLimit.ts:13.
// The brief already names the cost: MY_KEY = "correct-horse-battery-staple" is
// a real passphrase and the rule silences it. These tests measure how wide that
// cost is.
// ---------------------------------------------------------------------------

describe("target 1: the constant-style slug rule (W3-FIX)", () => {
  it("[DEFENDED] a real passphrase under a constant-style name is reported", () => {
    // Fixed 2026-10-06. The exemption used to fire on any all-caps name, which
    // silenced this. It now matches only a name whose last word is header,
    // name, or label, so a constant holding a real passphrase is judged on its
    // own shape again.
    const line = `const MY_KEY = "${SLUG}";`;
    assert.equal(
      looksLikeSecretValue(SLUG, true, "MY_KEY"),
      true,
      "an all-caps name no longer exempts a hyphenated passphrase",
    );
    assert.equal(
      isHardcodedCredential(line, "src/a.ts"),
      true,
      "so the line raises secret.credential-pattern",
    );
    assert.notDeepEqual(
      scanSecrets([{ path: "src/a.ts", content: `${line}\n` }]),
      [],
      "the whole analyzer is no longer silent on the line",
    );
  });

  it("[DEFENDED] the exemption still covers the header label it was written for", () => {
    // The original false positive is still fixed: a name ending in header is
    // exempt, so the HTTP header label is not mistaken for a credential.
    assert.equal(looksLikeSecretValue(HEADER_LABEL, true, "USAGE_KEY_HEADER"), false);
    const line = `export const USAGE_KEY_HEADER = "${HEADER_LABEL}";`;
    assert.equal(isHardcodedCredential(line, "convex/mcpLimit.ts"), false);
  });

  it("[DEFENDED] only a last segment named header, name, or label is exempt", () => {
    const exempted = [
      "USAGE_KEY_HEADER",
      "service_name",
      "service-name",
      "x-header",
      "label",
      "usage_key_header",
    ];
    const notExempted = [
      "MY_KEY",
      "SECRET",
      "A",
      "PASSWORD2",
      "password",
      "myKey",
      "Password",
      "key2",
      "hostname",
      "usageKeyHeader",
    ];
    for (const name of exempted) {
      assert.equal(
        looksLikeSecretValue(SLUG, true, name),
        false,
        `${name} ends in header, name, or label, so it is still exempt`,
      );
    }
    for (const name of notExempted) {
      assert.equal(
        looksLikeSecretValue(SLUG, true, name),
        true,
        `${name} is outside the exempted class, so the passphrase fires`,
      );
    }
    verdict("1 slug rule", "DEFENDED", "a passphrase under a constant-style name is reported; only a name ending in header, name, or label is exempt");
  });

  it("[DEFENDED] the exemption no longer turns on the all-caps shape", () => {
    assert.equal(looksLikeSecretValue(SLUG, true, "MY_KEY"), true, "all-caps no longer exempts");
    assert.equal(looksLikeSecretValue(SLUG_DIGIT, true, "MY_KEY"), true);
    assert.equal(looksLikeSecretValue(SLUG_UPPER, true, "MY_KEY"), true);
  });

  it("[DEFENDED] the cost measured on this tree: every line the rule silences is a header label, never a secret", () => {
    // Walks the checkout's own text files, and for every assignment whose NAME
    // reads as a credential it asks the value gate twice: once with no name,
    // which is the pre-fix call, and once with the name, which is the shipped
    // call. A difference is a real detection the rule removed. The name
    // extraction is a regex approximation of the analyzer's own loop, so this is
    // an upper bound on what the rule can hide, not a claim about any other
    // rule's behaviour. This file is skipped: it holds the fixtures on purpose.
    const SKIP = new Set(["node_modules", ".git", ".progress", "state", "dist", "coverage"]);
    const TEXT = /\.(?:ts|tsx|js|jsx|mjs|cjs|json|py|go|java|rb|ya?ml|env|properties|ini|toml|sh|tf|html|css|sql|php|cs|kt|rs|md)$/i;
    const files = [];
    const walk = (dir, depth) => {
      if (files.length > 2000 || depth > 5) return;
      for (const entry of readdirSync(join(REPO, dir), { withFileTypes: true })) {
        if (SKIP.has(entry.name)) continue;
        if (join(dir, entry.name) === "tests/red-team-checks.mjs") continue;
        if (entry.isDirectory()) walk(join(dir, entry.name), depth + 1);
        else if (TEXT.test(entry.name)) files.push(join(dir, entry.name));
      }
    };
    walk(".", 0);

    const silenced = [];
    let pairs = 0;
    let firedBefore = 0;
    for (const rel of files) {
      const content = readRepo(rel);
      for (const line of content.split("\n")) {
        if (line.length === 0 || line.length > 400) continue;
        for (const m of line.matchAll(/([A-Za-z0-9_]+)\s*[:=]\s*["']([^"']{8,})["']/g)) {
          const [, name, value] = m;
          if (!nameLooksLikeCredential(name)) continue;
          pairs += 1;
          if (!looksLikeSecretValue(value, true, "")) continue;
          firedBefore += 1;
          if (!looksLikeSecretValue(value, true, name)) silenced.push({ rel, name, value });
        }
      }
    }
    assert.ok(pairs > 20, `the walk must find real assignments to measure; found ${pairs}`);
    assert.ok(firedBefore > 0, "the walk must find values the value gate accepts, or it measures nothing");
    assert.ok(
      silenced.length > 0,
      "the walk must find at least the header label, or the rule is not being exercised on this tree",
    );
    // Every silenced line must be the case the rule was written for: a label
    // under a name that ends in header, name, or label. A passphrase under
    // MY_KEY here would fail this and is a finding against this repository.
    const notALabel = silenced.filter(
      (row) => !/^(?:header|name|label)$/i.test(row.name.split(/[_-]/).pop() ?? ""),
    );
    assert.deepEqual(
      notALabel,
      [],
      "a line on this tree is lost to the slug rule without being a label",
    );
    console.log(
      `  measured on ${files.length} text files: ${pairs} credential-named assignments, ${firedBefore} accepted by the value gate, ${silenced.length} silenced by the slug rule, all of them header labels (${[...new Set(silenced.map((r) => r.name))].join(", ")})`,
    );
    verdict("1 slug rule", "DEFENDED", `${silenced.length} of ${firedBefore} value-gate hits on this tree are silenced, and every one is the header label the rule exists for; 0 real secrets lost`);
  });

  it("[DEFENDED] the same passphrase under a lowercase credential name still fires, so the fix did not switch the check off", () => {
    assert.equal(looksLikeSecretValue(SLUG, true, "password"), true);
    assert.equal(looksLikeSecretValue(SLUG, true, "clientSecret"), true);
    assert.equal(
      isHardcodedCredential(`password = "${SLUG}"`, "config/app.properties"),
      true,
      "the shipped passphrase case the fix was written to protect is still found",
    );
    assert.equal(
      isHardcodedCredential(`const MY_KEY = "${OPENROUTER}";`, "src/a.ts"),
      true,
      "a provider key under a constant-style name still fires, because provider shapes run first",
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Provider-shape ordering
//
// W3-FIX was warned that sk-or-v1-... is itself slug shaped, so a rule placed
// before the provider check would swallow a real key. This is that warning,
// turned into a test over every shape the product ships.
// ---------------------------------------------------------------------------

describe("target 2: provider shapes are checked before the slug exemption", () => {
  it("[DEFENDED] no shape in PROVIDER_SHAPES is swallowed by the slug exemption, including the three that are slug shaped", () => {
    const slug = /^[a-z]+(?:-[a-z]+)+$/;
    const slugShaped = PROVIDER_SAMPLES.filter(([, value]) => slug.test(value)).map(([label]) => label);
    // Slack, OpenAI-style and GitLab tokens are all pure lowercase with dashes.
    // They are the inputs the ordering exists to protect.
    assert.deepEqual(
      slugShaped.sort(),
      ["gitlab", "openai", "slack"].sort(),
      "the slug-shaped shapes are exactly the ones that would be lost if the order flipped",
    );
    for (const [label, value] of PROVIDER_SAMPLES) {
      assert.ok(
        PROVIDER_SHAPES.some((shape) => shape.test(value)),
        `the ${label} fixture must match a listed shape or the test proves nothing`,
      );
      assert.equal(
        looksLikeSecretValue(value, true, "MY_KEY"),
        true,
        `${label} must fire even under a constant-style name, so the provider check runs first`,
      );
    }
    verdict("2 provider order", "DEFENDED", "all 17 shapes fire under a constant-style name; 3 of them are slug shaped and would be lost if the order flipped");
  });

  it("[DEFENDED] the structural rejections that run BEFORE the value gate cannot swallow a provider key, because the line is swept first", () => {
    // valueAtIsCredential rejects a container literal and an optional chain
    // before looksLikeSecretValue is reached. containsProviderKey runs on the
    // whole line above both, so these three shapes still fire.
    const container = `const API_KEYS = ["${STRIPE}"];`;
    const optionalChain = `const k = tokens?.${STRIPE};`;
    const bareArg = `login(user, ${GITHUB_CLASSIC});`;
    assert.equal(isHardcodedCredential(container, "src/a.ts"), true, "a provider key in an array still fires");
    assert.equal(isHardcodedCredential(optionalChain, "src/a.ts"), true, "a provider key read through ?. still fires");
    assert.equal(isHardcodedCredential(bareArg, "src/a.ts"), true, "a provider key as a positional argument still fires");
  });

  it("[DEFENDED] a JWT still fires under a constant-style name, and a real key in a template literal is swept", () => {
    assert.equal(looksLikeSecretValue(JWT, true, "MY_KEY"), true, "a three segment JWT is caught before any structural rule");
    assert.equal(
      isHardcodedCredential(`const k = \`sk-ant-api03-${"abcd"}\`;`, "src/a.ts"),
      true,
      "a partial provider shape inside a template literal is swept by the line check",
    );
  });

  it("[OPEN, narrow] the ordering is only as safe as the list: 8 unlisted real formats were tried and every one still fires on entropy", () => {
    // The gap is a maintenance property, not a measured miss. I tried to name a
    // real, currently used key format that is both absent from the 17 shapes
    // and pure lowercase with dashes. I could not: these eight are all absent
    // from the list and all still fire, because the entropy floor catches them
    // before the slug exemption is ever reached. The one proven loss is target
    // 1, which is a passphrase rather than a provider format.
    const body = ["Ab3Cd", "Ef5Gh", "Ij7Kl", "Mn9Op", "Qr1St"].join("");
    const unlisted = [
      ["huggingface", `hf_${body}`],
      ["replicate", `r8_${body}`],
      ["shopify", `shpat_${body}`],
      ["gitlab-refresh", `glptt-${body}`],
      ["gitlab-runner", `glrt-${body}`],
      ["cohere", `co-${body}`],
      ["figma", `figd_${body}`],
      ["docker", `dckr_pat_${body}`],
    ];
    for (const [label, value] of unlisted) {
      assert.equal(
        PROVIDER_SHAPES.some((shape) => shape.test(value)),
        false,
        `${label} must be outside the list or this test proves nothing`,
      );
      assert.equal(
        looksLikeSecretValue(value, true, "MY_KEY"),
        true,
        `${label} still fires on entropy, so the ordering is not what saves it`,
      );
    }
    // And the slug-shaped value now fires, because the all-caps exemption is gone.
    assert.equal(looksLikeSecretValue(SLUG, true, "MY_KEY"), true);
    verdict("2 provider order", "DEFENDED", "no current key format is lost; 8 unlisted real formats all fire, and the slug-shaped passphrase that used to be lost now fires too");
  });
});

// ---------------------------------------------------------------------------
// 3. The explain spend gate (W3-GATE)
// ---------------------------------------------------------------------------

// Convex modules import ./_generated/* and convex/values, which do not resolve
// outside the Convex runtime. loadWithStubs copies one module into a temp folder
// with those imports pointed at stubs, so the real handler runs here against a
// fake ctx instead of being read as text.
const SERVER_STUB = `
export const internalQuery = (spec) => spec;
export const internalMutation = (spec) => spec;
export const query = (spec) => spec;
export const mutation = (spec) => spec;
export const action = (spec) => spec;
export const internalAction = (spec) => spec;
`;
const VALUES_STUB = `export const v = new Proxy({}, { get: () => () => ({}) });`;
const API_STUB = `
export const internal = {
  scans: { store: { fetchScan: "fetchScan", listFindings: "listFindings", saveProviderCall: "saveProviderCall" } },
  mcpLimit: { consumeExplain: "consumeExplain" },
};
export const api = {};
export const components = {};
`;
// The provider lane counts every call, so "was the provider called" is measured.
const AI_STUB = `
export const callAiLane = async (prompt) => {
  globalThis.__RED_CALLS__ = (globalThis.__RED_CALLS__ ?? 0) + 1;
  (globalThis.__RED_PROMPTS__ = globalThis.__RED_PROMPTS__ ?? []).push(prompt);
  return globalThis.__RED_PROVIDER__(prompt);
};
`;

const stubDir = mkdtempSync("/tmp/opencode/red-team-load-");
const slugify = (s) => s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");

function mapSpecifier(specifier, relPath, extras) {
  if (specifier.endsWith("_generated/server")) return "./_generated/server.js";
  if (specifier.endsWith("_generated/api")) return "./_generated/api.js";
  if (specifier.endsWith("_generated/dataModel")) return "./_generated/api.js";
  if (specifier === "convex/values") return "./values.js";
  if (Object.prototype.hasOwnProperty.call(extras, specifier)) return `./${slugify(specifier)}.js`;
  if (specifier.startsWith(".")) {
    const dir = new URL(".", new URL(relPath, pathToFileURL(`${REPO}/`)));
    const url = new URL(specifier, dir);
    if (url.pathname.endsWith("/")) url.pathname += "index.ts";
    else if (!url.pathname.endsWith(".ts") && !url.pathname.endsWith(".js")) url.pathname += ".ts";
    return url.href;
  }
  return specifier;
}

let moduleCount = 0;
async function loadWithStubs(relPath, extras = {}, apiStub = API_STUB) {
  const dir = join(stubDir, `m${moduleCount++}`);
  mkdirSync(join(dir, "_generated"), { recursive: true });
  writeFileSync(join(dir, "_generated", "server.js"), SERVER_STUB);
  writeFileSync(join(dir, "_generated", "api.js"), apiStub);
  writeFileSync(join(dir, "values.js"), VALUES_STUB);
  for (const [specifier, code] of Object.entries(extras)) {
    writeFileSync(join(dir, `${slugify(specifier)}.js`), code);
  }
  const patched = readRepo(relPath)
    .replace(/^[ \t]*import\s+type[^\n]*$/gm, "")
    .replace(/from\s+"([^"]+)"/g, (_m, specifier) => `from "${mapSpecifier(specifier, relPath, extras)}"`);
  writeFileSync(join(dir, "module.ts"), patched);
  return import(pathToFileURL(join(dir, "module.ts")).href);
}

after(() => rmSync(stubDir, { recursive: true, force: true }));

/** A real rateLimits table, so the gate's own bump path is driven for real. */
function makeRateCtx() {
  const rows = new Map();
  return {
    rows,
    ctx: {
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
              return { async unique() { return rows.get(key) ?? null; } };
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
    },
  };
}

/** A fake action ctx that counts the queries and mutations the lane makes. */
function makeCtx(options = {}) {
  const calls = { queries: [], mutations: [] };
  return {
    calls,
    ctx: {
      auth: options.auth,
      async runQuery(ref, args) {
        calls.queries.push({ ref, args });
        if (ref === "fetchScan") return options.scan ?? { analyzedAt: 1, status: "completed" };
        if (ref === "listFindings") return options.findings ?? [];
        throw new Error(`unexpected query ${ref}`);
      },
      async runMutation(ref, args) {
        calls.mutations.push({ ref, args });
        if (ref === "saveProviderCall") return null;
        if (ref === "consumeExplain") {
          if (options.gateThrows === true) throw new Error("gate unavailable");
          return options.gate ?? { allowed: true, reason: "allowed" };
        }
        throw new Error(`unexpected mutation ${ref}`);
      },
    },
  };
}

function useProvider(answer) {
  globalThis.__RED_PROVIDER__ = typeof answer === "function" ? answer : () => answer;
  globalThis.__RED_CALLS__ = 0;
  globalThis.__RED_PROMPTS__ = [];
  return {
    get calls() { return globalThis.__RED_CALLS__; },
    get prompts() { return globalThis.__RED_PROMPTS__; },
  };
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
const coveringAnswer = (fingerprints) => ({
  ...okAnswer(),
  json: { explanations: fingerprints.map((f) => ({ fingerprint: f, plain: "Plain words." })), notActionable: [] },
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

const finding = (over = {}) => ({
  ruleId: "secret.credential-pattern",
  fingerprint: "secret.credential-pattern:stage3.1:src/app.ts:abcdef01",
  severity: "medium",
  title: "Hardcoded credential",
  why: "A credential is hardcoded in the file.",
  ...over,
});

const loadExplain = () => loadWithStubs("convex/scans/aiExplain.ts", { "../adapters/ai": AI_STUB });
const loadLimit = () => loadWithStubs("convex/mcpLimit.ts");

describe("target 3: the explain spend gate (W3-GATE)", () => {
  // W3-HARDEN-A closed 3a, 3b, 3c and 3d. Each test below now asserts the fixed
  // behaviour and is labelled [DEFENDED]. The attack input is unchanged, so a
  // regression flips it back to a failure.
  it("[DEFENDED] a caller with no identity now spends one shared guest bucket, so holding more scan ids stops buying calls", async () => {
    const mod = await loadLimit();

    /** Press every scan twice, as the original attack did, and count what passed. */
    const sweep = async (ctx, scans, caller) => {
      let allowed = 0;
      for (let i = 0; i < scans; i += 1) {
        for (let press2 = 0; press2 < mod.EXPLAIN_SCAN_LIMIT; press2 += 1) {
          const press = await mod.consumeExplain.handler(ctx, {
            scanId: `scan-${i}`,
            ...(caller === undefined ? {} : { caller }),
          });
          if (press.allowed) allowed += 1;
        }
      }
      return allowed;
    };

    // The original 25-scan walk: 50 presses. It still passes in full, because the
    // shared guest cap is 60. Saying so is the honest reading, and the cap is not
    // a per-account number the guest gets on its own.
    const small = await sweep(makeRateCtx().ctx, 25, undefined);
    assert.equal(small, 50, "25 scans is still under the shared guest cap, so the number is unchanged there");

    // More scan ids, so the shared bucket has to bind. Before the fix this figure
    // grew one-for-one with the scan count; now it stops.
    const scans = 40;
    const guestAllowed = await sweep(makeRateCtx().ctx, scans, undefined);
    const accountAllowed = await sweep(makeRateCtx().ctx, scans, "user-1");

    assert.ok(
      guestAllowed < scans * 2,
      `the shared guest bucket must bind: ${guestAllowed} of ${scans * 2} presses were allowed`,
    );
    assert.equal(guestAllowed, Math.min(scans * 2, mod.EXPLAIN_GUEST_CALLER_LIMIT));
    assert.equal(accountAllowed, mod.EXPLAIN_CALLER_LIMIT, "one account stops at its own cap");
    // The mechanism: one bucket for every identity-less caller, with no scan id in
    // the key. That is what a new scan id can no longer escape.
    assert.equal(mod.explainCallerKey(null), "guest");
    assert.equal(mod.explainCallerKey("user-1"), "user:user-1");
    assert.equal(mod.explainCallerLimit(null), mod.EXPLAIN_GUEST_CALLER_LIMIT);
    assert.equal(mod.explainCallerLimit("user-1"), mod.EXPLAIN_CALLER_LIMIT);
    // Every scan still gets its own small budget, so one scan cannot starve
    // another and one scan id cannot buy repeated calls.
    const perScan = makeRateCtx();
    let sameScan = 0;
    for (let press2 = 0; press2 < mod.EXPLAIN_SCAN_LIMIT + 3; press2 += 1) {
      const press = await mod.consumeExplain.handler(perScan.ctx, { scanId: "scan-7" });
      if (press.allowed) sameScan += 1;
    }
    assert.equal(sameScan, mod.EXPLAIN_SCAN_LIMIT, "one scan id stops at the per-scan cap");
    verdict("3 spend gate", "DEFENDED", `an identity-less caller shares one bucket: ${scans} scan ids x 2 gave ${guestAllowed} allowed presses, stopping at EXPLAIN_GUEST_CALLER_LIMIT=${mod.EXPLAIN_GUEST_CALLER_LIMIT} (25 scans still gives 50, under the cap), against ${accountAllowed} for one account`);
  });

  it("[DEFENDED] the explain lane now has a global cap, so the same attack stops at a ceiling instead of scaling", async () => {
    const mod = await loadLimit();
    const source = readRepo("convex/mcpLimit.ts");
    assert.match(source, /mcp-scan-global/, "the MCP scan lane has a global bucket");
    assert.match(
      source.split("consumeExplain")[1] ?? "",
      /global/,
      "consumeExplain writes a global bucket now, in the same table and hourly window",
    );
    assert.ok(
      mod.EXPLAIN_GLOBAL_LIMIT > mod.EXPLAIN_CALLER_LIMIT,
      "the lane total must sit above the per-caller cap, so it binds across callers",
    );
    const ctx = makeRateCtx();
    let allowed = 0;
    let attempts = 0;
    // One fresh scan AND one fresh account per press, so neither the per-scan nor
    // the per-caller bucket can be what stops this. Only the lane total can. The
    // same 200x2 walk with a single identity is bounded earlier, by the guest
    // bucket, which is the fix for 3a rather than for this one.
    for (let i = 0; i < 200; i += 1) {
      for (let press2 = 0; press2 < 2; press2 += 1) {
        attempts += 1;
        const press = await mod.consumeExplain.handler(ctx.ctx, { scanId: `s-${i}`, caller: `u-${i}-${press2}` });
        if (press.allowed) allowed += 1;
      }
    }
    assert.equal(attempts, 400, "the attack loop must stay the 400 presses the original report measured");
    assert.ok(attempts > mod.EXPLAIN_GLOBAL_LIMIT, "the loop has to outlast the ceiling for the ceiling to mean anything");
    assert.equal(
      allowed,
      mod.EXPLAIN_GLOBAL_LIMIT,
      `400 presses with no shared identity must stop at the lane total, not at ${allowed} allowed presses`,
    );
    verdict("3 spend gate", "DEFENDED", `the lane now has a total: 400 presses, each on a fresh scan and a fresh account, stop at ${allowed} (EXPLAIN_GLOBAL_LIMIT), against 400 allowed before the fix`);
  });

  it("[DEFENDED] explainScan now runs the ownership check the report queries enforce, so another account's private findings are never posted", async () => {
    const mod = await loadExplain();
    const otherFingerprints = [finding({ fingerprint: "secret.credential-pattern:stage3.1:private/keys.ts:ffff0001" })];
    const provider = useProvider(coveringAnswer(otherFingerprints.map((f) => f.fingerprint)));
    // The scan belongs to user-a. The caller is user-b, and the public report
    // query refuses this caller.
    const scan = { analyzedAt: 1, status: "completed", signedIn: true, userId: "user-a" };
    assert.equal(
      canReadScan(scan, "user-b"),
      false,
      "the public report query refuses this caller, so the row is private to user-a",
    );
    const { ctx } = makeCtx({
      scan,
      findings: otherFingerprints,
      auth: { getUserIdentity: async () => ({ subject: "user-b" }) },
    });
    const result = await mod.explainScan.handler(ctx, { scanId: "scan-of-user-a" });

    assert.equal(provider.calls, 0, "a scan the caller does not own must reach no provider");
    assert.equal(provider.prompts.length, 0, "and no prompt is built from its finding text");
    assert.equal(result.providerCalled, false, "so the not-checked disclosure stays in place");
    assert.equal(result.source, "deterministic");
    assert.equal(result.explanations.length, 0, "a refused scan carries no explanations at all");
    assert.match(result.note, /not available|sign in|your account/i);
    assert.ok(
      !result.note.includes("Hardcoded credential"),
      "the refusal must not quote the finding wording it refused",
    );
    // The owner still gets the wording the lane exists for, so the check is a
    // rule and not a switch.
    const owner = useProvider(coveringAnswer(otherFingerprints.map((f) => f.fingerprint)));
    const ownerResult = await mod.explainScan.handler(
      makeCtx({
        scan,
        findings: otherFingerprints,
        auth: { getUserIdentity: async () => ({ subject: "user-a" }) },
      }).ctx,
      { scanId: "scan-of-user-a" },
    );
    assert.equal(owner.calls, 1, "the owner of the scan is still explained");
    assert.equal(ownerResult.providerCalled, true);
    // And a guest scan of a public repo is still readable by id, which is the
    // rule canReadScan defines and the product's share flow depends on.
    const guest = useProvider(coveringAnswer(otherFingerprints.map((f) => f.fingerprint)));
    const guestResult = await mod.explainScan.handler(
      makeCtx({ scan: { analyzedAt: 1, status: "completed" }, findings: otherFingerprints }).ctx,
      { scanId: "guest-scan" },
    );
    assert.equal(guest.calls, 1, "a guest scan carries no owner, so it stays id-addressed");
    assert.equal(guestResult.providerCalled, true);
    verdict("3 spend gate", "DEFENDED", "a held scan id for another account's signed-in scan now posts 0 provider calls and returns no findings; the owner and a guest scan are unaffected");
  });

  it("[DEFENDED] the gate is now claimed before the scan and findings reads, so a denied press does no work", async () => {
    const mod = await loadExplain();
    const provider = useProvider(okAnswer());
    const { ctx, calls } = makeCtx({ gate: { allowed: false, reason: "scan_limit" } });
    const result = await mod.explainScan.handler(ctx, { scanId: "scan-1" });
    assert.equal(result.providerCalled, false, "no spend, which is right");
    assert.deepEqual(
      calls.queries.map((q) => q.ref),
      [],
      "a denied press must read neither the scan row nor the findings",
    );
    assert.equal(
      result.explanations.length,
      0,
      "and it carries no findings, so a caller with many scan ids cannot make it do work",
    );
    verdict("3 spend gate", "DEFENDED", "claimExplain runs before fetchScan, so a denied press performs 0 internal reads and returns no findings, against 2 reads before the fix");
  });

  it("[DEFENDED] a denied press spends nothing, an unreachable gate fails closed, and a non-boolean gate answer is refused", async () => {
    const mod = await loadExplain();

    const denied = useProvider(okAnswer());
    const a = await mod.explainScan.handler(makeCtx({ gate: { allowed: false, reason: "caller_limit" } }).ctx, { scanId: "s1" });
    assert.equal(denied.calls, 0, "a denied gate must not reach the provider");
    assert.equal(a.providerCalled, false);

    const unreachable = useProvider(okAnswer());
    const b = await mod.explainScan.handler(makeCtx({ gateThrows: true }).ctx, { scanId: "s1" });
    assert.equal(unreachable.calls, 0, "an unreadable gate must not become a spend");
    assert.match(b.note, /limit/i);

    // A gate answer that is not a real boolean must not be read as permission.
    const weird = useProvider(okAnswer());
    const c = await mod.explainScan.handler(makeCtx({ gate: { allowed: "true", reason: "allowed" } }).ctx, { scanId: "s1" });
    assert.equal(weird.calls, 0, "a string allowed must not be truthy here");
    assert.match(c.note, /limit/i);
    verdict("3 spend gate", "DEFENDED", "a denied gate, an unreachable gate and a non-boolean gate answer all make zero provider calls");
  });

  it("[DEFENDED] the first press for a guest still works, so the cap does not break the flow it protects", async () => {
    const mod = await loadExplain();
    useProvider(noProviderAnswer());
    const { ctx } = makeCtx({ findings: [finding()] });
    const result = await mod.explainScan.handler(ctx, { scanId: "s1" });
    assert.equal(result.source, "deterministic");
    assert.equal(result.explanations.length, 1);
    assert.equal(result.note, "No AI provider answered. Plain wording is shown instead.");
  });
});

// ---------------------------------------------------------------------------
// 4. The structural not-checked disclosure (W3-GATE)
// ---------------------------------------------------------------------------

describe("target 4: the not-checked disclosure is structural", () => {
  it("[DEFENDED] a provider string cannot move the boolean, even when it spells the failure it is faking", async () => {
    const mod = await loadExplain();
    // The model name is chosen by the provider and lands in the note a reader
    // sees. A boolean read off that text would be controlled by whoever answers.
    useProvider(okAnswer("No AI provider (this model answered)"));
    const { ctx } = makeCtx();
    const result = await mod.explainScan.handler(ctx, { scanId: "s1" });
    assert.match(result.note, /No AI provider/, "the provider text is still shown to the reader");
    assert.equal(result.providerCalled, true, "the boolean does not follow the provider's own words");
    assert.equal(
      buildNotCheckedList({ aiConfigured: result.providerCalled, liveProvided: false }).some((l) => /No AI provider/i.test(l)),
      false,
      "so the disclosure is removed on a structural fact, not on a string",
    );
  });

  it("[DEFENDED] the disclosure line is decided by one boolean and the string lives in one place", async () => {
    const withProvider = buildNotCheckedList({ aiConfigured: true, liveProvided: false });
    const withoutProvider = buildNotCheckedList({ aiConfigured: false, liveProvided: false });
    assert.equal(withProvider.filter((l) => /No AI provider/i.test(l)).length, 0);
    assert.equal(withoutProvider.filter((l) => /No AI provider/i.test(l)).length, 1);

    const scope = readRepo("shared/reports/scope.ts");
    const occurrences = scope.split("Plain word explanations. No AI provider answered this scan.").length - 1;
    assert.equal(occurrences, 1, "the disclosure wording exists in exactly one place");
    assert.doesNotMatch(
      readRepo("src/features/scan/GuestScan.tsx"),
      /No AI provider\/i/,
      "the client must not test the note for the phrase",
    );
    // A provider that names itself after the phrase cannot reach the boolean:
    // the only writer of providerAnswered is the action's own field.
    const guest = readRepo("src/features/scan/GuestScan.tsx");
    const writers = [...guest.matchAll(/setProviderAnswered\(([^)]*)\)/g)].map((m) => m[1].trim());
    assert.ok(writers.length > 0);
    for (const writer of writers) {
      assert.match(
        writer,
        /^(false|result\.providerCalled)$/,
        `setProviderAnswered(${writer}) is not a structural value, so a string could reach the disclosure`,
      );
    }
    verdict("4 not-checked", "DEFENDED", "a provider model name spelling the failure leaves the boolean and the disclosure untouched; every writer passes a literal or result.providerCalled");
  });

  it("[DEFENDED] a rescan that changes the scan id clears the previous scan's answer, so the disclosure travels with its own scan", () => {
    // W3-HARDEN-B. The reset rides with the swap, so a provider answer on scan A
    // cannot remove the disclosure on scan B. It must not run on the no-change
    // path: that report is still the one the provider answered.
    const guest = readRepo("src/features/scan/GuestScan.tsx");
    const rescan = /async function onRescan\(\)[\s\S]*?\n  \}/.exec(guest)?.[0] ?? "";
    assert.ok(rescan.length > 0, "onRescan must be found for this to mean anything");
    const swap = rescan.indexOf("setScanId(rescan.scanId)");
    assert.ok(swap > 0, "the rescan swaps the scan on screen");
    const unchanged = rescan.indexOf("if (rescan.sameSha)");
    assert.ok(unchanged > 0 && unchanged < swap, "the unchanged-sha path returns before the swap");
    for (const call of ["setProviderAnswered(false)", "setExplanations([])", "setNotActionable([])"]) {
      const at = rescan.indexOf(call);
      assert.ok(
        at > swap,
        `${call} must run with the id swap, not only in the explain handler, or the new scan inherits the old scan's answer`,
      );
    }
    // The behaviour, not the words: tests/rescan-lifecycle-checks.mjs runs this
    // body against a state stub and checks the same three fields after a real
    // rescan, and that an unchanged sha and a thrown press change none of them.
    verdict(
      "4 not-checked",
      "DEFENDED",
      "the three pieces of per-scan provider state are reset with the id swap, so an answer on one scan cannot remove the disclosure on another; the unchanged-sha and failed paths keep the state of the report still on screen",
    );
  });
});

// ---------------------------------------------------------------------------
// 5. The fingerprint occurrence number (WS-4)
// ---------------------------------------------------------------------------

/** What convex/scans/analyze.ts pushEvidence does, using the shared helpers. */
function pushShape(ruleId, path, rawSnippet, findings) {
  const snippet = rawSnippet;
  const occurrence = occurrenceFor(findings, { ruleId, path, redactedSnippet: snippet });
  const fingerprint = fingerprintFinding(ruleId, ANALYZER_VERSION, path, snippet, occurrence);
  findings.push({ ruleId, path, redactedSnippet: snippet, fingerprint });
  return findings[findings.length - 1];
}

const DEDUPE = (findings) => {
  const seen = new Set();
  return findings.filter((f) => {
    if (seen.has(f.fingerprint)) return false;
    seen.add(f.fingerprint);
    return true;
  });
};

describe("target 5: the fingerprint occurrence number (WS-4)", () => {
  it("[DEFENDED] two runs over the same input produce byte identical fingerprints, in either file order", () => {
    const build = (files) => {
      const findings = [];
      for (const file of files) {
        for (const match of scanSecrets([file])) {
          pushShape(match.ruleId, match.path, match.snippet, findings);
        }
      }
      return findings;
    };
    const files = [
      { path: "src/a.ts", content: "eval(userInput)\neval(userInput)\n" },
      { path: "src/b.ts", content: "eval(userInput)\neval(other)\n" },
    ];
    const first = build(files);
    const second = build(files);
    const reversed = build([...files].reverse());
    const prints = (list) => list.map((f) => f.fingerprint).sort();
    assert.deepEqual(prints(first), prints(second), "two runs of the same input must agree");
    assert.deepEqual(prints(first), prints(reversed), "the occurrence count is per rule and path, so file order cannot move it");
    assert.equal(new Set(prints(first)).size, first.length, "no two findings share a fingerprint");
    assert.equal(
      DEDUPE(first).length,
      first.length,
      "the dedupe drops nothing, so a repeat is never lost",
    );
    assert.equal(first.length, 4, "the fixture must produce two identical lines plus two others");
  });

  it("[DEFENDED] the numbering cannot depend on the concurrent fetch order, because the file list is sorted before the analyzers run", () => {
    const analyze = readRepo("convex/scans/analyze.ts");
    const sortIndex = analyze.indexOf("files.sort(");
    const firstAnalyzer = analyze.indexOf("scanSecrets(files)");
    assert.ok(sortIndex > 0 && sortIndex < firstAnalyzer, "the sort must run before the analyzers see the list");
    const block = analyze.slice(Math.max(0, sortIndex - 400), sortIndex + 260);
    assert.match(block, /selected\.indexOf/, "the sort restores the selected order, not the fetch order");
    assert.match(block, /deterministic/i, "and the comment says why");
  });

  it("[DEFENDED] the occurrence suffix cannot collide with another finding's fingerprint, even with a colon in the path", () => {
    const a = fingerprintFinding("code.debug-leftover", ANALYZER_VERSION, "src/a.ts", "debugger;", 0);
    const b = fingerprintFinding("code.debug-leftover", ANALYZER_VERSION, "src/a.ts", "debugger;", 1);
    const colon = fingerprintFinding("code.debug-leftover", ANALYZER_VERSION, "src/a.ts:1", "debugger;", 0);
    assert.notEqual(a, b);
    assert.notEqual(colon, a);
    assert.notEqual(colon, b);
    // The hash is 8 hex characters and the analyzer version carries no colon, so
    // no path can absorb the occurrence suffix into the hash.
    assert.equal(a.split(":").length, 4, `ruleId:version:path:hash, got ${a}`);
    assert.equal(b.split(":").length, 5, `plus the occurrence, got ${b}`);
    // Fingerprints are used as opaque keys everywhere, so a wider string is safe.
    const consumers = ["convex/scans/rankScan.ts", "convex/scans/rescan.ts", "shared/reports/compare.ts"];
    for (const rel of consumers) {
      const source = readRepo(rel);
      assert.doesNotMatch(source, /\.fingerprint\.split\(":"\)/, `${rel} must not parse the fingerprint by colon`);
    }
  });

  it("[OPEN] identity is positional inside a run: deleting the first copy renumbers the second, so stored answers are orphaned", () => {
    const withBoth = [];
    pushShape("code.debug-leftover", "src/a.ts", "debugger;", withBoth);
    pushShape("code.debug-leftover", "src/a.ts", "debugger;", withBoth);
    const afterEdit = [];
    pushShape("code.debug-leftover", "src/a.ts", "debugger;", afterEdit);

    const repeatFingerprint = withBoth[1].fingerprint;
    const survivorFingerprint = afterEdit[0].fingerprint;
    assert.equal(repeatFingerprint, `${withBoth[0].fingerprint}:1`);
    assert.notEqual(
      repeatFingerprint,
      survivorFingerprint,
      "the same line has a different identity after the copy above it is deleted",
    );
    // The decision lane keys its stored answers on the question id, which
    // hashes the full fingerprint, so the renumbering drops the answer.
    assert.notEqual(
      questionIdFor(repeatFingerprint),
      questionIdFor(survivorFingerprint),
      "so the stored answer for that finding no longer applies after a rescan",
    );
    verdict("5 fingerprint", "OPEN", "a repeat's identity is its position in the run, so deleting an earlier identical line renumbers it and orphans its stored question id");
  });

  it("[DEFENDED] a single finding and every non-repeat keep the exact fingerprint they had before WS-4", () => {
    assert.equal(
      fingerprintFinding("code.debug-leftover", ANALYZER_VERSION, "src/a.ts", "debugger;"),
      `code.debug-leftover:${ANALYZER_VERSION}:src/a.ts:afe012ff`,
      "the stored legacy string is unchanged",
    );
    assert.equal(
      fingerprintFinding("code.debug-leftover", ANALYZER_VERSION, "src/a.ts", "debugger;", 0),
      `code.debug-leftover:${ANALYZER_VERSION}:src/a.ts:afe012ff`,
      "occurrence zero returns it unchanged too",
    );
  });
});

// ---------------------------------------------------------------------------
// 6. The local server review root (W3-INSTALL-ROOT)
//
// This one is driven for real: the Go module is built into a temp folder and
// the binary is spoken to over stdio, the way an MCP client would. No network
// is used, and no file in the repository is written.
// ---------------------------------------------------------------------------

const GO_SERVER = join(mkdtempSync("/tmp/opencode/red-team-go-"), "launchsense-mcp");
let goStatus = "not built";

// W4-MCP. The MCP stdio transport is newline-delimited JSON with no headers.
// This used to write an LSP Content-Length frame and the comment above it
// called that "the way an MCP client would", which is how CI stayed green over a
// server no conformant client could reach.
function frame(object) {
  return `${JSON.stringify(object)}\n`;
}

/** One launchsense_scan_repo call over stdio, with the review forced offline. */
function scanRepoCall(env, cwd) {
  return new Promise((resolve) => {
    const child = spawn(GO_SERVER, [], {
      cwd,
      env: {
        PATH: process.env.PATH,
        HOME: "/tmp/opencode/red-team-no-home",
        LAUNCHSENSE_OFFLINE: "1",
        ...env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let stderr = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", () => {
      const m = /"text":"((?:[^"\\]|\\.)*)"/.exec(out);
      resolve({ text: m === null ? out : JSON.parse(`"${m[1]}"`), raw: out, stderr });
    });
    child.stdin.write(
      frame({
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "red-team", version: "1" } },
      }),
    );
    child.stdin.write(
      frame({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "launchsense_scan_repo", arguments: {} },
      }),
    );
    child.stdin.end();
  });
}

/** A temp tree with one planted finding, so the reviewed root is provable. */
function plantedTree() {
  const tree = mkdtempSync("/tmp/opencode/red-team-tree-");
  mkdirSync(join(tree, "src"), { recursive: true });
  writeFileSync(join(tree, "src", "planted.ts"), "export function a() {\n  debugger;\n}\n");
  return tree;
}

const reviewScript = join(REPO, "mcp", "review-entry.ts");

describe("target 6: the local server review root (W3-INSTALL-ROOT)", () => {
  before(() => {
    const go = spawnSync("sh", ["-c", "command -v go"], { encoding: "utf8" });
    if (go.status !== 0) {
      goStatus = "go is not on PATH";
      return;
    }
    const build = spawnSync("go", ["build", "-o", GO_SERVER, "."], {
      cwd: join(REPO, "mcp"),
      encoding: "utf8",
      env: {
        ...process.env,
        GOPROXY: "off",
        GOFLAGS: "-mod=readonly",
        GOCACHE: process.env.GOCACHE ?? join("/tmp/opencode", "red-team-gocache"),
      },
      timeout: 300_000,
    });
    goStatus = build.status === 0 ? "built" : `build failed: ${(build.stderr || "").slice(0, 200)}`;
  });

  it("[DEFENDED] the installed shape reviews the named root even though the process folder is the mcp module", async function () {
    if (goStatus !== "built") return this.skip(`go build unavailable: ${goStatus}`);
    const tree = plantedTree();
    const result = await scanRepoCall(
      { LAUNCHSENSE_ROOT: tree, LAUNCHSENSE_REVIEW: reviewScript },
      join(REPO, "mcp"),
    );
    assert.match(result.text, /We read 1 files/, `the review must cover the named root; got: ${result.text.slice(0, 200)}`);
    assert.match(result.text, /Where: src\/planted\.ts/, "the planted finding is reported, so the root is the named tree");
    verdict("6 review root", "DEFENDED", "with the installer's absolute LAUNCHSENSE_ROOT the review reads the checkout, not the mcp folder");
  });

  it("[DEFENDED] a relative LAUNCHSENSE_ROOT is refused by name, so the process folder can no longer pass as the review root", async function () {
    if (goStatus !== "built") return this.skip(`go build unavailable: ${goStatus}`);
    // filepath.Abs(".") resolved against the process folder, which the installer
    // sets to the module folder, so the review read mcp/ and reported a confident
    // result on 8 Go files. That is the exact failure this target is about.
    for (const relative of [".", "..", "src"]) {
      const result = await scanRepoCall(
        { LAUNCHSENSE_ROOT: relative, LAUNCHSENSE_REVIEW: reviewScript },
        join(REPO, "mcp"),
      );
      assert.match(
        result.text,
        /LAUNCHSENSE_ROOT must be an absolute path/,
        `LAUNCHSENSE_ROOT=${relative} must be refused; got: ${result.text.slice(0, 200)}`,
      );
      assert.match(
        result.text,
        new RegExp(`got "${relative.replace(/\./g, "\\.")}"`),
        "and the refused value is named, so the reader knows what to fix",
      );
      assert.doesNotMatch(
        result.text,
        /We read \d+ files/,
        `LAUNCHSENSE_ROOT=${relative} ran no review, so the process folder was never read`,
      );
      assert.doesNotMatch(result.text, /go\.sum/, "and no mcp/ file appears in the answer");
    }
    verdict(
      "6 review root",
      "DEFENDED",
      "a relative LAUNCHSENSE_ROOT is refused with the value named and no review runs, so resolving . against the mcp module folder can no longer be a silent success",
    );
  });

  it("[DEFENDED] with no LAUNCHSENSE_ROOT the fallback still roots at the binary's folder, and the answer now names that folder", async function () {
    if (goStatus !== "built") return this.skip(`go build unavailable: ${goStatus}`);
    // A go install-ed binary lands in a bin folder, which is the realistic shape.
    // The root choice is unchanged, so the review is still of the executable's
    // folder. What changed is that the answer says so, instead of reporting a
    // confident review of whatever that folder happened to hold.
    const binFolder = dirname(GO_SERVER);
    const result = await scanRepoCall({ LAUNCHSENSE_REVIEW: reviewScript }, "/tmp");
    const quoted = binFolder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      result.text,
      new RegExp(`Reviewed folder: ${quoted}`),
      `the answer must name the folder it read; got: ${result.text.slice(0, 300)}`,
    );
    assert.match(
      result.text,
      /is not a LaunchSense checkout/,
      "and say the folder is not a checkout, so the reader knows the root is unverified",
    );
    assert.doesNotMatch(result.text, /go\.sum/, "the review read the bin folder, not the mcp module");
    verdict(
      "6 review root",
      "DEFENDED",
      "the no-env fallback is unchanged (the executable's folder) but the answer opens with Reviewed folder: <path> and says the folder is not a checkout, so a wrong root is visible instead of silent",
    );
  });

  it("[DEFENDED] the reviewed-folder line appears only for a folder that is not a checkout", async function () {
    if (goStatus !== "built") return this.skip(`go build unavailable: ${goStatus}`);
    // A checkout is quiet, or the line would be noise on every honest run.
    const checkout = mkdtempSync("/tmp/opencode/red-team-checkout-");
    mkdirSync(join(checkout, "mcp"), { recursive: true });
    writeFileSync(join(checkout, "mcp", "review-entry.ts"), readRepo("mcp/review-entry.ts"));
    const result = await scanRepoCall(
      { LAUNCHSENSE_ROOT: checkout, LAUNCHSENSE_REVIEW: reviewScript },
      join(REPO, "mcp"),
    );
    assert.doesNotMatch(
      result.text,
      /Reviewed folder:/,
      `a checkout must not be announced as a possible mistake; got: ${result.text.slice(0, 200)}`,
    );
    assert.match(result.text, /LaunchSense alpha review/, "and the review still runs");
  });

  it("[DEFENDED] an unreadable or non-folder LAUNCHSENSE_ROOT fails loudly instead of falling back", async function () {
    if (goStatus !== "built") return this.skip(`go build unavailable: ${goStatus}`);
    const missing = await scanRepoCall({ LAUNCHSENSE_ROOT: "/tmp/opencode/red-team-does-not-exist" }, join(REPO, "mcp"));
    assert.match(missing.text, /LAUNCHSENSE_ROOT is not readable/, "a bad root is refused, not silently replaced");
    const notAFolder = await scanRepoCall({ LAUNCHSENSE_ROOT: reviewScript }, join(REPO, "mcp"));
    assert.match(notAFolder.text, /LAUNCHSENSE_ROOT is not a folder/, "a file as the root is refused too");
  });

  it("[DEFENDED] the installer writes the checkout root as an absolute path, and the root is not checked against the review script", () => {
    const installer = readRepo("install.sh");
    assert.match(installer, /"LAUNCHSENSE_ROOT": "\$ROOT"/, "the installer names the checkout root");
    assert.ok(
      !/"LAUNCHSENSE_ROOT": "\$ROOT\/mcp"/.test(installer),
      "and never the module folder, which is the bug this target is about",
    );
    assert.match(installer, /"LAUNCHSENSE_REVIEW": "\$ROOT\/mcp\/review-entry\.ts"/, "the review script stays absolute");
    const runner = readRepo("mcp/review_local.go");
    const resolve = /func reviewScript\(root string\)[\s\S]*?\n\}/.exec(runner)?.[0] ?? "";
    assert.match(resolve, /LAUNCHSENSE_REVIEW/, "the script is taken from the environment first");
    assert.doesNotMatch(
      resolve.split("return named, nil")[0] ?? "",
      /os\.Stat\(named\)/,
      "and it is never checked for existence, so a stale path fails at node instead of at the check",
    );
    verdict("6 review root", "DEFENDED", "the installer writes an absolute checkout root; a missing root fails loudly. The review script is still unvalidated, noted not a hole");
  });
});

// A final table, so a reader sees every verdict in one place.
describe("red team summary", () => {
  it("prints one row per finding", () => {
    const rows = VERDICTS.map((v) => `  ${v.state.padEnd(14)} ${v.target.padEnd(18)} ${v.line}`);
    console.log(`\nW3-RED verdicts (${VERDICTS.length} measured):\n${rows.join("\n")}`);
    const open = VERDICTS.filter((v) => v.state.startsWith("OPEN")).length;
    console.log(`open: ${open}, defended: ${VERDICTS.length - open}`);
    assert.ok(VERDICTS.length >= 6, "every target must have produced a verdict");
  });
});
