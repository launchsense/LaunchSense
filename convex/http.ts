import { httpRouter } from "convex/server";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { components, api, internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { auth } from "./auth";
import {
  formatPublicScan,
  formatReport,
  handleMcpMessage,
  wantsEventStream,
  type McpUsageEvent,
  type ToolName,
} from "./mcpHttp";
import { USAGE_KEY_HEADER, usageKeyMatches } from "./mcpLimit";
import { repoKeyFor } from "./analytics/privacy";
import { parseGitHubRepoUrl } from "../shared/githubUrl";
import {
  MCP_ALLOWED_HEADERS_VALUE,
  bearerTokenFromHeader,
  unauthorizedResponse,
} from "./identity/credential";
import type { CallerIdentity } from "./identity/attribution";

// The Convex runtime exposes environment variables here; Convex TypeScript does
// not declare it. Same declaration as the server adapters use.
declare const process: { env: Record<string, string | undefined> };

// The usage route is an open write without a credential, so it takes a shared
// key header compared to a server-side env value. Unset means closed. The
// expected value is only ever read here, never returned or logged.
function usageAuthorized(request: Request): boolean {
  return usageKeyMatches(request.headers.get(USAGE_KEY_HEADER), process.env["USAGE_ROUTE_KEY"]);
}

// The deployment secret the repo identity is hashed with. It is read here and
// nowhere else, is never returned or logged, and is never part of a row: only its
// HMAC output is. Unset means the scan tool stores no repo key at all, which is
// the honest failure. Rotating it breaks same-day joins only.
const ANALYTICS_SALT_ENV = "ANALYTICS_DAY_SALT";

/** One MCP usage event per protocol action, stored as one usageEvents row. */
async function storeMcpUsageEvent(
  ctx: Parameters<Parameters<typeof httpAction>[0]>[0],
  event: McpUsageEvent,
): Promise<void> {
  // The write must never be the reason a caller gets no answer, so a failed
  // analytics row is swallowed. The tool's own result is what the caller came for.
  try {
    await ctx.runMutation(internal.analytics.ingest.recordMcpUsageEvent, {
      kind: event.kind,
      clientName: event.clientName,
      clientVersion: event.clientVersion,
      protocolVersion: event.protocolVersion,
      mcpMethodName: event.mcpMethodName,
      toolName: event.toolName,
      outcome: event.outcome,
      errorType: event.errorType,
      rpcResponseStatusCode: event.rpcResponseStatusCode,
      durationMs: event.durationMs,
      // A hash of the day and the repo name, or nothing. The mutation refuses
      // anything that is not 64 hex characters, so a literal cannot be stored
      // even if this call site were changed carelessly.
      repoKey: event.repoKey,
    });
  } catch {
    // Nothing here is worth surfacing to the caller and nothing here is worth
    // failing the request over.
  }
}

const http = httpRouter();
auth.addHttpRoutes(http);
http.route({
  path: "/api/health",
  method: "GET",
  handler: httpAction(async () => Response.json({ status: "ok", service: "launchsense" })),
});

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

/**
 * The CORS headers every MCP-shaped route answers with.
 *
 * Authorization is in the allowed list because without it a browser-based MCP
 * client cannot send a credential at all: the preflight fails, no header goes
 * out, and every request silently looks anonymous. That was a real limitation,
 * not a footnote.
 *
 * Mcp-Session-Id stays in the list because clients send it, but nothing on this
 * server issues one and nothing authenticates on it. The MCP security guidance is
 * explicit that a session is not a credential.
 */
const mcpCors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": MCP_ALLOWED_HEADERS_VALUE,
  "Cache-Control": "no-store",
};

/**
 * Resolve the caller's credential, or explain why it did not.
 *
 * The order matters and it is the whole point of this function:
 *
 *   no Authorization header   anonymous. The call proceeds and the scan records
 *                             attributed: false, so it still counts in the
 *                             denominator rather than disappearing.
 *   header present, refused   401 with WWW-Authenticate. A caller who presented
 *                             something and got it wrong is told so and gets no
 *                             scan. Failing closed here is what makes revocation
 *                             real: a revoked token cannot fall through to the
 *                             anonymous path and keep working.
 *
 * `Mcp-Session-Id` is never read. MCP servers must not use a session as a
 * credential.
 */
async function authenticate(
  ctx: Parameters<Parameters<typeof httpAction>[0]>[0],
  request: Request,
): Promise<
  | { ok: true; identity: CallerIdentity }
  | { ok: false; response: Response }
