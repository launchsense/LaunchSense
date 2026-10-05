import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// The Wave 6 identity and attribution lane. Nine things it has to hold:
//
//   1. a minted token resolves to a callerId, the raw token is never stored,
//      and a revoked token is refused
//   2. a wrong secret, a wrong publicId, a malformed token, and a missing
//      credential each fail closed, and the missing one is attributed:false
//      rather than dropped
//   3. the audience claim is checked, and a 401 carries WWW-Authenticate
//   4. declaredHarness is recorded and never changes a key or a decision
//   5. findInFlight never hands a foreign caller's row back
//   6. the quota key is the callerId when one resolved and the shared bucket
//      otherwise, and it still fails closed at the cap
//   7. commitSha and treeSha are both recorded and are not assumed equal
//   8. CORS allows Authorization
//   9. scans.surface and scans.channel are written on both paths
//
// No network. The fake GitHub answers come from a table in this file, and the
// credential entropy comes from the runtime's own CSPRNG, so a minted token is
// real without anything being fetched.
//
// Convex modules import `./_generated/*` and `convex/values`, which do not
// resolve outside the Convex runtime, so `loadWithStubs` copies a module into a
// temp directory with those pointed at stubs. The real handlers then run here
// against a fake ctx instead of being read as text.

const repoRoot = new URL("../", import.meta.url);
const readRepo = (rel) => readFileSync(new URL(rel, repoRoot), "utf8");

const tmpRoot = join("/tmp/opencode", "a7-identity-tests");
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
// The actions reach the mutations through the generated api map, so the stub names
// every mutation the flow calls. A test then runs those mutations for real.
const API_STUB = `
export const internal = {
  identity: { store: { resolveToken: "resolveToken" } },
  mcpLimit: { consumeMcpScan: "consumeMcpScan" },
  scans: {
    actions: { runHostedScan: "runHostedScan" },
    internal: {
      findInFlight: "findInFlight",
      findCachedScan: "findCachedScan",
      getTreeEntries: "getTreeEntries",
      createScan: "createScan",
      markShas: "markShas",
      markFetching: "markFetching",
      markCompleted: "markCompleted",
      markPartial: "markPartial",
      markFailed: "markFailed",
      upsertTree: "upsertTree",
    },
    store: { createRescan: "createRescan" },
  },
};
export const api = {};
export const components = {};
`;
// The scan action reads the signed-in GitHub token and the auth user. Both are
// stubbed to "not signed in" so the fake ctx never reaches for a session.
const AUTH_STUB = `
export const getAuthUserId = async () => null;
`;
const READ_TOKEN_STUB = `
export const readSessionToken = async () => null;
`;

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

// A real in-memory table. Every query, index range and page a fold performs runs
// against this, so a test sees the rows the code actually read rather than the
// rows the code claimed to read.
function makeDb(seed = {}) {
  const tables = new Map();
  for (const [name, rows] of Object.entries(seed)) {
    tables.set(name, rows.map((row, i) => ({ _id: row._id ?? `${name}-${i}`, ...row })));
  }
  let counter = 0;

  const all = (name) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name);
  };

  const matches = (rows, conditions) =>
    rows.filter((row) =>
      conditions.every(([field, op, value]) => {
        const actual = row[field];
        if (op === "eq") return actual === value;
        if (op === "lt") return typeof actual === "string" && actual < value;
        if (op === "gte") return actual >= value;
        return true;
      }),
    );

  const db = {
    query(table) {
      const conditions = [];
      // A real range builder. eq returns the builder so `q.eq(a).eq(b)` chains,
      // which is how every index query in this repo is written.
      const range = {
        eq(field, value) {
          conditions.push([field, "eq", value]);
          return range;
        },
        lt(field, value) {
          conditions.push([field, "lt", value]);
          return range;
        },
        gte(field, value) {
          conditions.push([field, "gte", value]);
          return range;
        },
      };
      const chain = {
        withIndex(_name, rangeFn) {
          if (typeof rangeFn === "function") rangeFn(range);
          return chain;
        },
        order() {
          return chain;
        },
        async take(n) {
          return matches(all(table), conditions).slice(0, n);
        },
        async collect() {
          return matches(all(table), conditions);
        },
        async unique() {
          const hit = matches(all(table), conditions);
          return hit.length === 0 ? null : hit[0];
        },
      };
      return chain;
    },
    get(table, id) {
      const hit = all(table).find((row) => row._id === id);
      return hit === undefined ? null : hit;
    },
    insert(table, doc) {
      counter += 1;
      const row = { _id: `${table}-new-${counter}`, ...doc };
      all(table).push(row);
      return row._id;
    },
    async patch(table, id, fields) {
      const row = all(table).find((r) => r._id === id);
      if (row !== undefined) Object.assign(row, fields);
    },
    async delete(table, id) {
      const rows = all(table);
      const at = rows.findIndex((row) => row._id === id);
      if (at !== -1) rows.splice(at, 1);
    },
    rows(table) {
      return all(table);
    },
  };
  return db;
}

// The identity module is pure, so it is imported directly with no stubs at all.
const cred = await import(new URL("../convex/identity/credential.ts", import.meta.url).href);
const quotaKey = await import(new URL("../convex/identity/quotaKey.ts", import.meta.url).href);
const attribution = await import(new URL("../convex/identity/attribution.ts", import.meta.url).href);
const snapshot = await import(new URL("../convex/scans/snapshot.ts", import.meta.url).href);

const COMMIT = "a".repeat(40);
const TREE = "b".repeat(40);
const OTHER_COMMIT = "c".repeat(40);

/** A credential row in the stored shape, with no raw token anywhere. */
function credentialRow(over = {}) {
  return {
    callerId: "k".repeat(32),
    tokenHash: "0".repeat(64),
    audience: cred.MCP_RESOURCE_URI,
    revoked: false,
    ...over,
  };
}

/**
 * A minted credential through the real store mutation, plus the row it wrote.
 *
 * No entropy is faked: the token comes from the runtime CSPRNG, so two calls
 * cannot produce the same token.
 */
async function mintWithStore(storeMod, ctx, args = {}) {
  const minted = await storeMod.mintCredential.handler(ctx, args);
  const row = ctx.db.get("credentials", minted.callerId);
  return { ...minted, row };
}

/**
 * Runs the real runHostedScan action against a fake GitHub and a real in-memory
 * database.
 *
 * The action module is loaded with two stubs and nothing else: the session token
 * reader and the auth user, both of which answer "not signed in" because an MCP
 * client is not a browser session. Every mutation the action reaches is the real
 * handler out of convex/scans/internal.ts, run against the same fake db, so the
 * rows a test reads are the rows the action wrote.
 *
 * The GitHub stub answers from a table keyed on the request URL, and records
 * every URL it was asked for. That is what lets a test assert a tree walk did
 * not happen a second time, and that no request ever carried a branch name where
 * a pinned sha belongs.
 */
