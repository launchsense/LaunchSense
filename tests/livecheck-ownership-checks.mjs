import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Two defects on the scan a reader already holds an id for:
//
//   1. `checkLive` (convex/scans/livecheck.ts) is a public action that wrote a
//      live URL and a live-check row onto whichever scan id it was handed, with
//      no ownership check at all. A signed-in scan can hold private repo data,
//      so anyone who learned the id could point it at a site of their choosing
//      and leave rows on another person's report. The gate aiExplain already
//      runs is the same rule the four report queries run: resolve the viewer,
//      then `canReadScan(scan, viewer)` before anything is written.
//   2. `createRescan` (convex/scans/store.ts) minted a row without the parent's
//      `liveUrl` and `mainAction`, so a rescan of a scan that had a live target
//      quietly lost it. The action already holds the parent row it validated, so
//      the two values are passed through rather than re-read.
//
// No network. The live fetch and GitHub are stubbed at their own module
// boundaries; `shared/ssrf.ts` and `shared/reports/scanAccess.ts` are the real
// modules, so the URL guard and the ownership rule run here rather than being
// read as text. Convex modules import `./_generated/*` and `convex/values`,
// which do not resolve outside the Convex runtime, so `loadWithStubs` copies a
// module into a temp directory with those pointed at stubs.

const repoRoot = new URL("../", import.meta.url);
const readRepo = (rel) => readFileSync(new URL(rel, repoRoot), "utf8");

const tmpRoot = join("/tmp/opencode", "w11-livecheck-tests");
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
const LIVE_API_STUB = `
export const internal = {
  scans: {
    store: { fetchScan: "fetchScan", setLiveInputs: "setLiveInputs", saveLiveCheck: "saveLiveCheck" },
  },
};
export const api = {};
export const components = {};
`;
const RESCAN_API_STUB = `
export const internal = {
  scans: {
    quota: { recordQuota: "recordQuota" },
    internal: {
      findCachedScan: "findCachedScan",
      getTreeEntries: "getTreeEntries",
      markFetching: "markFetching",
      markShas: "markShas",
      markCompleted: "markCompleted",
      markPartial: "markPartial",
      markFailed: "markFailed",
      upsertTree: "upsertTree",
    },
    store: {
      fetchScan: "fetchScan",
      createRescan: "createRescan",
      saveTransitions: "saveTransitions",
      listTransitions: "listTransitions",
      listFindings: "listFindings",
      listScanContents: "listScanContents",
    },
  },
};
export const api = {};
export const components = {};
`;

// The live fetch is the network boundary. It counts its calls, so "a refused
// press never reached the site" is measured rather than read from the source.
const LIVE_STUB = `
export const fetchLiveSite = async (url, mainAction) => {
  (globalThis.__W11_LIVE_CALLS__ = globalThis.__W11_LIVE_CALLS__ ?? []).push({ url, mainAction });
  return {
    finalUrl: url,
    https: true,
    reaches: true,
    httpStatus: 200,
    nonBlank: true,
    mainActionFound: mainAction.length > 0,
    viewportMeta: true,
    hops: 1,
    error: null,
  };
};
`;

// The real getAuthUserId reads the subject off the identity and keeps the part
// before the claim divider. This does the same thing, so a test can choose a
// viewer by giving the fake ctx an identity, and a caller with no identity is a
// null viewer rather than a throw.
const AUTH_STUB = `
export const getAuthUserId = async (ctx) => {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) return null;
  return identity.subject.split("|")[0];
};
`;
const READ_TOKEN_STUB = `
export const readSessionToken = async () => null;
`;