> {
  const header = request.headers.get("authorization");
  const token = bearerTokenFromHeader(header);
  if (token === null) {
    // An absent header is anonymous. A header that is present but is not a
    // Bearer token is a credential that was presented and refused, so it must
    // not silently fall through to the anonymous path and keep working.
    if (typeof header === "string" && header.trim().length > 0) {
      const refused = unauthorizedResponse("invalid");
      return {
        ok: false,
        response: Response.json(refused.body, {
          status: refused.status,
          headers: { ...refused.headers, ...mcpCors },
        }),
      };
    }
    return { ok: true, identity: { resolved: false } };
  }
  const resolved = await ctx.runQuery(internal.identity.store.resolveToken, { token });
  if (resolved.resolved !== true) {
    const failure = resolved.failure === "missing" ? "missing" : "invalid";
    const { status, headers, body } = unauthorizedResponse(failure);
    return { ok: false, response: Response.json(body, { status, headers: { ...headers, ...mcpCors } }) };
  }
  return {
    ok: true,
    identity: {
      resolved: true,
      callerId: resolved.callerId,
      userId: resolved.userId,
      // Recorded as a claim and labelled as one. Nothing below reads it: not the
      // quota key, not the ownership check, not the access decision.
      declaredHarness: resolved.declaredHarness,
      verifiedBinding: resolved.verifiedBinding,
    },
  };
}

const tools = [
  {
    name: "launchsense_scan_public",
    description:
      "Read one public GitHub repository on the LaunchSense server. Same caps as the website paste: 200 files and about 2MB. Does not read a repo that exists only on the caller laptop. Alpha has no login.",
    inputSchema: {
      repoUrl: "https://github.com/owner/repo",
    },
  },
  {
    name: "launchsense_get_report",
    description:
      "Read a LaunchSense report by scan id. A partial result is not a pass. The coverage line says what was not read.",
    inputSchema: {
      scanId: "convex scan id",
    },
  },
];

http.route({
  path: "/api/mcp/tools",
  method: "GET",
  handler: httpAction(async () => json({ tools })),
});

http.route({
  path: "/api/mcp/scan",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // Credential before body, same as the protocol route.
    const credential = await authenticate(ctx, request);
    if (!credential.ok) return credential.response;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Send JSON with a repoUrl." }, 400);
    }
    const record = (body ?? {}) as Record<string, unknown>;
    const repoUrl = typeof record["repoUrl"] === "string" ? record["repoUrl"] : "";
    if (!repoUrl) return json({ error: "repoUrl is required." }, 400);
    // No caller address is read here, and none is sent. The gate keys on the
    // resolved callerId, or on the one shared bucket when none resolved.
    const gate = await ctx.runMutation(internal.mcpLimit.consumeMcpScan, {
      callerId: credential.identity.callerId,
    });
    if (!gate.allowed) {
      return json({ error: "This route is paused until the quota window resets." }, 429);
    }
    // Same action the protocol route calls, so the surface rules, the sha
    // resolution, and the ownership rule cannot drift between the two doors.
    const scan = await ctx.runAction(internal.scans.actions.runHostedScan, {
      repoUrl,
      callerId: credential.identity.callerId,
      channel: "api",
    });
    if (scan.status === "failed") return json({ error: "Scan could not start.", scanId: scan.scanId }, 422);
    const analyzed = await ctx.runAction(api.scans.analyze.analyzeScan, { scanId: scan.scanId });
    const report = await ctx.runQuery(api.scans.queries.getResults, { scanId: scan.scanId });
    return json({
      scanId: scan.scanId,
      status: analyzed.status,
      coverageNote: report.scan?.coverageNote ?? null,
      findingCount: report.findings.length,
      findings: report.findings.map((f) => ({
        ruleId: f.ruleId,
        severity: f.severity,
        title: f.title,
        path: f.path,
        line: f.line,
      })),
    });
  }),
});