async function loadScanHarness() {
  const internalMod = await loadWithStubs("convex/scans/internal.ts");
  const storeMod = await loadWithStubs("convex/scans/store.ts");
  const actionsMod = await loadWithStubs("convex/scans/actions.ts", {
    "@convex-dev/auth/server": AUTH_STUB,
    "../github/readToken": READ_TOKEN_STUB,
    "../adapters/github": GITHUB_STUB,
  });

  const mutations = { ...internalMod, ...storeMod };
  let db = makeDb();
  let requested = [];

  // The answers the fake GitHub gives. The commit response carries commit.tree.sha
  // because that is what the real one does, and it is what the integrity check
  // compares against.
  const github = {
    "https://api.github.com/repos/acme/widget": {
      status: 200,
      data: { default_branch: "main" },
    },
    "https://api.github.com/repos/acme/widget/commits/main": {
      status: 200,
      data: { sha: "a".repeat(40), commit: { tree: { sha: "b".repeat(40) } } },
    },
    [`https://api.github.com/repos/acme/widget/git/trees/${"a".repeat(40)}?recursive=1`]: {
      status: 200,
      data: { sha: "b".repeat(40), tree: [{ path: "a.ts", type: "blob" }, { path: "b.ts", type: "blob" }] },
    },
  };

  const ctx = {
    get db() {
      return db;
    },
    async runQuery(ref, args) {
      const fn = mutations[String(ref)];
      if (fn === undefined) throw new Error(`the harness has no query named ${String(ref)}`);
      return fn.handler({ db }, args);
    },
    async runMutation(ref, args) {
      const fn = mutations[String(ref)];
      if (fn === undefined) throw new Error(`the harness has no mutation named ${String(ref)}`);
      return fn.handler({ db }, args);
    },
    async runAction() {
      throw new Error("the scan action runs no further actions");
    },
  };

  globalThis.__W6_GITHUB__ = github;
  globalThis.__W6_REQUESTED__ = requested;

  return {
    get db() {
      return db;
    },
    get requested() {
      return globalThis.__W6_REQUESTED__;
    },
    /** One hosted scan of acme/widget, as the given caller. */
    async runScan({ callerId, channel = "mcp", seed = {} } = {}) {
      db = makeDb(seed);
      globalThis.__W6_REQUESTED__ = [];
      return actionsMod.runHostedScan.handler(ctx, {
        repoUrl: "https://github.com/acme/widget",
        callerId,
        channel,
      });
    },
  };
}

// The GitHub adapter stub. It records every URL so a test can measure what was
// fetched, and it answers from the table the harness installed.
const GITHUB_STUB = `
export const MAX_STORED_ENTRIES = 5000;
export const asRecord = (value) => (typeof value === "object" && value !== null ? value : null);
export const isRateLimitStatus = () => false;
export const normalizeTreeEntries = (data) => {
  const list = Array.isArray(data?.tree) ? data.tree : [];
  const entries = list
    .filter((entry) => typeof entry?.path === "string" && entry?.type === "blob")
    .map((entry) => ({ path: entry.path, type: entry.type }));
  return { entries, truncated: data?.truncated === true };
};
export const fetchBlobContent = async () => ({ status: "missing", content: "", size: 0, contentSha: "", resetAtMs: null });
export const fetchGitHubJson = async (url) => {
  (globalThis.__W6_REQUESTED__ = globalThis.__W6_REQUESTED__ ?? []).push(url);
  const answer = globalThis.__W6_GITHUB__?.[url];
  if (answer === undefined) return { status: 404, data: null, rate: { remaining: null, limit: null, resetAtMs: null, retryAfterMs: null }, etag: null };
  return { ...answer, rate: { remaining: 4000, limit: 5000, resetAtMs: null, retryAfterMs: null }, etag: null };
};
`;

describe("1. a minted credential resolves, is stored hashed, and revokes", () => {
  let store;
  let ctx;

  before(async () => {
    store = await loadWithStubs("convex/identity/store.ts");
    ctx = { db: makeDb() };
  });

  it("mints a token in the documented format and resolves it to a callerId", async () => {
    const minted = await mintWithStore(store, ctx);
    assert.match(minted.token, /^ls_live_[0-9a-f]{16}_[0-9a-f]{64}$/);
    assert.equal(minted.publicId, minted.token.split("_")[2]);

    const lookup = async (publicId) => {
      const row = ctx.db.rows("credentials").find((r) => r.publicId === publicId);
      if (row === undefined) return null;
      return {
        callerId: row._id,
        tokenHash: row.tokenHash,
        userId: row.userId,
        declaredHarness: row.declaredHarness,
        verifiedBinding: row.verifiedBinding,
        audience: row.audience,
        revoked: row.revoked === true,
      };
    };
    const resolved = await store.resolveToken.handler({ db: ctx.db }, { token: minted.token });
    assert.equal(resolved.resolved, true);
    assert.equal(resolved.callerId, minted.callerId);
    // And the pure rule agrees, which is what the query is built on.
    const outcome = await cred.resolveCredential(minted.token, lookup, {
      audience: cred.MCP_RESOURCE_URI,
    });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.credential.callerId, minted.callerId);
  });

  it("never stores the raw token anywhere in the row", async () => {
    const minted = await mintWithStore(store, ctx);
    const row = ctx.db.get("credentials", minted.callerId);
    const secret = minted.token.split("_")[3];
    const serialised = JSON.stringify(row);
    assert.ok(!serialised.includes(minted.token), "the full token must not be stored");
    assert.ok(!serialised.includes(secret), "the secret half must not be stored");
    // The stored hash is the SHA-256 of the FULL token, so a database read cannot
    // be replayed and the secret is not separately recoverable.
    assert.equal(row.tokenHash, await cred.hashToken(minted.token));
    assert.match(row.tokenHash, /^[0-9a-f]{64}$/);
    assert.ok(Object.keys(row).includes("publicId"), "the lookup prefix is stored in plaintext");
  });

  it("mints a different token every time", async () => {
    const a = await mintWithStore(store, ctx);
    const b = await mintWithStore(store, ctx);
    assert.notEqual(a.token, b.token);
    assert.notEqual(a.publicId, b.publicId);
    assert.notEqual(a.callerId, b.callerId);
  });

  it("refuses a revoked credential, and the refusal is immediate", async () => {
    const minted = await mintWithStore(store, ctx);
    const db = ctx.db;
    // Before the revoke it resolves.
    assert.equal(
      (await store.resolveToken.handler({ db }, { token: minted.token })).resolved,
      true,
    );
    await store.revokeCredential.handler({ db }, { callerId: minted.callerId });

    // After the revoke it does not, with no expiry to wait for.
    const after = await store.resolveToken.handler({ db }, { token: minted.token });
    assert.equal(after.resolved, false);
    assert.equal(after.failure, "revoked");
    // And no callerId leaks out of a refused resolve.
    assert.equal(after.callerId, undefined);
    const row = db.get("credentials", minted.callerId);
    assert.equal(row.revoked, true);
    assert.equal(typeof row.revokedAt, "number");
  });

  it("resolves against a row read once, never against the presented token", async () => {
    // The lookup is by publicId alone. A caller who guesses a valid publicId
    // still has to pass the hash compare, which is what stops the endpoint being
    // an existence oracle for publicIds.
    const minted = await mintWithStore(store, ctx);
    let lookups = 0;
    const lookup = async (publicId) => {
      lookups += 1;
      if (publicId !== minted.publicId) return null;
      return {
        callerId: minted.callerId,
        tokenHash: minted.row.tokenHash,
        audience: cred.MCP_RESOURCE_URI,
        revoked: false,
      };
    };
    const outcome = await cred.resolveCredential(
      `ls_live_${minted.publicId}_${"9".repeat(64)}`,
      lookup,
      { audience: cred.MCP_RESOURCE_URI },
    );
    assert.equal(outcome.ok, false);
    assert.equal(lookups, 1, "one indexed lookup, then the compare decides");
  });
});

