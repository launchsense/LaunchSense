import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";

// The Wave 6 analytics lane. Eight things it has to hold:
//
//   1. the two tables exist with the named indexes, and scans carries a surface
//   2. clientInfo is read and allowlisted, and a random name creates no dimension
//   3. one tools/call writes one event with the OTel attribute names
//   4. the OTel Opt-In attributes and the denylisted properties are refused
//   5. the north star counts cause=code_change between two completed scans
//   6. the guardrails compute from the right rows
//   7. staging rows are deleted after 30 days
//   8. no analytics row carries a repo name, a path, a title, or a snippet
//
// Convex modules import `./_generated/*` and `convex/values`, which do not
// resolve outside the Convex runtime, so `loadWithStubs` copies a module into a
// temp directory with those pointed at stubs. The real handlers then run here
// against a fake ctx instead of being read as text.

const repoRoot = new URL("../", import.meta.url);
const readRepo = (rel) => readFileSync(new URL(rel, repoRoot), "utf8");

const tmpRoot = join("/tmp/opencode", "a7-analytics-tests");
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
// The action reaches the mutation through the generated api map, so the stub names
// the mutation it targets. The test then runs that mutation for real.
const API_STUB = `
export const internal = { analytics: { retention: { purgeUsageEvents: "purgeUsageEvents" } } };
export const api = {};
export const components = {};
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
      const chain = {
        withIndex(_name, rangeFn) {
          if (typeof rangeFn === "function") {
            rangeFn({
              eq: (field, value) => {
                conditions.push([field, "eq", value]);
              },
              lt: (field, value) => {
                conditions.push([field, "lt", value]);
              },
              gte: (field, value) => {
                conditions.push([field, "gte", value]);
              },
            });
          }
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
        async paginate({ cursor, numItems }) {
          const rows = matches(all(table), conditions);
          const start = cursor === null || cursor === undefined ? 0 : Number(cursor);
          const page = rows.slice(start, start + numItems);
          const next = start + numItems;
          return {
            page,
            isDone: next >= rows.length,
            continueCursor: String(next),
          };
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

const makeCtx = (seed) => ({ db: makeDb(seed) });

// A fixed clock. Every day-boundary assertion reads from this, never Date.now(),
// so the suite cannot pass by running on a convenient date.
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 6, 3, 20, 0); // 2026-10-06 03:20 UTC
const YESTERDAY = "2026-10-05";
const DAY_START = Date.UTC(2026, 9, 5);
const DAY_END = DAY_START + DAY_MS;

const day = (offsetDays) => new Date(DAY_START + offsetDays * DAY_MS).toISOString().slice(0, 10);

function scan(over = {}) {
  return {
    _id: "scan-1",
    status: "completed",
    owner: "acme",
    repo: "widget",
    createdAt: DAY_START + 1000,
    analyzedAt: DAY_START + 5000,
    ...over,
  };
}

function transition(over = {}) {
  return {
    _id: "tr-1",
    fromScanId: "scan-1",
    toScanId: "scan-2",
    ruleId: "secret.tracked-env",
    state: "fixed",
    cause: "code_change",
    createdAt: DAY_START + 6000,
    ...over,
  };
}

/** The dailyMetrics row for a metric with a given dims, or undefined. */
function metric(ctx, metricName, dims) {
  const rows = ctx.db.rows("dailyMetrics");
  const want = JSON.stringify(dims);
  return rows.find((row) => row.metric === metricName && row.dims === want);
}

describe("analytics schema", () => {
  const schema = readRepo("convex/schema.ts");

  /** One table's full declaration, through the end of its index chain. */
  const tableBlock = (name) => {
    const at = schema.indexOf(`${name}: defineTable(`);
    assert.notEqual(at, -1, `${name} must exist in the schema`);
    const rest = schema.slice(at);
    // The block ends where the next top-level table key starts.
    const next = rest.slice(1).search(/\n {2}[a-zA-Z][a-zA-Z0-9]*: defineTable\(/);
    return next === -1 ? rest : rest.slice(0, next + 1);
  };

  it("declares usageEvents with the 15 fields and the two indexes", () => {
    const text = tableBlock("usageEvents");
    for (const field of [
      "day:",
      "kind:",
      "surface:",
      "clientName:",
      "clientVersion:",
      "protocolVersion:",
      "mcpMethodName:",
      "toolName:",
      "outcome:",
      "errorType:",
      "rpcResponseStatusCode:",
      "durationMs:",
      // Present by the design so a future reader can correlate an event to a
      // scan. No writer sets it today; that is stated, not hidden.
      "scanId:",
      "repoKey:",
      "createdAt:",
    ]) {
      assert.ok(text.includes(field), `usageEvents is missing ${field}`);
    }
    assert.match(text, /\.index\("by_day", \["day"\]\)/);
    assert.match(text, /\.index\("by_kind_day", \["kind", "day"\]\)/);
  });

  it("holds only the three MCP event kinds and the hosted surface", () => {
    const block = tableBlock("usageEvents");
    for (const kind of [
      "mcp_session_initialized",
      "mcp_tools_listed",
      "mcp_tool_called",
    ]) {
      assert.ok(block.includes(kind), `the kind union is missing ${kind}`);
    }
    assert.match(block, /surface: v\.literal\("mcp_hosted"\)/);
  });

  it("declares dailyMetrics with the two indexes, and no more", () => {
    const block = tableBlock("dailyMetrics");
    assert.match(block, /day: v\.string\(\)/);
    assert.match(block, /metric: v\.string\(\)/);
    assert.match(block, /dims: v\.string\(\)/);
    assert.match(block, /count: v\.number\(\)/);
    assert.match(block, /ratio: v\.optional\(v\.number\(\)\)/);
    assert.match(block, /\.index\("by_day", \["day"\]\)/);
    assert.match(block, /\.index\("by_metric_day", \["metric", "day"\]\)/);
    // An index with no reader is cost with no benefit, and the design says the
    // nightly fold pre-slices what it needs. No index on clientName or dims.
    assert.ok(!/index\("(?:by_clientName|by_dims|by_repoKey)"/.test(block));
  });

  it("adds one optional surface field to scans and no day column", () => {
    const block = tableBlock("scans");
    assert.match(
      block,
      /surface: v\.optional\(v\.union\(v\.literal\("web"\), v\.literal\("mcp_hosted"\)\)\)/,
    );
    assert.ok(!/\bday:\s*v\./.test(block), "scans keeps no day column of its own");
    // One field on an existing table. Nothing else about the funnel changed shape.
    assert.ok(!/\bclientName:/.test(block), "the client is a usage-event dimension, not a scan field");
    assert.ok(!/\brepoKey:/.test(block), "the hashed repo key is not written onto a scan row");
  });
});

describe("clientInfo capture and allowlist", () => {
  let mod;
  before(async () => {
    mod = await loadWithStubs("convex/mcpHttp.ts");
  });

  it("maps every known harness to its own dimension", () => {
    const cases = {
      cursor: "cursor",
      Cursor: "cursor",
      "claude-code": "claude_code",
      "Claude Code": "claude_code",
      "claude-desktop": "claude_desktop",
      "Claude Desktop": "claude_desktop",
      codex: "codex",
      "Codex CLI": "codex",
      vscode: "vscode",
      "Visual Studio Code": "vscode",
      windsurf: "windsurf",
      Windsurf: "windsurf",
    };
    for (const [raw, want] of Object.entries(cases)) {
      assert.equal(mod.allowlistedClientName(raw), want, raw);
    }
  });

  it("turns an unknown name into other, never into a new dimension", () => {
    for (const raw of [
      "crypto.randomUUID()",
      "a3f1c0de-1111-2222-3333-444455556666",
      "my-own-harness",
      "",
      "   ",
      null,
      undefined,
      42,
      { name: "cursor" },
      ["cursor"],
    ]) {
      const mapped = mod.allowlistedClientName(raw);
      assert.ok(
        mod.CLIENT_NAMES.includes(mapped),
        `${JSON.stringify(raw)} produced ${mapped}, which is not in the allowlist`,
      );
    }
    assert.equal(mod.allowlistedClientName("a3f1c0de-1111-2222-3333-444455556666"), "other");
    assert.equal(mod.allowlistedClientName(null), "unknown");
    assert.equal(mod.allowlistedClientName(""), "unknown");
  });

  it("has a closed allowlist of exactly the eight named values", () => {
    assert.deepEqual(
      [...mod.CLIENT_NAMES].sort(),
      [
        "claude_code",
        "claude_desktop",
        "codex",
        "cursor",
        "other",
        "unknown",
        "vscode",
        "windsurf",
      ],
    );
  });

  it("drops a client version that does not look like one", () => {
    assert.equal(mod.allowlistedClientVersion("1.2.3"), "1.2.3");
    assert.equal(mod.allowlistedClientVersion(" 0.4.0 "), "0.4.0");
    // A version field is not a place to put free text.
    assert.equal(mod.allowlistedClientVersion("1.0\nrm -rf /"), undefined);
    assert.equal(mod.allowlistedClientVersion("https://example.com/x"), undefined);
    assert.equal(mod.allowlistedClientVersion(""), undefined);
    assert.equal(mod.allowlistedClientVersion(7), undefined);
  });

  it("records initialize with the client name the caller declared", async () => {
    const events = [];
    const result = await mod.handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "claude-code", version: "2.0.1" },
        },
      },
      async () => ({ text: "unused", isError: false }),
      (event) => events.push(event),
    );
    assert.equal(result.status, 200);
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, "mcp_session_initialized");
    assert.equal(events[0].mcpMethodName, "initialize");
    assert.equal(events[0].clientName, "claude_code");
    assert.equal(events[0].clientVersion, "2.0.1");
    assert.equal(events[0].protocolVersion, "2025-11-25");
    assert.equal(events[0].outcome, "ok");
  });

  it("never stores the raw client name, only the mapped one", async () => {
    const events = [];
    await mod.handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", clientInfo: { name: "Some Private Harness", version: "9" } },
      },
      async () => ({ text: "unused", isError: false }),
      (event) => events.push(event),
    );
    const stored = JSON.stringify(events);
    assert.equal(events[0].clientName, "other");
    assert.ok(!stored.includes("Some Private Harness"), "the raw name must not be carried anywhere");
  });

  it("reports unknown when a stateless POST carries no handshake to read", async () => {
    const events = [];
    await mod.handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
      async () => ({ text: "unused", isError: false }),
      (event) => events.push(event),
    );
    assert.equal(events[0].clientName, "unknown");
  });

  it("reports nothing when no reporter is passed, and still answers", async () => {
    // The reporter is optional, so this module can be read and used as plain
    // protocol code with no database behind it. Passing none must still answer.
    assert.equal(typeof mod.handleMcpMessage, "function");
    assert.equal(mod.handleMcpMessage.length, 3, "the reporter is the third parameter, and it is optional");
    const result = await mod.handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      async () => ({ text: "unused", isError: false }),
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.result.tools.length, 2);
  });

  it("reports tools/list with what the caller repeated, and unknown when it repeated nothing", async () => {
    const withInfo = [];
    await mod.handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: { protocolVersion: "2025-06-18", clientInfo: { name: "windsurf", version: "1.3" } },
      },
      async () => ({ text: "unused", isError: false }),
      (event) => withInfo.push(event),
    );
    assert.equal(withInfo.length, 1);
    assert.equal(withInfo[0].kind, "mcp_tools_listed");
    assert.equal(withInfo[0].mcpMethodName, "tools/list");
    assert.equal(withInfo[0].clientName, "windsurf");
    // There is no toolName on a list, and the tool count is not stored either.
    assert.equal(withInfo[0].toolName, undefined);

    const without = [];
    await mod.handleMcpMessage(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      async () => ({ text: "unused", isError: false }),
      (event) => without.push(event),
    );
    assert.equal(without[0].clientName, "unknown");
  });

  it("awaits the reporter, so an httpAction cannot answer before the row is written", async () => {
    // Fire and forget would be silently lossy here: the action returns, the sandbox
    // tears down, and the row never lands. A metric that loses rows under load looks
    // exactly like a drop in traffic.
    let settled = false;
    const events = [];
    const result = await mod.handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
      async () => ({ text: "unused", isError: false }),
      async (event) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        events.push(event);
        settled = true;
      },
    );
    assert.equal(result.status, 200);
    assert.equal(settled, true, "the answer must not be produced before the write finished");
    assert.equal(events.length, 1);
    const http = readRepo("convex/http.ts");
    assert.ok(
      !/void storeMcpUsageEvent/.test(http),
      "the reporter must be awaited, not detached",
    );
  });

  it("does not report a notification, which is not a measurable action", async () => {
    const events = [];
    await mod.handleMcpMessage(
      { jsonrpc: "2.0", method: "notifications/initialized", params: { clientInfo: { name: "cursor" } } },
      async () => ({ text: "unused", isError: false }),
      (event) => events.push(event),
    );
    // A notification produces no result, so counting it would inflate the session
    // count with something the client did not ask for. The second call proves the
    // reporter is live, so an empty array here means "not reported" and not
    // "nothing was measured at all".
    await mod.handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", clientInfo: { name: "cursor" } },
      },
      async () => ({ text: "unused", isError: false }),
      (event) => events.push(event),
    );
    assert.equal(events.length, 1, "a notification reports nothing and the initialize after it reports once");
    assert.equal(events[0].mcpMethodName, "initialize");
  });

  it("reports a refused quota window as quota_denied, and answers the caller anyway", async () => {
    // Both halves matter. The lane is measured, and the caller still gets an answer:
    // an analytics failure must never be the reason a tool call gets no reply.
    const http = readRepo("convex/http.ts");
    const tool = http.slice(http.indexOf("async function scanPublicTool"));
    assert.match(tool, /outcome: "quota_denied"/);
    assert.match(tool, /isError: true/);
    assert.match(tool, /internal\.mcpLimit\.consumeMcpScan/);
  });
});

describe("one tools/call writes one event", () => {
  let mod;
  before(async () => {
    mod = await loadWithStubs("convex/mcpHttp.ts");
  });

  const call = async (params, answer) => {
    const events = [];
    const result = await mod.handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { protocolVersion: "2025-06-18", clientInfo: { name: "cursor", version: "1.7" }, ...params },
      },
      answer ?? (async () => ({ text: "Scan abc\nStatus: completed", isError: false })),
      (event) => events.push(event),
    );
    return { events, result };
  };

  it("writes one event with the OpenTelemetry attribute names", async () => {
    const { events } = await call({
      name: "launchsense_scan_public",
      arguments: { repoUrl: "https://github.com/acme/widget" },
    });
    assert.equal(events.length, 1, "one protocol action is one event");
    const event = events[0];
    // mcp.method.name, per the OTel MCP semconv, verbatim.
    assert.equal(event.mcpMethodName, "tools/call");
    // gen_ai.tool.name.
    assert.equal(event.toolName, "launchsense_scan_public");
    // mcp.protocol.version.
    assert.equal(event.protocolVersion, "2025-06-18");
    assert.equal(event.kind, "mcp_tool_called");
    assert.equal(event.clientName, "cursor");
    assert.equal(event.outcome, "ok");
    assert.equal(typeof event.durationMs, "number");
  });

  it("records a tool error as tool_error, not as a protocol error", async () => {
    const { events } = await call(
      { name: "launchsense_scan_public", arguments: { repoUrl: "https://github.com/acme/widget" } },
      async () => ({ text: "Scan could not start.", isError: true }),
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].outcome, "tool_error");
    // The spec says set error.type to tool_error when CallToolResult.isError.
    assert.equal(events[0].errorType, "tool_error");
  });

  it("records a refused quota window as its own outcome", async () => {
    const { events } = await call(
      { name: "launchsense_scan_public", arguments: { repoUrl: "https://github.com/acme/widget" } },
      async () => ({ text: "This route is paused.", isError: true, outcome: "quota_denied" }),
    );
    assert.equal(events[0].outcome, "quota_denied");
  });

  it("records an invalid tool call with the JSON-RPC status code, not the raw params", async () => {
    const events = [];
    const result = await mod.handleMcpMessage(
      { jsonrpc: "2.0", id: 8, method: "tools/call", params: { arguments: { repoUrl: "x" } } },
      async () => ({ text: "unused", isError: false }),
      (event) => events.push(event),
    );
    assert.equal(result.body.error.code, -32602);
    assert.equal(events.length, 1);
    assert.equal(events[0].outcome, "protocol_error");
    // rpc.response.status.code.
    assert.equal(events[0].rpcResponseStatusCode, -32602);
    assert.equal(events[0].errorType, "-32602");
    assert.ok(!JSON.stringify(events[0]).includes("repoUrl"));
  });

  it("records an unknown tool name without storing the name the caller sent", async () => {
    const events = [];
    await mod.handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: { name: "leak_my_own_string_here", arguments: {} },
      },
      async () => ({ text: "unused", isError: false }),
      (event) => events.push(event),
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].outcome, "protocol_error");
    assert.ok(
      !JSON.stringify(events[0]).includes("leak_my_own_string_here"),
      "a client-declared tool name is free text and must not become a stored dimension",
    );
  });

  it("never carries the tool arguments or the result, both of which are OTel Opt-In", async () => {
    const { events } = await call({
      name: "launchsense_scan_public",
      arguments: { repoUrl: "https://github.com/acme/private-thing" },
    });
    const stored = JSON.stringify(events);
    // The argument IS a repository URL. This is the whole reason the Opt-In is
    // refused rather than merely not required.
    assert.ok(!stored.includes("private-thing"), "the repo URL must not reach an event");
    assert.ok(!("arguments" in events[0]));
    assert.ok(!("result" in events[0]));
    assert.ok(!("gen_ai.tool.call.arguments" in events[0]));
    assert.ok(!("gen_ai.tool.call.result" in events[0]));
  });

  it("reports the day-scoped repo key the tool computed, and nothing else about the repo", async () => {
    const key = "a".repeat(64);
    const events = [];
    await mod.handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: {
          name: "launchsense_scan_public",
          arguments: { repoUrl: "https://github.com/acme/widget" },
        },
      },
      async () => ({ text: "Scan abc", isError: false, repoKey: key }),
      (event) => events.push(event),
    );
    assert.equal(events[0].repoKey, key);
    assert.ok(!JSON.stringify(events[0]).includes("acme"));
  });
});

describe("the privacy denylist refuses properties before a write", () => {
  let mod;
  before(async () => {
    mod = await loadWithStubs("convex/analytics/ingest.ts");
  });

  it("refuses the four OTel Opt-In attributes by name", () => {
    for (const key of [
      "gen_ai.tool.call.arguments",
      "gen_ai.tool.call.result",
      "gen_ai.prompt.variable.name",
      "gen_ai.prompt.variable.value",
      "mcp.resource.uri",
    ]) {
      assert.ok(
        mod.FORBIDDEN_PROPERTIES.includes(key),
        `${key} is marked Opt-In with a sensitive-data warning and must be refused`,
      );
      assert.deepEqual(mod.forbiddenPropertiesIn({ [key]: "https://github.com/acme/private" }), [key]);
    }
  });

  it("refuses the Opt-In families, not only the names defined today", async () => {
    // The list names leaves; the check must also refuse the family, so a future
    // or near-miss child (gen_ai.prompt.variable.foo, mcp.resource.uri.template)
    // cannot slip past the way a single-name list would allow.
    const privacy = await loadWithStubs("convex/analytics/privacy.ts");
    for (const key of [
      "gen_ai.prompt.variable.foo",
      "gen_ai.tool.call.arguments.extra",
      "mcp.resource.uri.template",
    ]) {
      assert.deepEqual(
        privacy.forbiddenPropertiesIn({ [key]: "x" }),
        [key],
        `${key} must be refused by prefix`,
      );
    }
    for (const prefix of ["gen_ai.tool.call.", "gen_ai.prompt.variable.", "mcp.resource.uri"]) {
      assert.ok(privacy.FORBIDDEN_PREFIXES.includes(prefix), `${prefix} must be a stated refused prefix`);
    }
  });

  it("refuses path, content, snippet and title on any bag", () => {
    for (const key of ["path", "content", "snippet", "title"]) {
      assert.deepEqual(mod.forbiddenPropertiesIn({ [key]: "src/a.ts" }), [key]);
    }
    // The check is on the property name, so a value that merely looks like a path
    // under a safe name is not what this refuses.
    assert.deepEqual(mod.forbiddenPropertiesIn({ ruleId: "secret.tracked-env", severity: "high" }), []);
  });

  it("refuses repo identity and raw error text", () => {
    // Written in the camelCase a caller would actually use. The check lower-cases
    // before comparing, so each of these must still be refused, and what comes
    // back is the normalised name rather than the spelling that was passed in.
    for (const key of ["owner", "repo", "repoUrl", "sha", "errorMessage", "clientAddress"]) {
      assert.deepEqual(mod.forbiddenPropertiesIn({ [key]: "x" }), [key.toLowerCase()], key);
    }
  });

  it("matches case-insensitively, so a camelCase spelling cannot slip past", () => {
    // Every entry in the list is lower case. If the check stopped lower-casing, or
    // a name were listed in camelCase, every one of these would pass silently.
    for (const listed of mod.FORBIDDEN_PROPERTIES) {
      assert.equal(listed, listed.toLowerCase(), `${listed} must be listed in lower case to ever match`);
    }
    assert.deepEqual(mod.forbiddenPropertiesIn({ RedactedSnippet: "x" }), ["redactedsnippet"]);
    assert.deepEqual(mod.forbiddenPropertiesIn({ FileContent: "x" }), ["filecontent"]);
  });

  it("hides a caller address from the table, a documented divergence from the OTel spec", () => {
    const raw = readRepo("convex/analytics/privacy.ts");
    assert.match(raw, /client\.address/);
    assert.ok(
      !mod.FORBIDDEN_PROPERTIES.includes("client.address"),
      "the dotted form is a comment reference, not a stored property name",
    );
    assert.ok(mod.FORBIDDEN_PROPERTIES.includes("clientaddress"));
    // No address header is read anywhere on the MCP route.
    assert.ok(!/x-forwarded-for/.test(readRepo("convex/http.ts")));
  });

  it("refuses a repoKey that is not a hash, so a literal cannot be stored", async () => {
    const ctx = makeCtx();
    for (const bad of ["acme/widget", "https://github.com/acme/widget", "widget", "A".repeat(64), "z".repeat(64)]) {
      const out = await mod.recordMcpUsageEvent.handler(ctx, {
        kind: "mcp_tool_called",
        clientName: "cursor",
        outcome: "ok",
        repoKey: bad,
        now: NOW,
      });
      assert.equal(out.stored, false, `${bad} must be refused`);
      assert.equal(out.reason, "repo_key_shape");
    }
    assert.equal(ctx.db.rows("usageEvents").length, 0, "no refused row may be written");
  });

  it("hashes a repo identity into a day-scoped key and stores nothing else", async () => {
    const salt = "test-salt-value-long-enough-to-pass";
    const key = await mod.repoKeyFor(salt, "2026-10-06", "acme", "widget");
    assert.match(key, /^[0-9a-f]{64}$/, "the stored form is a 64 character hex digest");
    // Same repo, same day, same salt: the same key, so a same-day join works.
    assert.equal(await mod.repoKeyFor(salt, "2026-10-06", "acme", "widget"), key);
    // A different day, a different repo, or a different salt each give a different
    // key, so nothing survives a day boundary and two repos cannot collide.
    assert.notEqual(await mod.repoKeyFor(salt, "2026-10-07", "acme", "widget"), key);
    assert.notEqual(await mod.repoKeyFor(salt, "2026-10-06", "acme", "gadget"), key);
    assert.notEqual(await mod.repoKeyFor("another-salt-long-enough", "2026-10-06", "acme", "widget"), key);
    // The digest is not the input in any reversible shape.
    assert.ok(!key.includes("acme"));
    assert.ok(!key.includes("widget"));
  });

  it("returns no key at all when the salt is unset, rather than a weak one", async () => {
    // Failing closed is the honest behaviour. A row with no repoKey says nothing
    // about the repo; a row hashed with an empty salt would be reversible by anyone.
    assert.equal(await mod.repoKeyFor(undefined, "2026-10-06", "acme", "widget"), null);
    assert.equal(await mod.repoKeyFor("", "2026-10-06", "acme", "widget"), null);
    assert.equal(await mod.repoKeyFor("short", "2026-10-06", "acme", "widget"), null);
  });

  it("stores a well-formed row and allowlists the name again on the way in", async () => {
    const ctx = makeCtx();
    const out = await mod.recordMcpUsageEvent.handler(ctx, {
      kind: "mcp_tool_called",
      clientName: "claude-code",
      clientVersion: "2.0.1",
      protocolVersion: "2025-06-18",
      mcpMethodName: "tools/call",
      toolName: "launchsense_get_report",
      outcome: "ok",
      errorType: undefined,
      rpcResponseStatusCode: undefined,
      durationMs: 12,
      repoKey: "b".repeat(64),
      now: NOW,
    });
    assert.equal(out.stored, true);
    const rows = ctx.db.rows("usageEvents");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].clientName, "claude_code", "the raw name must not be what lands");
    assert.equal(rows[0].day, "2026-10-06");
    assert.equal(rows[0].surface, "mcp_hosted");
    assert.equal(rows[0].createdAt, NOW);
  });

  it("refuses a client version that is not version-shaped", async () => {
    const ctx = makeCtx();
    const out = await mod.recordMcpUsageEvent.handler(ctx, {
      kind: "mcp_session_initialized",
      clientName: "cursor",
      clientVersion: "https://example.com/path",
      outcome: "ok",
      now: NOW,
    });
    assert.equal(out.stored, false);
    assert.equal(out.reason, "client_version_shape");
  });

  it("does not go through logEvent, whose cap makes volume counting impossible", async () => {
    // Comments are stripped first, so this checks executable code and not the note
    // in the file that explains why the capped path is avoided.
    const code = readRepo("convex/analytics/ingest.ts")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    assert.ok(!/logEvent/.test(code), "the capped share-event path must not carry MCP volume");
    assert.ok(!/rateLimits/.test(code), "an unmetered write must not touch the limiter table either");
    // The cap itself is untouched.
    const queries = readRepo("convex/scans/queries.ts");
    assert.match(queries, /const limit = args\.kind === "share_viewed" \? 100 : 50;/);
    assert.match(queries, /insert\("rateLimits", \{ key: limitKey, day, count: 1, updatedAt: now \}\)/);
  });
});

describe("the nightly rollup", () => {
  let mod;
  before(async () => {
    mod = await loadWithStubs("convex/analytics/rollup.ts");
  });

  it("is scheduled nightly and folds yesterday", () => {
    const crons = readRepo("convex/crons.ts");
    assert.match(crons, /crons\.daily\(/);
    assert.match(crons, /hourUTC: 3/);
    assert.match(crons, /internal\.analytics\.rollup\.rollupDaily/);
  });

  it("folds yesterday's MCP events by client, tool and outcome", async () => {
    const ctx = makeCtx({
      usageEvents: [
        {
          _id: "u1",
          day: YESTERDAY,
          kind: "mcp_tool_called",
          surface: "mcp_hosted",
          clientName: "cursor",
          protocolVersion: "2025-06-18",
          mcpMethodName: "tools/call",
          toolName: "launchsense_scan_public",
          outcome: "ok",
          createdAt: DAY_START + 100,
        },
        {
          _id: "u2",
          day: YESTERDAY,
          kind: "mcp_tool_called",
          surface: "mcp_hosted",
          clientName: "cursor",
          protocolVersion: "2025-06-18",
          mcpMethodName: "tools/call",
          toolName: "launchsense_scan_public",
          outcome: "ok",
          createdAt: DAY_START + 200,
        },
        {
          _id: "u3",
          day: YESTERDAY,
          kind: "mcp_tool_called",
          surface: "mcp_hosted",
          clientName: "codex",
          toolName: "launchsense_get_report",
          outcome: "tool_error",
          createdAt: DAY_START + 300,
        },
        {
          _id: "u4",
          day: day(2),
          kind: "mcp_tool_called",
          clientName: "cursor",
          toolName: "launchsense_scan_public",
          outcome: "ok",
          createdAt: DAY_START + 2 * DAY_MS,
        },
      ],
    });
    const out = await mod.rollupDaily.handler(ctx, { now: NOW });
    assert.equal(out.day, YESTERDAY);
    const scans = metric(ctx, "mcp_tool_called", {
      client: "cursor",
      tool: "launchsense_scan_public",
      outcome: "ok",
    });
    assert.equal(scans.count, 2, "two calls from one client on one tool is one grouped row of two");
    assert.equal(
      metric(ctx, "mcp_tool_called", { client: "codex", tool: "launchsense_get_report", outcome: "tool_error" })
        .count,
      1,
    );
  });

  it("folds scans into submitted, analyzed and rescan_requested by status and surface", async () => {
    const ctx = makeCtx({
      scans: [
        scan({ _id: "s1", createdAt: DAY_START + 1000, analyzedAt: DAY_START + 5000, status: "completed" }),
        scan({ _id: "s2", createdAt: DAY_START + 2000, analyzedAt: DAY_START + 6000, status: "partial", truncated: true }),
        scan({ _id: "s3", createdAt: DAY_START + 3000, analyzedAt: DAY_START + 7000, status: "partial", errorKind: "rate_limited" }),
        scan({ _id: "s4", createdAt: DAY_START + 4000, analyzedAt: DAY_START + 8000, status: "completed", rescanOf: "s1" }),
        scan({ _id: "s5", createdAt: DAY_START + 4500, analyzedAt: DAY_START + 8500, status: "failed", errorKind: "network" }),
        // A scan submitted yesterday and analyzed yesterday, still in the window.
        scan({
          _id: "s6",
          createdAt: DAY_START - 1000,
          analyzedAt: DAY_START - 500,
          status: "completed",
          owner: "acme",
          repo: "older",
        }),
        // A scan still fetching is not an analyzed event.
        scan({ _id: "s7", createdAt: DAY_START + 5000, analyzedAt: undefined, status: "fetching" }),
      ],
    });
    await mod.rollupDaily.handler(ctx, { now: NOW });
    // Six submitted: five analyzed plus s7, which is still fetching. Submitted is
    // counted on creation, so a queued scan is not lost for being unfinished.
    assert.equal(metric(ctx, "scan_submitted", { surface: "unspecified" }).count, 6);
    assert.equal(metric(ctx, "scan_analyzed", { status: "completed", surface: "unspecified" }).count, 2);
    assert.equal(metric(ctx, "scan_analyzed", { status: "partial", surface: "unspecified" }).count, 2);
    assert.equal(metric(ctx, "scan_analyzed", { status: "failed", surface: "unspecified" }).count, 1);
    assert.equal(metric(ctx, "rescan_requested", { surface: "unspecified" }).count, 1);
    assert.ok(
      !metric(ctx, "scan_analyzed", { status: "fetching", surface: "unspecified" }),
      "a scan that has produced no result is not an analyzed event",
    );
  });

  it("attributes an analyzed scan to the day it produced its result, not the day it was pasted", async () => {
    const ctx = makeCtx({
      scans: [
        scan({ _id: "late", createdAt: DAY_START - 1000, analyzedAt: DAY_START + 2000, status: "completed" }),
      ],
    });
    await mod.rollupDaily.handler(ctx, { now: NOW });
    assert.equal(metric(ctx, "scan_analyzed", { status: "completed", surface: "unspecified" }).count, 1);
    assert.ok(!metric(ctx, "scan_submitted", { surface: "unspecified" }), "it was submitted the day before");
  });

  it("is idempotent: a rerun replaces the day instead of doubling it", async () => {
    const ctx = makeCtx({
      scans: [scan({ _id: "s1" })],
      usageEvents: [{ _id: "u1", day: YESTERDAY, kind: "mcp_session_initialized", clientName: "cursor", outcome: "ok" }],
    });
    const first = await mod.rollupDaily.handler(ctx, { now: NOW });
    const second = await mod.rollupDaily.handler(ctx, { now: NOW });
    assert.equal(first.replaced, 0);
    assert.equal(second.replaced, first.written);
    assert.equal(second.written, first.written);
    assert.equal(metric(ctx, "scan_analyzed", { status: "completed", surface: "unspecified" }).count, 1);
    assert.equal(
      metric(ctx, "mcp_session_initialized", { client: "cursor", tool: "none", outcome: "ok" }).count,
      1,
    );
  });

  it("replaces only the day it folds, not another day", async () => {
    const ctx = makeCtx({
      dailyMetrics: [
        { _id: "old", day: day(-3), metric: "scan_submitted", dims: "{}", count: 41, createdAt: 1 },
      ],
      scans: [scan({ _id: "s1" })],
    });
    await mod.rollupDaily.handler(ctx, { now: NOW });
    assert.equal(ctx.db.rows("dailyMetrics").find((r) => r.day === day(-3)).count, 41);
  });
});

describe("north star: repos with a proven fix", () => {
  let mod;
  before(async () => {
    mod = await loadWithStubs("convex/analytics/rollup.ts");
  });

  /** Two scans of one repo, a fix between them, on yesterday. */
  const baseSeed = (over = {}) => ({
    scans: [
      scan({ _id: "a", createdAt: DAY_START + 1000, analyzedAt: DAY_START + 2000, status: "completed" }),
      scan({ _id: "b", createdAt: DAY_START + 3000, analyzedAt: DAY_START + 4000, status: "completed", rescanOf: "a" }),
    ],
    findingTransitions: [transition({ fromScanId: "a", toScanId: "b", createdAt: DAY_START + 5000 })],
    ...over,
  });

  it("counts a code-change fix between two completed scans", async () => {
    const ctx = makeCtx(baseSeed());
    const out = await mod.rollupDaily.handler(ctx, { now: NOW });
    assert.equal(out.reposWithProvenFix, 1);
    assert.equal(metric(ctx, "repos_with_proven_fix", { surface: "all" }).count, 1);
    assert.equal(metric(ctx, "code_change_fix_count", { surface: "all" }).count, 1);
  });

  it("refuses an advisory_update fix as user success, and counts it on its own metric", async () => {
    const ctx = makeCtx(
      baseSeed({
        findingTransitions: [transition({ fromScanId: "a", toScanId: "b", cause: "advisory_update" })],
      }),
    );
    const out = await mod.rollupDaily.handler(ctx, { now: NOW });
    assert.equal(out.reposWithProvenFix, 0, "a rule pack shipping a check is not a developer fixing code");
    assert.equal(metric(ctx, "advisory_fix_count", { surface: "all" }).count, 1);
    assert.equal(metric(ctx, "code_change_fix_count", { surface: "all" }).count, 0);
  });

  it("refuses an analyzer_update fix as user success", async () => {
    const ctx = makeCtx(
      baseSeed({
        findingTransitions: [transition({ fromScanId: "a", toScanId: "b", cause: "analyzer_update" })],
      }),
    );
    await mod.rollupDaily.handler(ctx, { now: NOW });
    assert.equal(metric(ctx, "repos_with_proven_fix", { surface: "all" }).count, 0);
    assert.equal(metric(ctx, "analyzer_fix_count", { surface: "all" }).count, 1);
  });

  it("refuses a fix whose cause is absent, and names that count", async () => {
    const ctx = makeCtx(
      baseSeed({ findingTransitions: [transition({ fromScanId: "a", toScanId: "b", cause: undefined })] }),
    );
    await mod.rollupDaily.handler(ctx, { now: NOW });
    assert.equal(metric(ctx, "repos_with_proven_fix", { surface: "all" }).count, 0);
    assert.equal(metric(ctx, "unattributed_fix_count", { surface: "all" }).count, 1);
  });

  it("refuses a fix where either endpoint scan is not completed", async () => {
    for (const broken of ["a", "b"]) {
      const scans = [
        scan({ _id: "a", createdAt: DAY_START + 1000, analyzedAt: DAY_START + 2000, status: "completed" }),
        scan({ _id: "b", createdAt: DAY_START + 3000, analyzedAt: DAY_START + 4000, status: "completed", rescanOf: "a" }),
      ];
      scans[broken === "a" ? 0 : 1] = { ...scans[broken === "a" ? 0 : 1], status: "partial" };
      const ctx = makeCtx({ scans, findingTransitions: [transition()] });
      const out = await mod.rollupDaily.handler(ctx, { now: NOW });
      assert.equal(out.reposWithProvenFix, 0, `scan ${broken} is partial, so the fix is not proven`);
      assert.equal(metric(ctx, "code_change_fix_count", { surface: "all" }).count, 0);
    }
  });

  it("counts distinct repos, not scans: eleven rescans of one repo is one repo", async () => {
    const scans = [];
    const transitions = [];
    for (let i = 0; i < 11; i += 1) {
      scans.push(
        scan({
          _id: `s${i}`,
          createdAt: DAY_START + 1000 + i * 100,
          analyzedAt: DAY_START + 2000 + i * 100,
          status: "completed",
          rescanOf: i === 0 ? undefined : `s${i - 1}`,
        }),
      );
      if (i > 0) {
        transitions.push(
          transition({
            _id: `t${i}`,
            fromScanId: `s${i - 1}`,
            toScanId: `s${i}`,
            createdAt: DAY_START + 5000 + i,
            ruleId: `rule.${i}`,
          }),
        );
      }
    }
    const ctx = makeCtx({ scans, findingTransitions: transitions });
    const out = await mod.rollupDaily.handler(ctx, { now: NOW });
    assert.equal(out.reposWithProvenFix, 1, "eleven rescans of one repo is one repo measured");
    assert.equal(out.reposAnalyzed, 1);
    // The fix rows are counted per transition, so the number of fixes is real.
    assert.equal(metric(ctx, "code_change_fix_count", { surface: "all" }).count, 10);
  });

  it("counts two repos separately", async () => {
    const ctx = makeCtx({
      scans: [
        scan({ _id: "a1", owner: "acme", repo: "widget", createdAt: DAY_START + 1000, analyzedAt: DAY_START + 2000 }),
        scan({ _id: "a2", owner: "acme", repo: "widget", createdAt: DAY_START + 3000, analyzedAt: DAY_START + 4000, rescanOf: "a1" }),
        scan({ _id: "b1", owner: "acme", repo: "gadget", createdAt: DAY_START + 1100, analyzedAt: DAY_START + 2100 }),
        scan({ _id: "b2", owner: "acme", repo: "gadget", createdAt: DAY_START + 3100, analyzedAt: DAY_START + 4100, rescanOf: "b1" }),
      ],
      findingTransitions: [
        transition({ _id: "ta", fromScanId: "a1", toScanId: "a2", createdAt: DAY_START + 5000 }),
        transition({ _id: "tb", fromScanId: "b1", toScanId: "b2", createdAt: DAY_START + 5100 }),
      ],
    });
    const out = await mod.rollupDaily.handler(ctx, { now: NOW });
    assert.equal(out.reposWithProvenFix, 2);
  });

  it("ignores a fix recorded on another day", async () => {
    const ctx = makeCtx(
      baseSeed({ findingTransitions: [transition({ createdAt: DAY_START + 2 * DAY_MS })] }),
    );
    const out = await mod.rollupDaily.handler(ctx, { now: NOW });
    assert.equal(out.reposWithProvenFix, 0);
  });

  it("stores a count and never a repo name, hashed or not", async () => {
    const ctx = makeCtx(baseSeed());
    await mod.rollupDaily.handler(ctx, { now: NOW });
    const stored = JSON.stringify(ctx.db.rows("dailyMetrics"));
    assert.ok(!stored.includes("acme"), "no owner may reach a metric row");
    assert.ok(!stored.includes("widget"), "no repo may reach a metric row");
    assert.ok(!/owner|repoKey|"repo"/.test(stored), "no repo dimension may exist on a row");
  });

  it("segments the north star by surface, and by nothing else that identifies a repo", async () => {
    const ctx = makeCtx(
      baseSeed({
        scans: [
          scan({ _id: "a", surface: "mcp_hosted", createdAt: DAY_START + 1000, analyzedAt: DAY_START + 2000 }),
          scan({
            _id: "b",
            surface: "mcp_hosted",
            createdAt: DAY_START + 3000,
            analyzedAt: DAY_START + 4000,
            rescanOf: "a",
          }),
        ],
      }),
    );
    await mod.rollupDaily.handler(ctx, { now: NOW });
    assert.equal(metric(ctx, "repos_with_proven_fix", { surface: "mcp_hosted" }).count, 1);
    assert.equal(metric(ctx, "repos_with_proven_fix", { surface: "all" }).count, 1);
  });
});

describe("guardrail 1: partial coverage rate", () => {
  let mod;
  before(async () => {
    mod = await loadWithStubs("convex/analytics/rollup.ts");
  });

  it("is partial over all analyzed, split by why it was partial", async () => {
    const ctx = makeCtx({
      scans: [
        scan({ _id: "s1", status: "completed", analyzedAt: DAY_START + 1000 }),
        scan({ _id: "s2", status: "completed", analyzedAt: DAY_START + 2000 }),
        scan({ _id: "s3", status: "partial", truncated: true, analyzedAt: DAY_START + 3000 }),
        scan({ _id: "s4", status: "partial", treeTruncated: true, analyzedAt: DAY_START + 4000 }),
        scan({ _id: "s5", status: "partial", errorKind: "rate_limited", analyzedAt: DAY_START + 5000 }),
        scan({ _id: "s6", status: "failed", errorKind: "network", analyzedAt: DAY_START + 6000 }),
      ],
    });
    await mod.rollupDaily.handler(ctx, { now: NOW });
    const row = metric(ctx, "partial_coverage_rate", { surface: "all" });
    assert.equal(row.count, 3);
    assert.equal(row.ratio, 3 / 6, "partial over every analyzed scan, failures included in the denominator");
    assert.equal(metric(ctx, "partial_coverage_count", { reason: "truncated" }).count, 1);
    assert.equal(metric(ctx, "partial_coverage_count", { reason: "tree_truncated" }).count, 1);
    assert.equal(metric(ctx, "partial_coverage_count", { reason: "error:rate_limited" }).count, 1);
  });

  it("carries no ratio at all when nothing was analyzed, rather than a false zero", async () => {
    const ctx = makeCtx({ scans: [] });
    await mod.rollupDaily.handler(ctx, { now: NOW });
    const row = metric(ctx, "partial_coverage_rate", { surface: "all" });
    assert.equal(row.count, 0);
    assert.equal(row.ratio, undefined, "zero over zero is unknown, not a pass");
  });

  it("does not count a partial scan from another day", async () => {
    const ctx = makeCtx({
      scans: [
        scan({ _id: "s1", status: "completed", analyzedAt: DAY_START + 1000 }),
        scan({ _id: "s2", status: "partial", truncated: true, analyzedAt: DAY_START + 2 * DAY_MS }),
      ],
    });
    await mod.rollupDaily.handler(ctx, { now: NOW });
    assert.equal(metric(ctx, "partial_coverage_rate", { surface: "all" }).ratio, 0);
  });

  it("classifies a reason from the scan fields, never from its error message", () => {
    assert.equal(mod.partialReason({ truncated: true }), "truncated");
    assert.equal(mod.partialReason({ treeTruncated: true }), "tree_truncated");
    assert.equal(mod.partialReason({ errorKind: "rate_limited" }), "error:rate_limited");
    assert.equal(mod.partialReason({ errorKind: "unknown" }), "unspecified");
    assert.equal(mod.partialReason({}), "unspecified");
    // A raw message is never a dimension. The function has no parameter for one.
    assert.ok(!/errorMessage/.test(mod.partialReason.toString()));
  });
});

describe("guardrail 2: regression after fix", () => {
  let mod;
  before(async () => {
    mod = await loadWithStubs("convex/analytics/rollup.ts");
  });

  /** A -> B with a code-change fix, then B -> C where the rule comes back. */
  const chainSeed = (later = {}) => ({
    scans: [
      scan({ _id: "a", createdAt: DAY_START + 1000, analyzedAt: DAY_START + 2000, status: "completed" }),
      scan({ _id: "b", createdAt: DAY_START + 3000, analyzedAt: DAY_START + 4000, status: "completed", rescanOf: "a" }),
      scan({ _id: "c", createdAt: DAY_START + 5000, analyzedAt: DAY_START + 6000, status: "completed", rescanOf: "b" }),
    ],
    findingTransitions: [
      transition({ _id: "t1", fromScanId: "a", toScanId: "b", ruleId: "secret.tracked-env", createdAt: DAY_START + 4500 }),
      {
        _id: "t2",
        fromScanId: "b",
        toScanId: "c",
        ruleId: "secret.tracked-env",
        state: "regressed",
        cause: undefined,
        createdAt: DAY_START + 6500,
        ...later,
      },
    ],
  });

  it("counts a fix that comes back as regressed", async () => {
    const ctx = makeCtx(chainSeed());
    await mod.rollupDaily.handler(ctx, { now: NOW });
    const row = metric(ctx, "regression_after_fix_rate", { surface: "all" });
    assert.equal(row.count, 1);
    assert.equal(row.ratio, 1, "the only fix in the day came back, so the rate is 1");
  });

  it("counts a rule that comes back as new for a ruleId this repo had fixed", async () => {
    const ctx = makeCtx(chainSeed({ state: "new" }));
    await mod.rollupDaily.handler(ctx, { now: NOW });
    assert.equal(metric(ctx, "regression_after_fix_rate", { surface: "all" }).ratio, 1);
  });

  it("does not count a fix that held", async () => {
    const ctx = makeCtx(
      chainSeed({ state: "still_broken", ruleId: "hygiene.no-readme" }),
    );
    await mod.rollupDaily.handler(ctx, { now: NOW });
    const row = metric(ctx, "regression_after_fix_rate", { surface: "all" });
    assert.equal(row.count, 0);
    assert.equal(row.ratio, 0, "the fix held, so the rate is a real zero");
  });

  it("does not count a different rule coming back", async () => {
    const ctx = makeCtx(chainSeed({ ruleId: "deps.duplicate" }));
    await mod.rollupDaily.handler(ctx, { now: NOW });
    assert.equal(metric(ctx, "regression_after_fix_rate", { surface: "all" }).ratio, 0);
  });

  it("excludes a fix that was never proven, because one endpoint was partial", async () => {
    const seed = chainSeed();
    seed.scans[1] = { ...seed.scans[1], status: "partial" };
    const ctx = makeCtx(seed);
    await mod.rollupDaily.handler(ctx, { now: NOW });
    assert.equal(
      metric(ctx, "regression_after_fix_rate", { surface: "all" }).ratio,
      undefined,
      "a fix between a partial and a completed scan is not in the denominator",
    );
  });

  it("carries no ratio when there was no fix to return from", async () => {
    const ctx = makeCtx({ scans: [scan({ _id: "a", analyzedAt: DAY_START + 1000 })] });
    await mod.rollupDaily.handler(ctx, { now: NOW });
    assert.equal(metric(ctx, "regression_after_fix_rate", { surface: "all" }).ratio, undefined);
  });

  it("finds the next completed scan of the same repo, not the next scan of any repo", async () => {
    const seed = chainSeed();
    // Another repo's scan sits between B and C in time.
    seed.scans.push(
      scan({
        _id: "other",
        owner: "acme",
        repo: "gadget",
        createdAt: DAY_START + 5500,
        analyzedAt: DAY_START + 5600,
        status: "completed",
      }),
    );
    const ctx = makeCtx(seed);
    await mod.rollupDaily.handler(ctx, { now: NOW });
    assert.equal(metric(ctx, "regression_after_fix_rate", { surface: "all" }).ratio, 1);
  });
});

describe("staging rows are deleted after 30 days", () => {
  let mod;
  let rollup;
  before(async () => {
    mod = await loadWithStubs("convex/analytics/retention.ts");
    rollup = await loadWithStubs("convex/analytics/rollup.ts");
  });

  /**
   * The real purge, end to end: the scheduled action computes the cutoff and hands
   * it to the real mutation, which runs against the real db fake.
   */
  const purge = (ctx) =>
    mod.purgeExpiredUsageEvents.handler({
      db: ctx.db,
      runMutation: (ref, args) => mod.purgeUsageEvents.handler(ctx, args),
    }, {});
  /** The cutoff day the action will use, read off the same constant. */
  const cutoffDay = () => new Date(Date.now() - mod.USAGE_EVENT_TTL_MS).toISOString().slice(0, 10);
  /** One calendar day before a day string, or one after. */
  const shiftDay = (value, by) =>
    new Date(Date.parse(`${value}T00:00:00Z`) + by * DAY_MS).toISOString().slice(0, 10);

  it("names a 30 day window as a constant", () => {
    assert.equal(mod.USAGE_EVENT_TTL_DAYS, 30);
    assert.equal(mod.USAGE_EVENT_TTL_MS, 30 * 24 * 60 * 60 * 1000);
  });

  it("states the window in digits the claim guard can resolve", () => {
    // The guard resolves a retention constant by evaluating the digits in it, so a
    // window written as `USAGE_EVENT_TTL_DAYS * 24 * ...` is invisible to it and the
    // copy that states the window then reads as unsupported. Two constants, so the
    // test has to hold them together.
    const raw = readRepo("convex/analytics/retention.ts");
    assert.match(raw, /USAGE_EVENT_TTL_MS = 30 \* 24 \* 60 \* 60 \* 1000;/);
    assert.equal(mod.USAGE_EVENT_TTL_MS, mod.USAGE_EVENT_TTL_DAYS * 24 * 60 * 60 * 1000);
  });

  it("the claim guard accepts this window and still rejects an unbacked one", () => {
    // Two retention windows now exist in the repo, so the guard has to resolve each
    // claim against every bound purge rather than whichever one it read first.
    const guard = fileURLToPath(new URL("scripts/check-claims.mjs", repoRoot));
    const run = (line) => {
      const dir = mkdtempSync(join(tmpdir(), "claim-guard-w6-"));
      const file = join(dir, "probe.md");
      writeFileSync(file, `${line}\n`, "utf8");
      try {
        return spawnSync(process.execPath, [guard], {
          encoding: "utf8",
          cwd: fileURLToPath(repoRoot),
          env: { ...process.env, CLAIM_GUARD_EXTRA_FILE: relative(fileURLToPath(repoRoot), file) },
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };
    const backed = run("Usage rows are deleted after 30 days by a nightly job.");
    assert.ok(
      !`${backed.stdout}${backed.stderr}`.includes("probe.md"),
      `the 30 day window is backed by purgeUsageEvents; output was:\n${backed.stdout}${backed.stderr}`,
    );
    const unbacked = run("Usage rows are deleted after 45 days by a nightly job.");
    assert.notEqual(unbacked.status, 0, "a window no constant matches must still fail");
    assert.match(`${unbacked.stdout}${unbacked.stderr}`, /no TTL constant matches/);
  });

  it("is scheduled, as its own job rather than as half of the fold", () => {
    const crons = readRepo("convex/crons.ts");
    assert.match(crons, /crons\.daily\(\s*\n?\s*"purge expired usage events"/);
    assert.match(crons, /internal\.analytics\.retention\.purgeExpiredUsageEvents/);
    // A Convex mutation cannot call another mutation, so retention had to be its
    // own job. Folding it in would make a day's numbers depend on whether the
    // delete half of the same job finished.
    const raw = readRepo("convex/analytics/rollup.ts");
    assert.ok(
      !/ctx\.db\.delete\("usageEvents"/.test(raw),
      "the fold must not also delete staging rows",
    );
    assert.ok(
      !/purgeUsageEvents|USAGE_EVENT_TTL/.test(raw),
      "the window belongs to the retention module, so there is one place to read it",
    );
  });

  it("computes the cutoff when the job fires, not when the module loaded", async () => {
    // A cron argument is frozen at module load. A Date.now() in the registration
    // would be one fixed instant that never moves, and a year after deploy it would
    // delete every row in the table.
    const crons = readRepo("convex/crons.ts");
    assert.ok(
      !/purge[\s\S]{0,200}Date\.now\(\)/.test(crons),
      "no cron argument may hold a moving clock value",
    );
    assert.match(
      crons,
      /internal\.analytics\.retention\.purgeExpiredUsageEvents,\s*\n\s*\{\},\s*\n\)/,
      "the cron must pass no arguments, so no cutoff can be frozen into it",
    );
    // The action builds the cutoff at fire time and hands it down.
    const ctx = makeCtx({ usageEvents: [] });
    const out = await purge(ctx);
    assert.equal(out.cutoffDay, cutoffDay(), "the cutoff must track the clock at call time");
    const raw = readRepo("convex/analytics/retention.ts");
    assert.match(
      raw,
      /purgeExpiredUsageEvents[\s\S]{0,900}Date\.now\(\) - USAGE_EVENT_TTL_MS/,
      "the cutoff must be computed inside the action, at fire time",
    );
  });


  it("deletes rows older than the window and keeps everything inside it", async () => {
    // The cutoff day itself survives: a row exactly at the boundary is inside the
    // window, not past it. The days either side of it are the real assertion.
    const cutoff = cutoffDay();
    const past = shiftDay(cutoff, -1);
    const inside = shiftDay(cutoff, 1);
    const rows = (d) => ({ day: d, kind: "mcp_tool_called", clientName: "cursor", outcome: "ok" });
    const ctx = makeCtx({ usageEvents: [rows(past), rows(cutoff), rows(inside)] });
    const out = await purge(ctx);
    assert.equal(out.deleted, 1, "only the row past the cutoff is deleted");
    assert.deepEqual(
      ctx.db.rows("usageEvents").map((r) => r.day).sort(),
      [cutoff, inside].sort(),
      "the boundary row and everything inside the window survive",
    );
  });

  it("deletes the row at the day just past the window", async () => {
    const past = shiftDay(cutoffDay(), -1);
    const ctx = makeCtx({
      usageEvents: [{ day: past, kind: "mcp_session_initialized", clientName: "cursor", outcome: "ok" }],
    });
    const out = await purge(ctx);
    assert.equal(out.deleted, 1);
    assert.equal(ctx.db.rows("usageEvents").length, 0);
  });

  it("deletes nothing on a day with nothing stale", async () => {
    const ctx = makeCtx({
      usageEvents: [{ day: YESTERDAY, kind: "mcp_session_initialized", clientName: "cursor", outcome: "ok" }],
    });
    const out = await purge(ctx);
    assert.equal(out.deleted, 0);
    assert.equal(ctx.db.rows("usageEvents").length, 1);
  });

  it("reports when it hit its batch bound rather than silently deleting less", async () => {
    const past = shiftDay(cutoffDay(), -1);
    const many = Array.from({ length: 500 }, (_, i) => ({
      _id: `u${i}`,
      day: past,
      kind: "mcp_tool_called",
      clientName: "cursor",
      outcome: "ok",
    }));
    const ctx = makeCtx({ usageEvents: many });
    const out = await purge(ctx);
    assert.equal(out.deleted, 500);
    assert.equal(out.hitBatchCap, true, "a capped purge must say so, or a backlog looks cleared");
    assert.equal(ctx.db.rows("usageEvents").length, 0);
  });

  it("keeps the folded metrics forever, because they are the only reader's source", async () => {
    const ctx = makeCtx({
      usageEvents: [{ day: day(-31), kind: "mcp_session_initialized", clientName: "cursor", outcome: "ok" }],
      scans: [scan({ _id: "s1", analyzedAt: DAY_START + 1000 })],
    });
    await rollup.rollupDaily.handler(ctx, { now: NOW });
    await purge(ctx);
    assert.ok(ctx.db.rows("dailyMetrics").length > 0, "retention must not touch the folded metrics");
    const raw = readRepo("convex/analytics/retention.ts");
    assert.ok(
      !/ctx\.db\.delete\("dailyMetrics"/.test(raw),
      "the retention delete must target usageEvents, not the metrics",
    );
  });
});

describe("nothing forbidden reaches a stored row", () => {
  it("a stored row carries no property the denylist names", async () => {
    const privacy = await loadWithStubs("convex/analytics/privacy.ts");
    const ctx = makeCtx({
      scans: [
        scan({ _id: "a", createdAt: DAY_START + 1000, analyzedAt: DAY_START + 2000, surface: "web" }),
        scan({
          _id: "b",
          createdAt: DAY_START + 3000,
          analyzedAt: DAY_START + 4000,
          status: "partial",
          errorKind: "truncated",
          rescanOf: "a",
          surface: "web",
        }),
      ],
      findingTransitions: [transition({ fromScanId: "a", toScanId: "b" })],
      usageEvents: [
        {
          _id: "u1",
          day: YESTERDAY,
          kind: "mcp_tool_called",
          clientName: "cursor",
          toolName: "launchsense_scan_public",
          outcome: "ok",
          repoKey: "c".repeat(64),
        },
      ],
    });
    const mod = await loadWithStubs("convex/analytics/rollup.ts");
    await mod.rollupDaily.handler(ctx, { now: NOW });
    const rows = ctx.db.rows("dailyMetrics");
    assert.ok(rows.length > 0, "the fold must have written something to check");
    for (const row of rows) {
      const bag = { ...JSON.parse(row.dims), metric: row.metric, day: row.day };
      assert.deepEqual(
        privacy.forbiddenPropertiesIn(bag),
        [],
        `${row.metric} ${row.dims} carries a forbidden property`,
      );
      // dims is low cardinality by construction: a handful of short values.
      assert.ok(row.dims.length <= 400, `dims is not bounded: ${row.dims}`);
    }
    // Every emitted metric is in the closed vocabulary, so no dimension can
    // multiply the row count without someone adding it to this list first.
    for (const row of rows) {
      assert.ok(mod.METRIC_NAMES.includes(row.metric), `${row.metric} is not in the closed vocabulary`);
    }
  });

  it("the whole rollup writes no repo name, path, title or snippet", async () => {
    const mod = await loadWithStubs("convex/analytics/rollup.ts");
    const ctx = makeCtx({
      scans: [
        scan({ _id: "a", createdAt: DAY_START + 1000, analyzedAt: DAY_START + 2000, surface: "web" }),
        scan({
          _id: "b",
          createdAt: DAY_START + 3000,
          analyzedAt: DAY_START + 4000,
          status: "partial",
          errorKind: "truncated",
          rescanOf: "a",
          surface: "web",
        }),
      ],
      findingTransitions: [transition()],
      usageEvents: [
        {
          _id: "u1",
          day: YESTERDAY,
          kind: "mcp_tool_called",
          clientName: "cursor",
          toolName: "launchsense_scan_public",
          outcome: "ok",
          repoKey: "c".repeat(64),
        },
      ],
    });
    await mod.rollupDaily.handler(ctx, { now: NOW });
    const stored = JSON.stringify(ctx.db.rows("dailyMetrics"));
    for (const needle of ["acme", "widget", "src/", ".env", "secret.tracked-env", "coverageNote"]) {
      assert.ok(!stored.includes(needle), `a metric row must not carry ${needle}`);
    }
  });

  it("the MCP ingest path never reads a path, a title, a snippet, or a raw message", async () => {
    const raw = readRepo("convex/analytics/ingest.ts");
    for (const forbidden of ["evidenceItems", "redactedSnippet", "fileContents", "coverageNote", "repoUrl", "sha"]) {
      assert.ok(!new RegExp(`\\b${forbidden}\\b`).test(raw), `ingest must not read ${forbidden}`);
    }
    const mcp = readRepo("convex/mcpHttp.ts");
    assert.ok(!/redactedSnippet|fileContents|evidenceItems/.test(mcp));
  });

  it("the MCP surface reports a file path to the caller without storing one", async () => {
    // A report legitimately tells the caller where a finding is. That is a
    // response, not an event, and the split has to stay a split.
    const mcp = readRepo("convex/mcpHttp.ts");
    const reportFn = mcp.slice(mcp.indexOf("export function formatReport"));
    assert.match(reportFn, /finding\.path/);
    const start = mcp.indexOf("export type McpUsageEvent");
    assert.notEqual(start, -1, "the event type must exist to be checked");
    const eventType = mcp.slice(start, mcp.indexOf("export type McpUsageReporter"));
    assert.ok(!/\bpath\b/.test(eventType), "an event type with a path field would store one");
    assert.ok(!/\btitle\b/.test(eventType), "an event type with a title field would store one");
    // The whole set of properties an event may carry, read off the type itself.
    const fields = [...eventType.matchAll(/^\s{2}([a-zA-Z]+)\??:/gm)].map((m) => m[1]);
    assert.deepEqual(fields.sort(), [
      "clientName",
      "clientVersion",
      "durationMs",
      "errorType",
      "kind",
      "mcpMethodName",
      "outcome",
      "protocolVersion",
      "repoKey",
      "rpcResponseStatusCode",
      "toolName",
    ]);
  });
});