http.route({
  path: "/api/mcp/usage",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // Credential first, before the body is read, so an unauthorised caller can
    // neither write a row nor learn anything about the payload shape.
    if (!usageAuthorized(request)) {
      return json({ error: "This route needs the usage key." }, 401);
    }
    const usageGate = await ctx.runMutation(internal.mcpLimit.consumeUsageWrite, {});
    if (!usageGate.allowed) {
      return json({ error: "This route is paused until the quota window resets." }, 429);
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Send JSON usage counts." }, 400);
    }
    const record = (body ?? {}) as Record<string, unknown>;
    const tier = typeof record["tier"] === "string" ? record["tier"] : "";
    if (tier === "enterprise") return json({ stored: false });
    const counts = record["ruleCounts"];
    if (typeof counts !== "object" || counts === null) return json({ error: "ruleCounts is required." }, 400);
    const ruleCounts = JSON.stringify(counts);
    if (ruleCounts.length > 4000 || /"path"|"content"|"snippet"|"title"/.test(ruleCounts)) {
      return json({ error: "Usage counts cannot include file text." }, 400);
    }
    await ctx.runMutation(internal.mcpLimit.recordUsage, {
      stage: typeof record["stage"] === "string" ? record["stage"] : "alpha",
      tier,
      harness: typeof record["harness"] === "string" ? record["harness"] : "local",
      version: typeof record["version"] === "string" ? record["version"] : "alpha",
      durationMs: typeof record["durationMs"] === "number" ? record["durationMs"] : 0,
      // A caller that sends no source is not counted as a table answer. The row
      // stores "unspecified" so a missing value cannot inflate the table count.
      orderSource: typeof record["orderSource"] === "string" ? record["orderSource"] : "unspecified",
      ruleCounts,
    });
    return json({ stored: true });
  }),
});

http.route({
  path: "/mcp",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: mcpCors })),
});

http.route({
  path: "/mcp",
  method: "GET",
  handler: httpAction(async () =>
    json({ error: "POST a JSON-RPC message to this URL." }, 405),
  ),
});

http.route({
  path: "/mcp",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // Credential before body. An unauthorised caller learns nothing about the
    // payload shape and never reaches the protocol handler.
    const credential = await authenticate(ctx, request);
    if (!credential.ok) return credential.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON." } },
        { status: 400, headers: { ...mcpCors, "Content-Type": "application/json" } },
      );
    }
    // The caller's network address is not read on this route. The scan gate keys
    // on the resolved callerId, or on the one shared bucket when none resolved,
    // so no caller value of the caller's own choosing is needed or stored.
    //
    // The reporter is where clientInfo is read and allowlisted. The protocol layer
    // hands over one event per action and this route decides whether that becomes
    // a row, so the protocol code holds no database call.
    const result = await handleMcpMessage(
      body,
      (name, args) => callHostedTool(ctx, name, args, credential.identity),
      // Awaited, so the row is written before the caller gets its answer. A write
      // that raced the response would be lost silently, and a lost row reads as a
      // drop in traffic.
      (event) => storeMcpUsageEvent(ctx, event),
    );
    if (result.status === 202 || result.body === null) {
      return new Response(null, { status: 202, headers: mcpCors });
    }
    const payload = JSON.stringify(result.body);
    const accept = request.headers.get("accept") ?? "";
    if (wantsEventStream(accept)) {
      return new Response(`event: message\ndata: ${payload}\n\n`, {
        status: result.status,
        headers: { ...mcpCors, "Content-Type": "text/event-stream" },
      });
    }
    return new Response(payload, {
      status: result.status,
      headers: { ...mcpCors, "Content-Type": "application/json" },
    });
  }),
});

async function callHostedTool(
  ctx: Parameters<Parameters<typeof httpAction>[0]>[0],
  name: ToolName,
  args: Record<string, unknown>,
  identity: CallerIdentity,
): Promise<{ text: string; isError: boolean }> {
  switch (name) {
    case "launchsense_scan_public":
      return scanPublicTool(ctx, typeof args.repoUrl === "string" ? args.repoUrl : "", identity);
    case "launchsense_get_report":
      return reportTool(ctx, typeof args.scanId === "string" ? args.scanId : "");
    default: {
      const _never: never = name;
      return _never;
    }
  }
}