// The GitHub stub answers from a table and records every URL it was asked for.
const GITHUB_STUB = `
export const MAX_STORED_ENTRIES = 5000;
export const asRecord = (value) => (typeof value === "object" && value !== null ? value : null);
export const isRateLimitStatus = () => false;
export const normalizeTreeEntries = (data) => {
  const list = Array.isArray(data?.tree) ? data.tree : [];
  const entries = list
    .filter((entry) => typeof entry?.path === "string" && entry?.type === "blob")
    .map((entry) => ({ path: entry.path, type: "blob" }));
  return { entries, truncated: data?.truncated === true };
};
export const fetchGitHubJson = async (url) => {
  (globalThis.__W11_REQUESTED__ = globalThis.__W11_REQUESTED__ ?? []).push(url);
  const answer = globalThis.__W11_GITHUB__?.[url];
  if (answer === undefined) return { status: 404, data: null, rate: { remaining: null, limit: null, resetAtMs: null }, etag: null };
  return { ...answer, rate: { remaining: 4000, limit: 5000, resetAtMs: null }, etag: null };
};
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

async function loadWithStubs(relPath, extras = {}, apiStub = LIVE_API_STUB) {
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

// A real in-memory table. Every query, index range and page the code performs
// runs against this, so a test sees the row the code actually wrote.
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

/** The live lane, loaded with the two module boundaries it reaches out through. */
async function loadLive() {
  return loadWithStubs("convex/scans/livecheck.ts", {
    "../adapters/live": LIVE_STUB,
    "@convex-dev/auth/server": AUTH_STUB,
  });
}

/**
 * A fake action ctx for checkLive: one scan row, one viewer, and a record of
 * every query and mutation the lane made. Only the calls the lane makes are
 * implemented, so a test cannot pass against a mutation the lane never reaches.
 */
function makeLiveCtx({ scan, viewer = null }) {
  const queries = [];
  const mutations = [];
  const ctx = {
    auth: {
      async getUserIdentity() {
        return viewer === null ? null : { subject: viewer };
      },
    },
    async runQuery(ref) {
      queries.push(ref);
      if (ref === "fetchScan") return scan;
      throw new Error(`unexpected query ${ref}`);
    },
    async runMutation(ref, args) {
      mutations.push({ ref, args });
      if (ref === "setLiveInputs" || ref === "saveLiveCheck") return null;
      throw new Error(`unexpected mutation ${ref}`);
    },
  };
  return { ctx, queries, mutations };
}

/** Resets the live-call log and reads back every fetch the lane made. */
function liveCalls() {
  return globalThis.__W11_LIVE_CALLS__ ?? [];
}

function useLive() {
  globalThis.__W11_LIVE_CALLS__ = [];
  return liveCalls;
}

const LIVE_ARGS = { scanId: "scan-1", url: "https://example.com/app", mainAction: "Start a scan" };

/** The message a press produced, or null when it did not refuse at all. */
async function refusalMessage(run) {
  try {
    await run();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("checkLive enforces the ownership rule the report queries enforce", () => {
  it("refuses a signed-in scan owned by another account, and writes nothing", async () => {
    const mod = await loadLive();
    useLive();
    // The scan belongs to user-a. The caller is user-b, who cannot read it: the
    // same refusal the public report query hands back.
    const { ctx, mutations } = makeLiveCtx({
      scan: { signedIn: true, userId: "user-a", status: "completed" },
      viewer: "user-b",
    });

    const message = await refusalMessage(() => mod.checkLive.handler(ctx, LIVE_ARGS));

    assert.match(
      message ?? "",
      /not available to your account/i,
      "another account's scan must be refused, not checked",
    );
    assert.deepEqual(
      mutations.map((m) => m.ref),
      [],
      "a refused press must not call setLiveInputs or saveLiveCheck",
    );
    assert.equal(liveCalls().length, 0, "a refused press must not fetch the site either");
  });

  it("still allows the owner's signed-in scan", async () => {
    const mod = await loadLive();
    useLive();
    const { ctx, mutations } = makeLiveCtx({
      scan: { signedIn: true, userId: "user-a", status: "completed" },
      viewer: "user-a",
    });

    const result = await mod.checkLive.handler(ctx, LIVE_ARGS);

    assert.equal(result.scanId, "scan-1");
    assert.deepEqual(
      mutations.map((m) => m.ref),
      ["setLiveInputs", "saveLiveCheck"],
      "the owner still gets a live target written and a live-check row",
    );
    assert.equal(mutations[0]?.args.liveUrl, "https://example.com/app");
    assert.equal(liveCalls().length, 1);
  });

  it("still allows a guest scan by id, which is what canReadScan defines", async () => {
    const mod = await loadLive();
    useLive();
    // A guest scan of a public repo has no owner and stays id-addressed, so the
    // share and guest flows keep working.
    const { ctx, mutations } = makeLiveCtx({
      scan: { signedIn: false, status: "completed" },
      viewer: null,
    });

    const result = await mod.checkLive.handler(ctx, LIVE_ARGS);

    assert.equal(result.scanId, "scan-1");
    assert.deepEqual(
      mutations.map((m) => m.ref),
      ["setLiveInputs", "saveLiveCheck"],
    );
  });

  it("says the same thing whether the scan exists or not", async () => {
    const mod = await loadLive();
    useLive();
    const missing = await refusalMessage(() =>
      mod.checkLive.handler(makeLiveCtx({ scan: null, viewer: "user-b" }).ctx, LIVE_ARGS),
    );
    const foreign = await refusalMessage(() =>
      mod.checkLive.handler(
        makeLiveCtx({ scan: { signedIn: true, userId: "user-a" }, viewer: "user-b" }).ctx,
        LIVE_ARGS,
      ),
    );

    assert.ok(missing !== null, "a scan id that names nothing must be refused");
    assert.ok(foreign !== null, "a scan id the caller does not own must be refused");
    assert.equal(
      missing,
      foreign,
      "two different answers would let a caller holding an id learn which ids exist",
    );
    assert.doesNotMatch(foreign, /user-a/, "the refusal must not quote the owner it is hiding");
  });
});

describe("a rescan carries the live target forward", () => {
  const rescanArgs = {
    owner: "acme",
    repo: "widget",
    repoUrl: "https://github.com/acme/widget",
    rescanOf: "scan-parent",
    signedIn: false,
    attributed: false,
    channel: "web",
    surface: "web",
    now: 2,
  };

  const parentRow = (over = {}) => ({
    _id: "scan-parent",
    owner: "acme",
    repo: "widget",
    repoUrl: "https://github.com/acme/widget",
    status: "completed",
    signedIn: true,
    userId: "user-a",
    createdAt: 1,
    updatedAt: 1,
    ...over,
  });

  it("carries liveUrl and mainAction from a parent that had them", async () => {
    const store = await loadWithStubs("convex/scans/store.ts");
    const db = makeDb({
      scans: [
        parentRow({ liveUrl: "https://example.com/app", mainAction: "Start a scan" }),
      ],
    });

    const newId = await store.createRescan.handler(
      { db },
      {
        ...rescanArgs,
        liveUrl: "https://example.com/app",
        mainAction: "Start a scan",
      },
    );

    const row = db.get("scans", newId);
    assert.equal(row.liveUrl, "https://example.com/app", "the child's live target was dropped");
    assert.equal(row.mainAction, "Start a scan", "the child's main action was dropped");
    assert.equal(row.rescanOf, "scan-parent");
  });

  it("leaves both absent when the parent had neither", async () => {
    const store = await loadWithStubs("convex/scans/store.ts");
    // The carriers are declared, so a child with no live target is a deliberate
    // no-carry and not an accident of a field nobody declared. Before the fix
    // there was no such declaration, which is the whole gap.
    assert.ok("liveUrl" in store.createRescan.args, "createRescan declares no liveUrl carrier");
    assert.ok("mainAction" in store.createRescan.args, "createRescan declares no mainAction carrier");

    const db = makeDb({ scans: [parentRow()] });
    const newId = await store.createRescan.handler({ db }, rescanArgs);

    const row = db.get("scans", newId);
    assert.equal(row.liveUrl, undefined, "a parent with no live target must not gain one");
    assert.equal(row.mainAction, undefined, "and no main action either");
  });

  it("the rescan action forwards the parent's live target onto the row it mints", async () => {
    // End to end through the real action and the real mutation over a fake db, so
    // this covers the wiring and not just the optional arguments.
    const rescanMod = await loadWithStubs(
      "convex/scans/rescan.ts",
      {
        "../adapters/github": GITHUB_STUB,
        "../github/readToken": READ_TOKEN_STUB,
        "@convex-dev/auth/server": AUTH_STUB,
      },
      RESCAN_API_STUB,
    );
    const storeMod = await loadWithStubs("convex/scans/store.ts", {}, RESCAN_API_STUB);
    const internalMod = await loadWithStubs("convex/scans/internal.ts", {}, RESCAN_API_STUB);
    const handlers = { ...internalMod, ...storeMod };

    const OLD_SHA = "a".repeat(40);
    const NEW_SHA = "d".repeat(40);
    const TREE_SHA = "b".repeat(40);
    globalThis.__W11_GITHUB__ = {
      "https://api.github.com/repos/acme/widget": {
        status: 200,
        data: { default_branch: "main" },
      },
      [`https://api.github.com/repos/acme/widget/commits/${encodeURIComponent("main")}`]: {
        status: 200,
        data: { sha: NEW_SHA, commit: { tree: { sha: TREE_SHA } } },
      },
      [`https://api.github.com/repos/acme/widget/git/trees/${NEW_SHA}?recursive=1`]: {
        status: 200,
        data: { sha: TREE_SHA, tree: [{ path: "src/app.ts", type: "blob" }] },
      },
    };
    globalThis.__W11_REQUESTED__ = [];

    const db = makeDb({
      scans: [
        parentRow({
          sha: OLD_SHA,
          analyzedAt: 1,
          liveUrl: "https://example.com/app",
          mainAction: "Start a scan",
        }),
      ],
    });
    const ctx = {
      auth: { async getUserIdentity() { return null; } },
      async runQuery(ref, args) {
        const fn = handlers[String(ref)];
        if (fn === undefined) throw new Error(`the harness has no query named ${String(ref)}`);
        return fn.handler({ db }, args);
      },
      async runMutation(ref, args) {
        const fn = handlers[String(ref)];
        if (fn === undefined) throw new Error(`the harness has no mutation named ${String(ref)}`);
        return fn.handler({ db }, args);
      },
    };

    const result = await rescanMod.rescanScan.handler(ctx, { scanId: "scan-parent" });

    assert.equal(result.scanId !== "scan-parent", true, "a new commit must mint a new scan");
    const child = db.get("scans", result.scanId);
    assert.equal(child.liveUrl, "https://example.com/app", "the rescan lost the live target");
    assert.equal(child.mainAction, "Start a scan", "the rescan lost the main action");
    assert.equal(child.rescanOf, "scan-parent");
  });
});