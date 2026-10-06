import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
// Namespace imports on purpose. A named import of an export that does not exist
// yet is a module load error, which fails the whole file at once and hides which
// rule broke. Namespace access fails one test at a time.
import * as vocabulary from "../shared/consent/vocabulary.ts";
import * as record from "../shared/consent/record.ts";
import * as signInCopy from "../shared/copy/signIn.ts";

const CONSENT_PURPOSES = vocabulary.CONSENT_PURPOSES;
const purposeById = vocabulary.purposeById;
const DIAGNOSTICS_NOTICE_VERSION = vocabulary.DIAGNOSTICS_NOTICE_VERSION;
const SIGN_IN_NOTICE_VERSION = signInCopy.SIGN_IN_NOTICE_VERSION;
const buildConsentRecordTemplate = record.buildConsentRecordTemplate;

// Wave 10, the sign-in consent record lane.
//
// The gap this lane closes: the sign-in panel asks four separate purposes in four
// boxes and nothing wrote the answers down. The published record said
// `status: not_recorded` for three of the four, which was honest and also a gap.
//
// What has to hold afterwards:
//
//   1. the consentRecords table exists with the columns and the two named indexes
//   2. the mutation takes the caller from the session, never from the arguments,
//      and an unauthenticated call writes nothing
//   3. one (user, purpose, noticeVersion) is one row, so a repeat is an update
//   4. a refusal is a record too, not only a grant
//   5. the click cannot be recorded at the click, so the decision is persisted
//      and the mutation runs once the person is authenticated
//   6. no persisted decision means no record, and nothing is invented for a
//      person who signed in before this change
//   7. the vocabulary, the offline generator, and the documents say what the
//      code does, including that the offline file cannot read the database
//
// Convex modules import `./_generated/*` and `convex/values`, which do not resolve
// outside the Convex runtime, so `loadWithStubs` copies the module into a temp
// directory with those pointed at stubs. The real handlers then run here against a
// fake ctx instead of being read as text.

const repoRoot = new URL("../", import.meta.url);
const readRepo = (rel) => readFileSync(new URL(rel, repoRoot), "utf8");
const hasRepo = (rel) => existsSync(new URL(rel, repoRoot));