async function scanPublicTool(
  ctx: Parameters<Parameters<typeof httpAction>[0]>[0],
  repoUrl: string,
  identity: CallerIdentity,
): Promise<{ text: string; isError: boolean; outcome?: "quota_denied"; repoKey?: string }> {
  if (!repoUrl) return { text: "repoUrl is required.", isError: true };
  // The quota keys on the server-minted callerId when one resolved, and on the one
  // shared bucket when none did. It never keys on anything the caller chose: the
  // declared harness label travels with the identity and is not passed here.
  const gate = await ctx.runMutation(internal.mcpLimit.consumeMcpScan, {
    callerId: identity.callerId,
  });
  if (!gate.allowed) {
    // The refusal is counted as its own outcome rather than as a tool error,
    // because "the shared quota window closed" and "the repo would not open" are
    // two different facts about the lane.
    return {
      text: "This route is paused until the quota window resets.",
      isError: true,
      outcome: "quota_denied",
    };
  }
  // The repo name is read here, at the one place that already has it, and hashed
  // into a day-scoped key. The literal never reaches the analytics write path.
  const parsed = parseGitHubRepoUrl(repoUrl);
  const repoKey =
    parsed.ok
      ? ((await repoKeyFor(
          process.env[ANALYTICS_SALT_ENV],
          new Date().toISOString().slice(0, 10),
          parsed.value.owner,
          parsed.value.repo,
        )) ?? undefined)
      : undefined;
  const scan = await ctx.runAction(internal.scans.actions.runHostedScan, {
    repoUrl,
    callerId: identity.callerId,
    channel: "mcp",
  });
  if (scan.status === "failed") {
    return { text: `Scan could not start. Scan ${scan.scanId}`, isError: true, repoKey };
  }
  if (identity.resolved && identity.callerId) {
    // Best effort. Which credentials are still in use is the question that decides
    // whether a revoke disconnects one harness or one person, so the stamp is
    // worth having. It is a mutation the scan does not wait on, and a failure of it
    // changes nothing the caller sees.
    void ctx
      .runMutation(internal.identity.store.markCredentialUsed, {
        callerId: identity.callerId as Id<"credentials">,
      })
      .catch(() => undefined);
  }
  const analyzed = await ctx.runAction(api.scans.analyze.analyzeScan, { scanId: scan.scanId });
  const report = await ctx.runQuery(api.scans.queries.getResults, { scanId: scan.scanId });
  return {
    text: formatPublicScan({
      scanId: scan.scanId,
      status: analyzed.status,
      coverageNote: report.scan?.coverageNote ?? null,
      findingCount: report.findings.length,
      findings: report.findings.map((finding) => ({
        ruleId: finding.ruleId,
        severity: finding.severity,
        title: finding.title,
        path: finding.path,
        line: finding.line,
      })),
    }),
    isError: false,
    repoKey,
  };
}

async function reportTool(
  ctx: Parameters<Parameters<typeof httpAction>[0]>[0],
  scanId: string,
): Promise<{ text: string; isError: boolean }> {
  if (!scanId) return { text: "scanId is required.", isError: true };
  const report = await ctx.runQuery(api.scans.queries.getResults, { scanId: scanId as never });
  if (report.scan === null) return { text: "Scan not found.", isError: true };
  return {
    text: formatReport({
      scanId,
      sha: report.scan.sha ?? null,
      status: report.scan.status,
      coverageNote: report.scan.coverageNote ?? null,
      findingCount: report.findings.length,
      findings: report.findings.map((finding) => ({
        ruleId: finding.ruleId,
        severity: finding.severity,
        title: finding.title,
        path: finding.path,
        line: finding.line,
      })),
    }),
    isError: false,
  };
}

http.route({
  path: "/api/mcp/report",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // Same credential rule as the other hosted routes. This one reads a scan
    // rather than making one, so the only thing identity changes here is that a
    // refused credential is refused rather than silently treated as anonymous.
    const credential = await authenticate(ctx, request);
    if (!credential.ok) return credential.response;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Send JSON with a scanId." }, 400);
    }
    const record = (body ?? {}) as Record<string, unknown>;
    const scanId = typeof record["scanId"] === "string" ? record["scanId"] : "";
    if (!scanId) return json({ error: "scanId is required." }, 400);
    const report = await ctx.runQuery(api.scans.queries.getResults, { scanId: scanId as never });
    if (report.scan === null) return json({ error: "Scan not found." }, 404);
    return json({
      scanId,
      sha: report.scan.sha ?? null,
      status: report.scan.status,
      coverageNote: report.scan.coverageNote ?? null,
      findingCount: report.findings.length,
      findings: report.findings.map((f) => ({
        ruleId: f.ruleId,
        severity: f.severity,
        title: f.title,
        path: f.path,
        line: f.line,
      })),
    });
  }),
});

// Exact health/auth/API routes win over this static site fallback.
registerStaticRoutes(http, components.staticHosting);
export default http;