describe("2. every wrong credential fails closed, and a missing one is recorded", () => {
  const lookupFor = (row) => async (publicId) =>
    row !== null && row.publicId === publicId
      ? {
          callerId: row.callerId,
          tokenHash: row.tokenHash,
          audience: row.audience,
          revoked: row.revoked === true,
        }
      : null;

  it("refuses a correct publicId with a wrong secret", async () => {
    const minted = cred.mintCredentialMaterial();
    const hash = await cred.hashToken(minted.token);
    const row = credentialRow({ publicId: minted.publicId, tokenHash: hash });
    const forged = `${cred.TOKEN_PREFIX}_${minted.publicId}_${"0".repeat(64)}`;
    const outcome = await cred.resolveCredential(forged, lookupFor(row), {
      audience: cred.MCP_RESOURCE_URI,
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.failure, "unknown_credential");
  });

  it("refuses a correct secret under a publicId that does not exist", async () => {
    const minted = cred.mintCredentialMaterial();
    const other = cred.mintCredentialMaterial();
    const hash = await cred.hashToken(minted.token);
    const row = credentialRow({ publicId: other.publicId, tokenHash: hash });
    const outcome = await cred.resolveCredential(minted.token, lookupFor(row), {
      audience: cred.MCP_RESOURCE_URI,
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.failure, "unknown_credential");
  });

  it("refuses every malformed token shape, without a lookup", async () => {
    const good = cred.mintCredentialMaterial();
    const hash = await cred.hashToken(good.token);
    const row = credentialRow({ publicId: good.publicId, tokenHash: hash });
    for (const bad of [
      "not-a-token",
      `${cred.TOKEN_PREFIX}_${good.publicId}`,
      `${cred.TOKEN_PREFIX}_${good.publicId}_short`,
      `ls_test_${good.publicId}_${good.secret}`,
      `ls_live_${good.publicId.toUpperCase()}_${good.secret}`,
      `ls_live_../../etc/passwd_${good.secret}`,
      `ls_live_${good.publicId}_${good.secret}_extra`,
      good.token.replace("ls_live_", "ls_live_ "),
      `Bearer ${good.token}`,
      "x".repeat(600),
    ]) {
      let looked = false;
      const outcome = await cred.resolveCredential(
        bad,
        async () => {
          looked = true;
          return null;
        },
        { audience: cred.MCP_RESOURCE_URI },
      );
      assert.equal(outcome.ok, false, `${JSON.stringify(bad.slice(0, 30))} must be refused`);
      assert.equal(outcome.failure, "malformed", `${JSON.stringify(bad.slice(0, 30))} must read as malformed`);
      assert.equal(looked, false, "a malformed token must not reach the database at all");
      assert.ok(row !== null);
    }
  });

  it("refuses a token one character short, because the hash covers the whole token", async () => {
    const minted = cred.mintCredentialMaterial();
    const hash = await cred.hashToken(minted.token);
    const row = credentialRow({ publicId: minted.publicId, tokenHash: hash });
    const truncated = minted.token.slice(0, -1);
    const outcome = await cred.resolveCredential(truncated, lookupFor(row), {
      audience: cred.MCP_RESOURCE_URI,
    });
    assert.equal(outcome.ok, false);
  });

  it("reports a missing credential as missing, and does not call the lookup", async () => {
    for (const absent of [null, undefined, ""]) {
      let looked = false;
      const outcome = await cred.resolveCredential(
        absent,
        async () => {
          looked = true;
          return null;
        },
        { audience: cred.MCP_RESOURCE_URI },
      );
      assert.equal(outcome.ok, false);
      assert.equal(outcome.failure, "missing");
      assert.equal(looked, false);
    }
  });

  it("records a missing credential as attributed:false rather than dropping the scan", () => {
    // The denominator is the point. A scan that happened is stored with attributed
    // explicitly false, so attributed / total is a real ratio.
    const anonymous = attribution.attributionFor(attribution.ANONYMOUS, "mcp");
    assert.equal(anonymous.attributed, false);
    assert.equal(anonymous.callerId, undefined);
    assert.equal(anonymous.channel, "mcp");
    assert.equal(anonymous.surface, "mcp_hosted");

    // A refused credential that somehow arrived as an identity with no callerId
    // is also unattributed, never half-attributed.
    for (const identity of [
      { resolved: false, callerId: "k".repeat(32) },
      { resolved: true, callerId: "" },
      { resolved: true },
    ]) {
      const out = attribution.attributionFor(identity, "api");
      assert.equal(out.attributed, false);
      assert.equal(out.callerId, undefined, "an unattributed scan must carry no callerId");
    }
  });
});

describe("3. the audience claim is checked and a 401 carries WWW-Authenticate", () => {
  it("refuses a credential minted for a different resource", async () => {
    const minted = cred.mintCredentialMaterial();
    const hash = await cred.hashToken(minted.token);
    const row = credentialRow({
      publicId: minted.publicId,
      tokenHash: hash,
      audience: "https://evil.example/mcp",
    });
    const outcome = await cred.resolveCredential(minted.token, async (publicId) => {
      if (publicId !== row.publicId) return null;
      return {
        callerId: row.callerId,
        tokenHash: row.tokenHash,
        audience: row.audience,
        revoked: false,
      };
    }, { audience: cred.MCP_RESOURCE_URI });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.failure, "audience_mismatch");
  });

  it("accepts a credential whose audience is the canonical MCP server URI", () => {
    assert.equal(cred.MCP_RESOURCE_URI, "https://harmless-chihuahua-667.convex.site/mcp");
    assert.equal(cred.audienceAccepts(cred.MCP_RESOURCE_URI, cred.MCP_RESOURCE_URI), true);
    assert.equal(cred.audienceAccepts("", cred.MCP_RESOURCE_URI), false);
    assert.equal(cred.audienceAccepts("https://harmless-chihuahua-667.convex.site/mcp/", cred.MCP_RESOURCE_URI), false);
  });

  it("mints every credential for that one audience, so the check is on every row", async () => {
    const store = await loadWithStubs("convex/identity/store.ts");
    const db = makeDb();
    const minted = await mintWithStore(store, { db });
    assert.equal(minted.row.audience, cred.MCP_RESOURCE_URI);
    assert.equal(minted.row.revoked, false);
  });

  it("reads only a Bearer scheme, and a non-Bearer header is refused, not anonymous", () => {
    assert.equal(cred.bearerTokenFromHeader("Bearer ls_live_abc_def"), "ls_live_abc_def");
    assert.equal(cred.bearerTokenFromHeader("bearer\ttok"), "tok");
    for (const raw of ["Basic abc", "ls_live_abc_def", "Token abc", "", "   ", "BearerNoSpace abc"]) {
      assert.equal(
        cred.bearerTokenFromHeader(raw),
        null,
        `${JSON.stringify(raw)} must not parse as a Bearer token`,
      );
    }
    // The route refuses a present-but-non-Bearer header, so it cannot be
    // silently treated as no credential at all.
    const http = readRepo("convex/http.ts");
    assert.match(http, /header\.trim\(\)\.length > 0/);
    assert.match(http, /unauthorizedResponse\("invalid"\)/);
  });

  it("puts WWW-Authenticate on every 401, naming the protected resource metadata", () => {
    for (const reason of ["missing", "invalid"]) {
      const { status, headers, body } = cred.unauthorizedResponse(reason);
      assert.equal(status, 401);
      assert.match(
        headers["WWW-Authenticate"],
        /^Bearer resource_metadata="https:\/\/harmless-chihuahua-667\.convex\.site\/\.well-known\/oauth-protected-resource\/mcp"/,
      );
      // RFC 9728 puts the metadata at a well-known path derived from the resource
      // identifier, and the header must point at exactly that.
      assert.ok(
        headers["WWW-Authenticate"].includes(
          cred.PROTECTED_RESOURCE_METADATA_URL.replace("https://harmless-chihuahua-667.convex.site", ""),
        ),
        "the header must point at the RFC 9728 well-known path",
      );
      assert.equal(headers["Cache-Control"], "no-store");
      const text = JSON.stringify(body);
      assert.ok(!/ls_live_/.test(text), "the body must never echo the token shape");
    }
  });

  it("never authenticates on Mcp-Session-Id, anywhere", () => {
    // The header is only ever named in the CORS allow list, and never read. A
    // route that read it as a credential would be the exact failure the MCP
    // security guidance names: a replayable handle standing in for a credential.
    const http = readRepo("convex/http.ts");
    assert.doesNotMatch(http, /headers\.get\(\s*["'][^"']*session/i, "no route may read a session header");
    assert.doesNotMatch(http, /runQuery\([^)]*session/i);

    // The one place a header becomes a credential reads exactly one header name,
    // and that name is Authorization.
    const credential = readRepo("convex/identity/credential.ts");
    const fn = /export function bearerTokenFromHeader[\s\S]*?\n}/.exec(credential);
    assert.notEqual(fn, null, "bearerTokenFromHeader must exist to be checked");
    assert.doesNotMatch(fn[0], /session/i, "bearerTokenFromHeader must not know about a session header");
    assert.match(fn[0], /\^Bearer\[ \\t\]\+\(\\S\+\)/, "it reads a Bearer scheme and nothing else");
    // And the routes read exactly the Authorization header and hand it to that
    // function. A header that is present but is not a Bearer token is refused
    // rather than treated as anonymous, so a credential pasted without its
    // scheme cannot fall through and keep working.
    assert.match(http, /request\.headers\.get\("authorization"\)/);
    assert.match(http, /bearerTokenFromHeader\(header\)/);
    assert.match(http, /header\.trim\(\)\.length > 0/);
    assert.match(http, /unauthorizedResponse\("invalid"\)/);
  });

  it("checks the credential before reading the body on every MCP route", () => {
    const http = readRepo("convex/http.ts");
    for (const path of ['path: "/mcp"', 'path: "/api/mcp/scan"', 'path: "/api/mcp/report"']) {
      const at = http.indexOf(path);
      assert.notEqual(at, -1, `${path} must exist`);
      const block = http.slice(at, at + 1200);
      const authAt = block.indexOf("authenticate(ctx, request)");
      const bodyAt = block.indexOf("request.json()");
      assert.notEqual(authAt, -1, `${path} must resolve the credential`);
      assert.ok(authAt < bodyAt, `${path} must check the credential before the body`);
    }
  });
});

describe("4. declaredHarness is recorded and never changes a key or a decision", () => {
  it("is carried on the resolved credential and onto the scan row", async () => {
    const store = await loadWithStubs("convex/identity/store.ts");
    const db = makeDb();
    const minted = await mintWithStore(store, { db }, { declaredHarness: "claude-code" });
    const resolved = await store.resolveToken.handler({ db }, { token: minted.token });
    assert.equal(resolved.declaredHarness, "claude-code");
    assert.equal(resolved.resolved, true);

    const attributed = attribution.attributionFor(
      {
        resolved: true,
        callerId: minted.callerId,
        declaredHarness: resolved.declaredHarness,
      },
      "mcp",
    );
    assert.equal(attributed.declaredHarness, "claude-code");
    assert.equal(attributed.attributed, true);
  });

  it("changes no rate limit key, whatever it says", async () => {
    const callerId = "k".repeat(32);
    const now = Date.UTC(2026, 9, 6, 3, 20, 0);
    const baseline = quotaKey.hostedScanKeys(callerId, now);
    for (const label of ["claude-code", "cursor", "x".repeat(200), "caller:" + "z".repeat(32)]) {
      // The label is not an argument to the key function at all, so the key
      // cannot depend on it. That is the structural form of the claim.
      assert.deepEqual(quotaKey.hostedScanKeys(callerId, now), baseline, `${label} changed a key`);
      assert.equal(quotaKey.hostedScanKeys.length, 2, "the key function takes an id and a clock, nothing else");
    }
  });

  it("changes no access decision, because no access rule reads it", () => {
    const own = { attributedCallerId: "k".repeat(32) };
    const other = { attributedCallerId: "j".repeat(32) };
    assert.equal(attribution.callerOwnsScan(own, "k".repeat(32)), true);
    assert.equal(attribution.callerOwnsScan(own, "j".repeat(32)), false);

    // The in-flight rule reads the callerId and nothing else on the row.
    assert.equal(attribution.mayReuseInFlight({ attributedCallerId: "k".repeat(32) }, "k".repeat(32)), true);
    assert.equal(attribution.mayReuseInFlight({ attributedCallerId: "k".repeat(32) }, "j".repeat(32)), false);

    // And the report ownership rule in shared/ is untouched by any of this.
    const scanAccess = readRepo("shared/reports/scanAccess.ts");
    assert.doesNotMatch(scanAccess, /harness/i);
  });

  it("is absent when nothing declared it, rather than defaulted to a guess", async () => {
    const store = await loadWithStubs("convex/identity/store.ts");
    const db = makeDb();
    const minted = await mintWithStore(store, { db });
    const resolved = await store.resolveToken.handler({ db }, { token: minted.token });
    assert.equal(resolved.declaredHarness, undefined);
    const out = attribution.attributionFor({ resolved: true, callerId: minted.callerId }, "mcp");
    assert.equal(out.declaredHarness, undefined);
  });
});

describe("5. findInFlight never hands a foreign caller's row back", () => {
  let internal;
  before(async () => {
    internal = await loadWithStubs("convex/scans/internal.ts");
  });

  const inflight = (over = {}) => ({
    _id: "scan-foreign",
    _creationTime: 1,
    owner: "acme",
    repo: "widget",
    repoUrl: "https://github.com/acme/widget",
    status: "fetching",
    sha: "d".repeat(40),
    signedIn: false,
    createdAt: 1,
    updatedAt: Date.now(),
    ...over,
  });

  const args = (callerId) => ({
    owner: "acme",
    repo: "widget",
    sinceMs: Date.now() - 120000,
    signedIn: false,
    callerId,
  });

  it("returns null ownership for another caller's row instead of the row itself", async () => {
    const other = "j".repeat(32);
    const ctx = {
      db: makeDb({
        scans: [inflight({ attributedCallerId: other, attributed: true })],
      }),
    };
    const found = await internal.findInFlight.handler(ctx, args("k".repeat(32)));
    assert.notEqual(found, null, "the row is still visible, so the caller can tell it is not theirs");
    assert.equal(found.owned, false);
  });

  it("hands the same caller's row straight back", async () => {
    const mine = "k".repeat(32);
    const ctx = { db: makeDb({ scans: [inflight({ attributedCallerId: mine, attributed: true })] }) };
    const found = await internal.findInFlight.handler(ctx, args(mine));
    assert.equal(found.owned, true);
    assert.equal(found.scan._id, "scan-foreign");
  });

  it("never lets an anonymous caller take a credentialed row", async () => {
    const ctx = {
      db: makeDb({
        scans: [inflight({ attributedCallerId: "k".repeat(32), attributed: true })],
      }),
    };
    const found = await internal.findInFlight.handler(ctx, args(undefined));
    assert.equal(found.owned, false);
  });

  it("shares the anonymous pool between two anonymous callers, which is honest", async () => {
    const ctx = { db: makeDb({ scans: [inflight()] }) };
    const found = await internal.findInFlight.handler(ctx, args(undefined));
    assert.equal(found.owned, true, "an unattributed row belongs to the anonymous pool, not to nobody");
  });

  it("agrees with the pure ownership rule on every combination", () => {
    const mine = "k".repeat(32);
    const theirs = "j".repeat(32);
    const cases = [
      [{ attributedCallerId: mine }, mine, true],
      [{ attributedCallerId: mine }, theirs, false],
      [{ attributedCallerId: mine }, null, false],
      [{}, null, true],
      [{}, mine, false],
      [{}, theirs, false],
    ];
    for (const [row, callerId, want] of cases) {
      assert.equal(
        attribution.mayReuseInFlight(row, callerId),
        want,
        `${JSON.stringify(row)} for ${callerId}`,
      );
    }
  });

  it("mints a new owned row and copies the cached tree, instead of reusing the foreign one", async () => {
    // The real action, end to end, against a fake GitHub. Two callers scan the
    // same public repository at the same moment; the second must get its own row
    // with the cached tree copied into it, never the first caller's row.
    const harness = await loadScanHarness();
    const mine = "k".repeat(32);
    const theirs = "j".repeat(32);

    const scan = await harness.runScan({
      callerId: mine,
      seed: {
        scans: [
          // The foreign caller's in-flight row, with a sha already pinned. This is
          // exactly the row the old findInFlight handed back.
          {
            _id: "scan-theirs",
            owner: "acme",
            repo: "widget",
            repoUrl: "https://github.com/acme/widget",
            status: "fetching",
            sha: "a".repeat(40),
            signedIn: false,
            attributed: true,
            attributedCallerId: theirs,
            channel: "mcp",
            surface: "mcp_hosted",
            createdAt: Date.now() - 1000,
            updatedAt: Date.now() - 500,
          },
          // A finished scan at the same sha, so the 24h sha-keyed cache is warm.
          {
            _id: "scan-earlier",
            owner: "acme",
            repo: "widget",
            repoUrl: "https://github.com/acme/widget",
            status: "completed",
            sha: "a".repeat(40),
            commitSha: "a".repeat(40),
            treeSha: "b".repeat(40),
            signedIn: false,
            attributed: false,
            createdAt: Date.now() - 60000,
            updatedAt: Date.now() - 500,
          },
        ],
        repoTrees: [
          {
            _id: "tree-1",
            owner: "acme",
            repo: "widget",
            sha: "a".repeat(40),
            treeSha: "b".repeat(40),
            fetchedAt: Date.now() - 1000,
            fileCount: 2,
            truncated: false,
            treeTruncated: false,
            entryCountStored: 2,
            entries: [{ path: "a.ts", type: "blob" }, { path: "b.ts", type: "blob" }],
          },
        ],
      },
    });

    assert.notEqual(scan.scanId, "scan-theirs", "the foreign row must not be the row returned");
    const row = harness.db.get("scans", scan.scanId);
    assert.equal(row.attributedCallerId, mine, "the new row belongs to the caller that asked");
    assert.equal(row.attributed, true);
    assert.equal(row.fileCount, 2, "the cached tree was copied into the new owned row");
    assert.equal(row.sha, "a".repeat(40));
    assert.equal(row.commitSha, "a".repeat(40));
    assert.equal(row.treeSha, "b".repeat(40));
    assert.equal(scan.cached, true, "the tree came from the sha-keyed cache, not a second walk");
    assert.ok(
      !harness.requested.some((url) => url.includes("/git/trees/")),
      "no tree was re-fetched: the cached tree was copied",
    );
    // The foreign row is untouched: it was skipped, not stolen or rewritten.
    const foreign = harness.db.get("scans", "scan-theirs");
    assert.equal(foreign.attributedCallerId, theirs);
    assert.equal(foreign.status, "fetching");
  });

  it("hands the same caller its own in-flight row rather than minting a second one", async () => {
    const harness = await loadScanHarness();
    const mine = "k".repeat(32);
    const scan = await harness.runScan({
      callerId: mine,
      seed: {
        scans: [
          {
            _id: "scan-mine",
            owner: "acme",
            repo: "widget",
            repoUrl: "https://github.com/acme/widget",
            status: "fetching",
            sha: "a".repeat(40),
            signedIn: false,
            attributed: true,
            attributedCallerId: mine,
            channel: "mcp",
            surface: "mcp_hosted",
            createdAt: Date.now() - 1000,
            updatedAt: Date.now() - 500,
          },
        ],
      },
    });
    assert.equal(scan.scanId, "scan-mine", "your own in-flight row is still reused, so no work is repeated");
    assert.equal(scan.cached, true);
    assert.equal(harness.db.rows("scans").length, 1, "and no second row was minted");
  });

  it("records an anonymous hosted scan as attributed:false with no callerId", async () => {
    const harness = await loadScanHarness();
    const scan = await harness.runScan({ callerId: undefined });
    const row = harness.db.get("scans", scan.scanId);
    assert.equal(row.attributed, false);
    assert.equal(row.attributedCallerId, undefined);
    assert.equal(row.channel, "mcp");
    assert.equal(row.surface, "mcp_hosted");
    // The scan happened and is stored, so it is in the denominator.
    assert.equal(harness.db.rows("scans").length, 1);
  });

  it("leaves the sha-keyed cache shared between callers", async () => {
    const internal2 = internal;
    const db = makeDb({
      repoTrees: [
        {
          _id: "tree-1",
          owner: "acme",
          repo: "widget",
          sha: "a".repeat(40),
          fetchedAt: Date.now(),
          fileCount: 7,
          truncated: false,
          treeTruncated: false,
          entryCountStored: 7,
          entries: [],
        },
      ],
    });
    // No caller argument at all: the cache is keyed on (owner, repo, sha) and
    // never was on a caller, which is why the ownership fix does not break it.
    const forOne = await internal2.getTreeEntries.handler(
      { db },
      { owner: "acme", repo: "widget", sha: "a".repeat(40) },
    );
    const forTwo = await internal2.getTreeEntries.handler(
      { db },
      { owner: "acme", repo: "widget", sha: "a".repeat(40) },
    );
    assert.equal(forOne.fileCount, forTwo.fileCount);
    assert.equal(forOne.fileCount, 7);
  });
});

describe("6. the quota key is the callerId when one resolved, the shared bucket otherwise", () => {
  let limit;
  before(async () => {
    limit = await loadWithStubs("convex/mcpLimit.ts");
  });

  const rateCtx = () => {
    const db = makeDb();
    return { ctx: { db }, keys: () => db.rows("rateLimits").map((r) => r.key) };
  };

  it("keys on the callerId when a credential resolved", async () => {
    const callerId = "k".repeat(32);
    const { ctx, keys } = rateCtx();
    const gate = await limit.consumeMcpScan.handler(ctx, { callerId });
    assert.equal(gate.allowed, true);
    assert.ok(keys().some((k) => k.includes(`caller:${callerId}`)), keys().join(" | "));
    assert.ok(!keys().some((k) => k.includes(quotaKey.HOSTED_CALLER_BUCKET)), "no shared bucket for an identified caller");
    // The per-caller day row exists, so 48 scans a day is no longer reachable by
    // staying inside the hourly cap.
    assert.ok(keys().some((k) => k.startsWith("mcp-scan-day:")));
  });

  it("keys on the one shared bucket when no credential resolved", async () => {
    const { ctx, keys } = rateCtx();
    const gate = await limit.consumeMcpScan.handler(ctx, {});
    assert.equal(gate.allowed, true);
    assert.ok(keys().some((k) => k.includes(quotaKey.HOSTED_CALLER_BUCKET)), keys().join(" | "));
    // No per-caller day row: a shared bucket has no per-caller day to count.
    assert.ok(!keys().some((k) => k.startsWith("mcp-scan-day:")));
  });

  it("gives two resolved callers two separate budgets", async () => {
    const { ctx, keys } = rateCtx();
    await limit.consumeMcpScan.handler(ctx, { callerId: "k".repeat(32) });
    await limit.consumeMcpScan.handler(ctx, { callerId: "j".repeat(32) });
    const hourly = keys().filter((k) => k.startsWith("mcp-scan:") && !k.includes("global"));
    assert.equal(hourly.length, 2, "one row per caller, not one shared row");
  });

  it("still shares one budget between two anonymous callers", async () => {
    const { ctx, keys } = rateCtx();
    await limit.consumeMcpScan.handler(ctx, {});
    await limit.consumeMcpScan.handler(ctx, {});
    const row = keys().filter((k) => k.startsWith("mcp-scan:") && !k.includes("global"));
    assert.equal(row.length, 1, "two anonymous callers share the one bucket");
    const db = ctx.db;
    const count = db.rows("rateLimits").find((r) => r.key === row[0]).count;
    assert.equal(count, 2);
  });

  it("fails closed at the per-caller hourly cap", async () => {
    const callerId = "k".repeat(32);
    const { ctx } = rateCtx();
    let allowed = 0;
    let last = null;
    for (let i = 0; i < quotaKey.CALLER_HOURLY_LIMIT + 5; i += 1) {
      last = await limit.consumeMcpScan.handler(ctx, { callerId });
      if (last.allowed) allowed += 1;
    }
    assert.equal(allowed, quotaKey.CALLER_HOURLY_LIMIT);
    assert.equal(last.allowed, false);
    assert.equal(last.reason, "caller_hourly_limit");
  });

  it("fails closed at the per-caller daily cap", async () => {
    const callerId = "k".repeat(32);
    const { ctx } = rateCtx();
    const db = ctx.db;
    // The hourly window rolls over as the test presses, so the daily row is the
    // only thing left standing. That is the point: without it, an hourly cap alone
    // permits 48 scans a day per caller.
    const hourlyKeys = () =>
      db.rows("rateLimits").filter((r) => !r.key.startsWith("mcp-scan-day:"));
    let allowed = 0;
    let dayRefusals = 0;
    for (let i = 0; i < quotaKey.CALLER_DAILY_LIMIT + 10; i += 1) {
      const gate = await limit.consumeMcpScan.handler(ctx, { callerId });
      if (gate.allowed) allowed += 1;
      if (gate.reason === "caller_daily_limit") dayRefusals += 1;
      // Pretend the hour rolled over: every hourly row resets, the daily row does
      // not. That is the only way the daily cap can be what binds.
      for (const row of hourlyKeys()) db.patch("rateLimits", row._id, { count: 0 });
    }
    assert.equal(allowed, quotaKey.CALLER_DAILY_LIMIT, "the daily cap is what stops the presses");
    assert.ok(dayRefusals > 0, "and it is refused by the daily reason, not the hourly one");
    assert.equal(
      db.rows("rateLimits").find((r) => r.key.startsWith("mcp-scan-day:")).count,
      quotaKey.CALLER_DAILY_LIMIT,
    );
  });

  it("keeps the lane ceiling above every caller cap, so a bucket binds first", async () => {
    assert.ok(limit.GLOBAL_LIMIT > quotaKey.CALLER_HOURLY_LIMIT);
    assert.ok(limit.GLOBAL_LIMIT > quotaKey.SHARED_HOURLY_LIMIT);
    // The shared number is written in two places: CALLER_LIMIT is the one the
    // public documents quote, and the quota module has its own copy so it can stay
    // free of a Convex import. Two copies of one number is a drift risk, so it is
    // pinned here rather than trusted.
    assert.equal(
      quotaKey.SHARED_HOURLY_LIMIT,
      limit.CALLER_LIMIT,
      "the shared bucket cap must be the same number the docs quote",
    );
    // And the documented policy numbers are named as unmeasured, so a reader
    // cannot mistake them for a measurement.
    const source = readRepo("convex/identity/quotaKey.ts");
    assert.match(source, /no traffic measurement|Unknown until measured/i);
  });

  it("falls back to the shared bucket for a callerId that is not a row id", () => {
    for (const junk of ["", "  ", "not-a-row-id", "../../etc", "x".repeat(200), null, undefined, 42]) {
      assert.equal(quotaKey.safeCallerId(junk), null, `${JSON.stringify(junk)} must not become a key`);
      assert.equal(
        quotaKey.hostedCallerBucket(junk),
        quotaKey.HOSTED_CALLER_BUCKET,
        `${JSON.stringify(junk)} must not mint a bucket of its own`,
      );
    }
  });

  it("reads no address header on either hosted route", () => {
    // Comments may name the header this lane removed; code may not read it.
    const codeOnly = (text) =>
      text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "");
    for (const file of ["convex/http.ts", "convex/mcpLimit.ts", "convex/identity/quotaKey.ts"]) {
      assert.doesNotMatch(
        codeOnly(readRepo(file)),
        /x-forwarded-for/i,
        `${file} must not read a caller address into a key`,
      );
    }
  });
});

describe("7. commitSha and treeSha are both recorded and never assumed equal", () => {
  it("records both, and keeps them distinct when they differ", () => {
    const same = snapshot.checkSnapshot({ commitSha: COMMIT, treeSha: TREE, commitTreeSha: TREE });
    assert.equal(same.ok, true);
    assert.equal(same.commitSha, COMMIT);
    assert.equal(same.treeSha, TREE);
    assert.notEqual(same.commitSha, same.treeSha, "the fixture uses two different shas on purpose");

    // The commit response promised this tree, and the tree response returned it.
    const agreed = snapshot.checkSnapshot({ commitSha: COMMIT, treeSha: TREE, commitTreeSha: TREE });
    assert.equal(agreed.treeSha, TREE);
  });

  it("fails the scan when the tree response describes a different tree", () => {
    const mismatch = snapshot.checkSnapshot({
      commitSha: COMMIT,
      treeSha: TREE,
      commitTreeSha: OTHER_COMMIT,
    });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.defect, "tree_sha_mismatch");
  });

  it("refuses an unpinned commit sha, so a ref cannot become a scan", () => {
    for (const ref of ["main", "feature/x", "HEAD", "", "abc", "z".repeat(40), COMMIT.toUpperCase()]) {
      const out = snapshot.checkSnapshot({ commitSha: ref });
      assert.equal(out.ok, false, `${ref} must not pin a scan`);
      assert.equal(out.defect, "commit_sha_unpinned");
      assert.equal(snapshot.treeRequestUrl("acme", "widget", ref), null);
      assert.equal(snapshot.blobRefQuery(ref), null);
    }
    assert.equal(snapshot.isPinnedCommitSha(COMMIT), true);
    assert.match(snapshot.treeRequestUrl("acme", "widget", COMMIT), /git\/trees\/a{40}\?recursive=1$/);
    assert.equal(snapshot.blobRefQuery(COMMIT), `?ref=${COMMIT}`);
  });

  it("pins the real blob read through that function, not an inline ref", () => {
    // The claim is only true if the code that fetches file bodies uses it.
    // Before this, blobRefQuery had no caller outside the module and the adapter
    // built ?ref=<sha> inline with no validation.
    const github = readRepo("convex/adapters/github.ts");
    assert.match(github, /import \{ blobRefQuery \} from "\.\.\/scans\/snapshot"/);
    assert.match(github, /const ref = blobRefQuery\(sha\)/);
    assert.doesNotMatch(github, /\?ref=\$\{sha\}/, "the blob ref must not be built inline");
  });

  it("pins the tarball read too, so no adapter trusts its caller for a sha", () => {
    // The tarball sha came from scan.sha, which is only written after the same
    // check passes. Enforcing it at the writer but not the reader is exactly the
    // shape that left the blob path unpinned, so the reader checks as well.
    const tarball = readRepo("convex/adapters/tarball.ts");
    assert.match(tarball, /import \{ isPinnedCommitSha \} from "\.\.\/scans\/snapshot"/);
    assert.match(tarball, /if \(!isPinnedCommitSha\(sha\)\)/);
  });

  it("reads the two shas off the responses the code actually gets", () => {
    const commit = { sha: COMMIT, commit: { tree: { sha: TREE } } };
    assert.equal(snapshot.commitShaOf(commit), COMMIT);
    assert.equal(snapshot.commitTreeShaOf(commit), TREE);
    assert.equal(snapshot.treeShaOf({ sha: TREE, tree: [] }), TREE);
    // Absent is undefined, not a guess, so a response with no tree sha does not
    // become a claim that the two are equal.
    assert.equal(snapshot.commitTreeShaOf({ sha: COMMIT }), undefined);
    assert.equal(snapshot.commitTreeShaOf({ sha: COMMIT, commit: {} }), undefined);
    assert.equal(snapshot.treeShaOf({ tree: [] }), undefined);
    assert.equal(snapshot.commitShaOf(null), undefined);
    assert.equal(snapshot.commitShaOf("nope"), undefined);
  });

  it("accepts a tree response with no sha as a gap in evidence, not a contradiction", () => {
    const out = snapshot.checkSnapshot({ commitSha: COMMIT, treeSha: undefined });
    assert.equal(out.ok, true);
    assert.equal(out.treeSha, undefined);
    assert.equal(out.commitSha, COMMIT);
  });

  it("writes both fields onto the scan row, not one field twice", async () => {
    const internal = await loadWithStubs("convex/scans/internal.ts");
    const db = makeDb();
    const scanId = await internal.createScan.handler(
      { db },
      {
        owner: "acme",
        repo: "widget",
        repoUrl: "https://github.com/acme/widget",
        signedIn: false,
        attributed: true,
        attributedCallerId: "k".repeat(32),
        channel: "mcp",
        surface: "mcp_hosted",
        now: 1,
      },
    );
    await internal.markShas.handler({ db }, { scanId, commitSha: COMMIT, treeSha: TREE, now: 2 });
    const row = db.get("scans", scanId);
    assert.equal(row.commitSha, COMMIT);
    assert.equal(row.treeSha, TREE);
    assert.equal(row.sha, COMMIT, "the legacy sha column stays the commit sha every reader expects");
    assert.notEqual(row.treeSha, row.commitSha);
  });

  it("keeps the tree sha on the cache too, so a cached scan records the same pair", async () => {
    const internal = await loadWithStubs("convex/scans/internal.ts");
    const db = makeDb();
    await internal.upsertTree.handler(
      { db },
      {
        owner: "acme",
        repo: "widget",
        sha: COMMIT,
        treeSha: TREE,
        fetchedAt: 1,
        fileCount: 1,
        truncated: false,
        treeTruncated: false,
        entries: [{ path: "a.ts", type: "blob" }],
      },
    );
    const cached = await internal.getTreeEntries.handler(
      { db },
      { owner: "acme", repo: "widget", sha: COMMIT },
    );
    assert.equal(cached.sha, COMMIT);
    assert.equal(cached.treeSha, TREE);
    assert.notEqual(cached.sha, cached.treeSha);
  });
});

describe("8. CORS lets a browser client send Authorization", () => {
  it("names Authorization in the allowed headers", () => {
    assert.ok(cred.MCP_ALLOWED_HEADERS.includes("Authorization"));
    assert.equal(cred.MCP_ALLOWED_HEADERS_VALUE, "Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Session-Id");
    const http = readRepo("convex/http.ts");
    assert.match(http, /"Access-Control-Allow-Headers": MCP_ALLOWED_HEADERS_VALUE/);
    assert.doesNotMatch(
      http,
      /"Access-Control-Allow-Headers": "Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id"/,
      "the old header list, which had no Authorization, must be gone",
    );
  });

  it("keeps Mcp-Session-Id allowed for clients but never as a credential", () => {
    assert.ok(cred.MCP_ALLOWED_HEADERS.includes("Mcp-Session-Id"));
    assert.equal(cred.bearerTokenFromHeader("Bearer ls_live_x"), "ls_live_x");
    assert.equal(cred.bearerTokenFromHeader("bearer ls_live_x"), "ls_live_x");
    // A session id presented as a bearer token is just a string that parses as
    // nothing, and a session header is never consulted.
    assert.equal(cred.bearerTokenFromHeader(""), null);
    assert.equal(cred.bearerTokenFromHeader(null), null);
    assert.equal(cred.bearerTokenFromHeader(undefined), null);
    assert.equal(cred.bearerTokenFromHeader("Basic abc"), null);
    assert.equal(cred.bearerTokenFromHeader("ls_live_abc"), null, "no scheme is not a bearer");
    assert.equal(cred.bearerTokenFromHeader("Bearer"), null);
    assert.equal(cred.bearerTokenFromHeader("Bearer a b"), null);
  });
});

describe("9. scans.surface and scans.channel are written on both paths", () => {
  it("maps each channel to its surface", () => {
    assert.deepEqual(attribution.attributionFor(attribution.ANONYMOUS, "web"), {
      channel: "web",
      surface: "web",
      attributed: false,
    });
    assert.equal(attribution.attributionFor(attribution.ANONYMOUS, "mcp").surface, "mcp_hosted");
    assert.equal(attribution.attributionFor(attribution.ANONYMOUS, "api").surface, "mcp_hosted");
    assert.equal(attribution.surfaceForChannel("web"), "web");
    assert.equal(attribution.surfaceForChannel("mcp"), "mcp_hosted");
  });

  it("writes both fields on a browser scan, with no credential", async () => {
    const internal = await loadWithStubs("convex/scans/internal.ts");
    const db = makeDb();
    const scanId = await internal.createScan.handler(
      { db },
      {
        owner: "acme",
        repo: "widget",
        repoUrl: "https://github.com/acme/widget",
        signedIn: false,
        attributed: false,
        channel: "web",
        surface: "web",
        now: 1,
      },
    );
    const row = db.get("scans", scanId);
    assert.equal(row.channel, "web");
    assert.equal(row.surface, "web");
    assert.equal(row.attributed, false);
    assert.equal(row.attributedCallerId, undefined);
  });

  it("writes both fields on the MCP path, with the caller", async () => {
    const internal = await loadWithStubs("convex/scans/internal.ts");
    const db = makeDb();
    const scanId = await internal.createScan.handler(
      { db },
      {
        owner: "acme",
        repo: "widget",
        repoUrl: "https://github.com/acme/widget",
        signedIn: false,
        attributed: true,
        attributedCallerId: "k".repeat(32),
        channel: "mcp",
        surface: "mcp_hosted",
        now: 1,
      },
    );
    const row = db.get("scans", scanId);
    assert.equal(row.channel, "mcp");
    assert.equal(row.surface, "mcp_hosted");
    assert.equal(row.attributed, true);
    assert.equal(row.attributedCallerId, "k".repeat(32));
  });

  it("writes both fields on a rescan too, so the funnel counts it", async () => {
    const store = await loadWithStubs("convex/scans/store.ts");
    const db = makeDb();
    const baseId = db.insert("scans", {
      owner: "acme",
      repo: "widget",
      repoUrl: "https://github.com/acme/widget",
      status: "completed",
      createdAt: 1,
      updatedAt: 1,
    });
    const newId = await store.createRescan.handler(
      { db },
      {
        owner: "acme",
        repo: "widget",
        repoUrl: "https://github.com/acme/widget",
        rescanOf: baseId,
        signedIn: false,
        attributed: false,
        channel: "web",
        surface: "web",
        now: 2,
      },
    );
    const row = db.get("scans", newId);
    assert.equal(row.channel, "web");
    assert.equal(row.surface, "web");
    assert.equal(row.attributed, false);
    assert.equal(row.rescanOf, baseId);
  });

  it("declares both fields on the scans table and both shas", () => {
    const schema = readRepo("convex/schema.ts");
    assert.match(
      schema,
      /surface: v\.optional\(v\.union\(v\.literal\("web"\), v\.literal\("mcp_hosted"\)\)\)/,
    );
    assert.match(
      schema,
      /channel: v\.optional\(v\.union\(v\.literal\("web"\), v\.literal\("mcp"\), v\.literal\("api"\)\)\)/,
    );
    assert.match(schema, /attributedCallerId: v\.optional\(v\.id\("credentials"\)\)/);
    assert.match(schema, /attributed: v\.optional\(v\.boolean\(\)\)/);
    assert.match(schema, /commitSha: v\.optional\(v\.string\(\)\)/);
    assert.match(schema, /treeSha: v\.optional\(v\.string\(\)\)/);
    // A credentials table with the two stored values and the revocation flag.
    assert.match(schema, /credentials: defineTable\(/);
    assert.match(schema, /publicId: v\.string\(\)/);
    assert.match(schema, /tokenHash: v\.string\(\)/);
    assert.match(schema, /revoked: v\.boolean\(\)/);
    assert.match(schema, /revokedAt: v\.optional\(v\.number\(\)\)/);
    assert.match(schema, /audience: v\.string\(\)/);
    // And no field anywhere that would hold the raw token.
    const credentialsBlock = schema.slice(
      schema.indexOf("credentials: defineTable("),
      schema.indexOf("connectedInstallations") === -1
        ? schema.length
        : schema.indexOf("connectedInstallations"),
    );
    assert.doesNotMatch(credentialsBlock, /\btoken: v\.string\(\)/, "no raw token column may exist");
  });

  it("offers issuance as a server step with no UI, and says so", () => {
    const store = readRepo("convex/identity/store.ts");
    assert.match(store, /internalMutation/);
    assert.match(store, /mintCredential/);
    // No public function mints a credential.
    const http = readRepo("convex/http.ts");
    assert.doesNotMatch(http, /mintCredential/, "no route may mint a credential");
    // And no route accepts one either, which keeps issuance a server step.
    assert.doesNotMatch(http, /publicMutation/);
  });

  it("compares secrets in constant time", () => {
    assert.equal(cred.constantTimeEquals("abc", "abc"), true);
    assert.equal(cred.constantTimeEquals("abc", "abd"), false);
    assert.equal(cred.constantTimeEquals("abc", "ab"), false);
    assert.equal(cred.constantTimeEquals("", ""), true);
    // The compare folds every character into one accumulator, so there is no early
    // return to time.
    const source = cred.constantTimeEquals.toString();
    assert.ok(!/\bfor\b[\s\S]{0,80}?\breturn\b/.test(source), "no early return inside the loop");
    assert.match(source, /diff \|=/);
    assert.equal(cred.tokenHashMatches("a".repeat(64), "a".repeat(64)), true);
    assert.equal(cred.tokenHashMatches("a".repeat(64), "b".repeat(64)), false);
    assert.equal(cred.tokenHashMatches("a".repeat(64), null), false);
    assert.equal(cred.tokenHashMatches("not-a-hash", "a".repeat(64)), false);
  });
});