const tmpRoot = join("/tmp/opencode", "wave10-consent-tests");
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
// The session is the only source of the caller. The stub reads it off ctx, so a
// test picks the signed-in person by building the ctx and nothing else.
const AUTH_STUB = `
export const getAuthUserId = async (ctx) => ctx.sessionUserId ?? null;
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
  writeFileSync(join(dir, "_generated", "api.js"), "export const api = {};\nexport const internal = {};\nexport const components = {};\n");
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

/** Load a module, or report that it is absent rather than throwing at file load. */
async function loadIfPresent(relPath, extras = {}) {
  if (!hasRepo(relPath)) return { module: null, reason: `${relPath} does not exist` };
  try {
    return { module: await loadWithStubs(relPath, extras), reason: null };
  } catch (error) {
    return { module: null, reason: `${relPath} could not be loaded: ${error.message}` };
  }
}

after(() => {
  for (const dir of madeDirs) rmSync(dir, { recursive: true, force: true });
});

// A real in-memory table, so a test sees the rows the handler actually wrote.
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
      if (row === undefined) throw new Error(`patch of a row that is not there: ${table} ${id}`);
      Object.assign(row, fields);
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

/** A ctx with a session, or a ctx with no session at all. */
function makeCtx(sessionUserId) {
  return { db: makeDb(), sessionUserId };
}

const ALL_PURPOSES = CONSENT_PURPOSES.map((purpose) => purpose.id);

/** A real click: every purpose granted, the version in force, a fixed time. */
const DECIDED_AT = Date.UTC(2026, 9, 6, 11, 0, 0);
const CLICK = {
  noticeVersion: SIGN_IN_NOTICE_VERSION,
  decidedAt: DECIDED_AT,
  decisions: ALL_PURPOSES.map((purposeId) => ({ purposeId, granted: true })),
};

const consentModule = await loadIfPresent("convex/consent.ts", {
  "@convex-dev/auth/server": AUTH_STUB,
});
const decisionModule = await loadIfPresent("src/features/auth/signInDecision.ts");

/** A Storage that is not a browser, so the payload builder is testable without OAuth. */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

describe("the consentRecords table", () => {
  const schema = readRepo("convex/schema.ts");

  /** One table's declaration, through to the next top-level table key. */
  const tableBlock = (name) => {
    const at = schema.indexOf(`  ${name}: defineTable({`);
    if (at < 0) return null;
    const rest = schema.slice(at);
    const next = rest.slice(1).search(/\n {2}[a-zA-Z][a-zA-Z0-9]*: defineTable\(\{/);
    return next === -1 ? rest : rest.slice(0, next + 1);
  };

  it("is declared with the seven columns and the two named indexes", () => {
    const block = tableBlock("consentRecords");
    assert.ok(block !== null, "convex/schema.ts must declare a consentRecords table");
    for (const field of [
      "userId: v.id(\"users\")",
      "purposeId:",
      "granted: v.boolean()",
      "noticeVersion: v.string()",
      "decidedAt: v.number()",
      "recordedAt: v.number()",
      "source: v.string()",
    ]) {
      assert.ok(block.includes(field), `consentRecords is missing ${field}`);
    }
    assert.match(block, /\.index\("by_user", \["userId"\]\)/);
    assert.match(block, /\.index\("by_user_purpose", \["userId", "purposeId"\]\)/);
  });

  it("holds only the four purposes the panel asks about, in one order", () => {
    const block = tableBlock("consentRecords");
    const ids = [...block.matchAll(/v\.literal\("([a-z]+)"\)/g)].map((m) => m[1]);
    assert.deepEqual(ids, ALL_PURPOSES, "the table must accept exactly the four purposes, in panel order");
    // The mutation carries its own copy of that list for its validator, so a fifth
    // purpose cannot be added to the vocabulary and quietly refused at runtime.
    const mutation = readRepo("convex/consent.ts");
    const mutated = [...mutation.matchAll(/v\.literal\("([a-z]+)"\)/g)].map((m) => m[1]);
    assert.deepEqual(mutated, ALL_PURPOSES, "convex/consent.ts must accept the same four purposes");
  });
});

describe("the mutation takes the caller from the session", () => {
  it("writes the row under the signed-in person, not under anything in the arguments", async () => {
    assert.ok(consentModule.module, consentModule.reason);
    const ctx = makeCtx("user-1");
    // A userId in the arguments is the exact attack this closes. The handler never
    // reads it, so a forged one cannot move a record onto somebody else's account.
    await consentModule.module.recordSignInDecisions.handler(ctx, { ...CLICK, userId: "user-victim" });
    const rows = ctx.db.rows("consentRecords");
    assert.equal(rows.length, 4);
    assert.equal(
      rows.every((row) => row.userId === "user-1"),
      true,
      "every row belongs to the session, not to the arguments",
    );
    assert.equal(rows.some((row) => row.userId === "user-victim"), false);
  });

  it("refuses an unauthenticated call and writes nothing", async () => {
    assert.ok(consentModule.module, consentModule.reason);
    const ctx = makeCtx(null);
    await assert.rejects(
      () => consentModule.module.recordSignInDecisions.handler(ctx, CLICK),
      /sign in/i,
      "an unauthenticated caller must be refused",
    );
    assert.equal(ctx.db.rows("consentRecords").length, 0, "a refused call writes no row");
  });

  it("keeps two people apart", async () => {
    assert.ok(consentModule.module, consentModule.reason);
    const one = makeCtx("user-1");
    const two = makeCtx("user-2");
    await consentModule.module.recordSignInDecisions.handler(one, CLICK);
    await consentModule.module.recordSignInDecisions.handler(two, CLICK);
    assert.equal(one.db.rows("consentRecords").length, 4);
    assert.equal(two.db.rows("consentRecords").length, 4);
    assert.equal(one.db.rows("consentRecords").filter((row) => row.userId === "user-2").length, 0);
  });
});

describe("one person, one purpose, one notice version is one row", () => {
  it("updates the same decision instead of writing a second row", async () => {
    assert.ok(consentModule.module, consentModule.reason);
    const ctx = makeCtx("user-1");
    const first = await consentModule.module.recordSignInDecisions.handler(ctx, CLICK);
    const second = await consentModule.module.recordSignInDecisions.handler(ctx, {
      ...CLICK,
      decidedAt: DECIDED_AT + 60_000,
    });
    assert.deepEqual(first, second, "the same key returns the same row id");
    const rows = ctx.db.rows("consentRecords");
    assert.equal(rows.length, 4, "four purposes, twice answered, is four rows and not eight");
    for (const id of rows) assert.equal(id.decidedAt, DECIDED_AT + 60_000, "the later answer is the row");
  });

  it("adds a row per notice version, so a wording change re-asks", async () => {
    assert.ok(consentModule.module, consentModule.reason);
    const ctx = makeCtx("user-1");
    await consentModule.module.recordSignInDecisions.handler(ctx, CLICK);
    await consentModule.module.recordSignInDecisions.handler(ctx, {
      ...CLICK,
      noticeVersion: "2026-01-01",
    });
    const rows = ctx.db.rows("consentRecords").filter((row) => row.purposeId === "token");
    assert.equal(rows.length, 2, "an old decision is kept beside the new one, not overwritten");
    assert.deepEqual(
      rows.map((row) => row.noticeVersion).sort(),
      ["2026-01-01", SIGN_IN_NOTICE_VERSION].sort(),
    );
  });

  it("records a refusal as well as a grant", async () => {
    assert.ok(consentModule.module, consentModule.reason);
    const ctx = makeCtx("user-1");
    await consentModule.module.recordSignInDecisions.handler(ctx, {
      noticeVersion: SIGN_IN_NOTICE_VERSION,
      decidedAt: DECIDED_AT,
      decisions: [
        { purposeId: "token", granted: true },
        { purposeId: "explain", granted: false },
      ],
    });
    const rows = ctx.db.rows("consentRecords");
    assert.equal(rows.length, 2);
    const refused = rows.find((row) => row.purposeId === "explain");
    assert.equal(refused.granted, false, "a refusal is evidence and is written down like a grant");
    assert.equal(refused.userId, "user-1");
  });

  it("writes the click time as decidedAt and the server time as recordedAt", async () => {
    assert.ok(consentModule.module, consentModule.reason);
    const before = Date.now();
    const ctx = makeCtx("user-1");
    await consentModule.module.recordSignInDecisions.handler(ctx, CLICK);
    const row = ctx.db.rows("consentRecords")[0];
    assert.equal(row.decidedAt, DECIDED_AT, "decidedAt is the click, which only the browser saw");
    assert.ok(row.recordedAt >= before, "recordedAt is the server's own clock, not the browser's");
    assert.equal(row.source, "sign-in panel", "the source is named by the server, not chosen by the client");
  });

  it("refuses a decision set that could not have come from the panel", async () => {
    assert.ok(consentModule.module, consentModule.reason);
    const cases = [
      [{ ...CLICK, decisions: [] }, /no purposes/i],
      [{ ...CLICK, noticeVersion: "" }, /notice version/i],
      [{ ...CLICK, decidedAt: Number.NaN }, /decided/i],
      [
        {
          ...CLICK,
          decisions: [
            { purposeId: "token", granted: true },
            { purposeId: "token", granted: false },
          ],
        },
        /twice/i,
      ],
      [{ ...CLICK, decisions: [{ purposeId: "wallet", granted: true }] }, /purpose/i],
    ];
    for (const [args, pattern] of cases) {
      const ctx = makeCtx("user-1");
      await assert.rejects(
        () => consentModule.module.recordSignInDecisions.handler(ctx, args),
        pattern,
        `the mutation accepted ${JSON.stringify(args)}`,
      );
      assert.equal(ctx.db.rows("consentRecords").length, 0, "a refused decision set writes nothing");
    }
  });
});

describe("the query returns only the caller's own records", () => {
  it("returns the caller's rows and nobody else's", async () => {
    assert.ok(consentModule.module, consentModule.reason);
    const one = makeCtx("user-1");
    const two = makeCtx("user-2");
    await consentModule.module.recordSignInDecisions.handler(one, CLICK);
    await consentModule.module.recordSignInDecisions.handler(two, {
      ...CLICK,
      decisions: [{ purposeId: "usage", granted: false }],
    });
    const mine = await consentModule.module.myConsentRecords.handler(one);
    assert.equal(mine.length, 4);
    assert.deepEqual([...new Set(mine.map((row) => row.userId))], ["user-1"]);
    const theirs = await consentModule.module.myConsentRecords.handler(two);
    assert.equal(theirs.length, 1);
    assert.equal(theirs[0].purposeId, "usage");
    assert.equal(theirs[0].granted, false, "a refusal is part of the export too");
  });

  it("returns null rather than an empty list when nobody is signed in", async () => {
    assert.ok(consentModule.module, consentModule.reason);
    const anon = makeCtx(null);
    const answer = await consentModule.module.myConsentRecords.handler(anon);
    assert.equal(
      answer,
      null,
      "signed out and signed in with no records are different facts and must not read the same",
    );
  });
});

describe("the client persists the decision and records it once", () => {
  it("writes the four purposes, the notice version, and the click time", () => {
    assert.ok(decisionModule.module, decisionModule.reason);
    const storage = fakeStorage();
    const decision = decisionModule.module.buildSignInDecision({
      noticeVersion: SIGN_IN_NOTICE_VERSION,
      decidedAt: DECIDED_AT,
      purposeIds: ALL_PURPOSES,
    });
    decisionModule.module.saveSignInDecision(storage, decision);
    const stored = decisionModule.module.readSignInDecision(storage);
    assert.equal(stored.noticeVersion, SIGN_IN_NOTICE_VERSION);
    assert.equal(stored.decidedAt, DECIDED_AT, "the click time is kept, not the time the row was written");
    assert.deepEqual(
      stored.decisions.map((item) => item.purposeId),
      ALL_PURPOSES,
    );
    assert.equal(stored.decisions.every((item) => item.granted === true), true);
  });

  it("builds the mutation payload and clears the stored decision only after the call resolves", async () => {
    assert.ok(decisionModule.module, decisionModule.reason);
    const storage = fakeStorage();
    const decision = decisionModule.module.buildSignInDecision({
      noticeVersion: SIGN_IN_NOTICE_VERSION,
      decidedAt: DECIDED_AT,
      purposeIds: ALL_PURPOSES,
    });
    decisionModule.module.saveSignInDecision(storage, decision);

    let seen = null;
    let stillStoredDuringTheCall = null;
    const record = async (args) => {
      seen = args;
      stillStoredDuringTheCall = decisionModule.module.readSignInDecision(storage);
      return ["row-1"];
    };
    const result = await decisionModule.module.recordPendingDecision(storage, record);
    assert.equal(result, "recorded");
    assert.ok(seen !== null, "the mutation was called");
    assert.deepEqual(seen.decisions.map((item) => item.purposeId), ALL_PURPOSES);
    assert.equal(seen.decidedAt, DECIDED_AT);
    assert.equal(seen.noticeVersion, SIGN_IN_NOTICE_VERSION);
    assert.notEqual(
      stillStoredDuringTheCall,
      null,
      "the decision is cleared after the call resolves, never before it starts",
    );
    assert.equal(
      decisionModule.module.readSignInDecision(storage),
      null,
      "the stored decision is gone once the row is written",
    );
  });

  it("records nothing when there is no persisted decision", async () => {
    assert.ok(decisionModule.module, decisionModule.reason);
    const storage = fakeStorage();
    let called = 0;
    const record = async () => {
      called += 1;
      return [];
    };
    const result = await decisionModule.module.recordPendingDecision(storage, record);
    assert.equal(result, "no decision");
    assert.equal(called, 0, "a person who signed in before this change gets no invented record");
  });

  it("refuses a stored value it cannot read instead of recording a guess", async () => {
    assert.ok(decisionModule.module, decisionModule.reason);
    const key = decisionModule.module.PENDING_SIGN_IN_KEY;
    const broken = [
      ["{not json", "broken JSON"],
      [JSON.stringify({ noticeVersion: SIGN_IN_NOTICE_VERSION, decidedAt: DECIDED_AT, decisions: [] }), "no purposes"],
      [JSON.stringify({ noticeVersion: "", decidedAt: DECIDED_AT, decisions: [] }), "no version"],
      [
        JSON.stringify({ noticeVersion: SIGN_IN_NOTICE_VERSION, decidedAt: "yesterday", decisions: [] }),
        "a time that is not a number",
      ],
      [
        JSON.stringify({
          noticeVersion: SIGN_IN_NOTICE_VERSION,
          decidedAt: DECIDED_AT,
          decisions: [{ purposeId: "wallet", granted: true }],
        }),
        "a purpose this product does not ask about",
      ],
      [
        JSON.stringify({
          noticeVersion: SIGN_IN_NOTICE_VERSION,
          decidedAt: DECIDED_AT,
          decisions: [{ purposeId: "token", granted: "yes" }],
        }),
        "an answer that is not a boolean",
      ],
    ];
    for (const [raw, why] of broken) {
      const storage = fakeStorage({ [key]: raw });
      assert.equal(decisionModule.module.readSignInDecision(storage), null, `read must refuse ${why}`);
      let called = 0;
      const result = await decisionModule.module.recordPendingDecision(storage, async () => {
        called += 1;
        return [];
      });
      assert.equal(result, "no decision");
      assert.equal(called, 0, `nothing may be recorded for ${why}`);
    }
  });

  it("wires the panel to persist on the click and the recorder to run after sign-in", () => {
    assert.ok(hasRepo("src/features/auth/ConsentRecorder.tsx"), "a recorder component must exist");
    const panel = readRepo("src/features/auth/AuthPanel.tsx");
    const recorder = readRepo("src/features/auth/ConsentRecorder.tsx");
    const siteFrame = readRepo("src/features/site/SiteFrame.tsx");
    // The panel cannot record at the click: the person is anonymous until the
    // OAuth callback, so the click only persists.
    assert.match(panel, /saveSignInDecision\(/, "the click must persist the decision");
    assert.match(panel, /SIGN_IN_NOTICE_VERSION/, "the persisted version is the sign-in notice version");
    assert.ok(
      panel.indexOf("saveSignInDecision(") < panel.indexOf("signIn(\"github\")"),
      "the decision is persisted before the OAuth redirect starts",
    );
    // The recorder is the only thing that calls the mutation, it waits for the
    // session, and it is mounted on every page.
    assert.match(recorder, /myConsentRecords|recordSignInDecisions/, "the recorder uses the real functions");
    assert.match(recorder, /isAuthenticated/, "nothing is recorded while signed out");
    assert.match(siteFrame, /<ConsentRecorder\s*\/>/, "the recorder must be mounted where OAuth returns");
  });
});

describe("the vocabulary says what the code does", () => {
  it("records every purpose and names where each decision lands", () => {
    for (const purpose of CONSENT_PURPOSES) {
      assert.equal(
        purpose.recorded,
        true,
        `${purpose.id} is written to the database now, so recorded must not say otherwise`,
      );
      assert.equal(purpose.not_recorded_reason, null, `${purpose.id} has a record, so no gap is named`);
      assert.notEqual(purpose.ledger, null, `${purpose.id} must name where its decision lands`);
    }
    for (const id of ["token", "read", "explain"]) {
      assert.equal(
        purposeById(id).recorded_in,
        "convex_database",
        `${id} is recorded in the database for a signed-in person`,
      );
      assert.match(
        purposeById(id).ledger,
        /consentRecords/,
        `${id} must name the table its record is in`,
      );
    }
    assert.equal(purposeById("usage").recorded_in, "local_ledger");
  });

  it("gives the sign-in purposes the sign-in notice version, not the installer's", () => {
    // Dated, with an optional same-day suffix: wording can iterate twice in
    // one day (four boxes to one box), and the records must still tell the
    // wordings apart.
    assert.match(
      SIGN_IN_NOTICE_VERSION,
      /^\d{4}-\d{2}-\d{2}(-[a-z0-9-]+)?$/,
      "the notice version is a dated string",
    );
    assert.notEqual(
      SIGN_IN_NOTICE_VERSION,
      DIAGNOSTICS_NOTICE_VERSION,
      "the two notices are different wording, so they cannot share one version",
    );
    for (const id of ["token", "read", "explain"]) {
      assert.equal(
        purposeById(id).notice_version,
        SIGN_IN_NOTICE_VERSION,
        `${id} is governed by the sign-in wording, not by the installer question`,
      );
    }
    assert.equal(purposeById("usage").notice_version, DIAGNOSTICS_NOTICE_VERSION);
  });

  it("leaves the wording hash only where this build carries the wording", () => {
    // The four sign-in boxes live in a .tsx component, so the generator cannot
    // hash their text. It must leave the hash empty and say so rather than hash
    // the installer's wording under the sign-in version.
    for (const id of ["token", "read", "explain"]) {
      assert.equal(purposeById(id).notice_wording_in_this_build, null, `${id} carries no wording here`);
    }
    assert.notEqual(purposeById("usage").notice_wording_in_this_build, null);
  });

  it("publishes the sign-in shapes as recorded in the database, with the gaps named", async () => {
    // The offline file cannot read the database, so its own record for token is a
    // shape and not a decision. It must say where the decision is and how to read
    // it, rather than claim not_recorded or carry an id it did not derive.
    const record = await buildConsentRecordTemplate("explain");
    assert.equal(record.status, "recorded_in_database");
    assert.equal(record.privacy_notice.version, SIGN_IN_NOTICE_VERSION);
    assert.equal(
      record.privacy_notice.wording_sha256,
      null,
      "hashing the installer's wording under the sign-in version would be a false record",
    );
    assert.equal(record.record_id, null, "no id is minted from a decision this file does not have");
    assert.equal(record.event.time, null);
    const gaps = record.not_filled;
    const named = gaps.map((gap) => gap.why).join(" ");
    assert.match(named, /consentRecords/, "the gap must name the table the decision is in");
    assert.match(named, /myConsentRecords/, "the gap must name the export path");
    assert.ok(gaps.some((gap) => gap.field === "record_id"));
    assert.ok(gaps.some((gap) => gap.field === "event.time"));
    assert.equal(
      new Set(gaps.map((gap) => gap.field)).size,
      gaps.length,
      "a field cannot be listed as missing twice, and a reader cannot tell which line to believe",
    );
  });
});

describe("the documents do not claim the offline file covers the sign-in records", () => {
  const consentDoc = readRepo("docs/CONSENT-RECORD.md");
  const llms = readRepo("llms.txt");
  const changelog = readRepo("CHANGELOG.md");
  const privacyDoc = readRepo("docs/PRIVACY.md");
  const privacyPage = readRepo("src/pages/Privacy.tsx");
  const flat = (text) => text.replace(/\s+/g, " ");

  it("says the three sign-in purposes are recorded in the database, with the query as the export path", () => {
    const text = flat(consentDoc);
    assert.match(text, /consentRecords/, "the record doc must name the table");
    assert.match(text, /myConsentRecords/, "the export path is the caller's own query");
    assert.match(
      text,
      /cannot read (the )?(Convex )?database|only reads the local ledger|covers the local ledger/i,
      "the doc must say the offline generator cannot read the database",
    );
    assert.doesNotMatch(
      text,
      /no `consentRecords` table/i,
      "the table exists now, so the old gap must be gone",
    );
    assert.doesNotMatch(
      text,
      /three of the four sign-in purposes have \*\*no record anywhere\*\*/i,
      "the old gap statement would now be false",
    );
  });

  it("keeps the agent file honest about where each record lives", () => {
    const text = flat(llms);
    assert.match(text, /consentRecords/, "llms.txt must name the table");
    assert.match(text, /myConsentRecords/, "llms.txt must name the export path");
    assert.doesNotMatch(
      text,
      /the other three are asked in the panel and recorded nowhere/i,
      "that sentence is false once the panel writes the decision",
    );
  });

  it("says the same thing in the changelog", () => {
    const text = flat(changelog);
    assert.match(text, /consentRecords/, "the changelog entry must name the table");
    assert.doesNotMatch(
      text,
      /three of the four sign-in purposes have no decision on record anywhere/i,
      "the unreleased entry that says that is now false",
    );
  });

  it("states on both privacy copies that the sign-in decision is stored and nothing deletes it", () => {
    for (const [name, source] of [
      ["docs/PRIVACY.md", privacyDoc],
      ["/privacy", privacyPage],
    ]) {
      const text = flat(source);
      assert.match(text, /consentRecords/, `${name} must name the table the decision lands in`);
      assert.match(text, /Nothing in this repository deletes/i, `${name} must say what does not delete it`);
    }
  });
});