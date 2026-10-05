import { httpRouter } from "convex/server";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { components, api, internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
import { formatPublicScan, formatReport, handleMcpMessage, wantsEventStream, type ToolName } from "./mcpHttp";
import { USAGE_KEY_HEADER, usageKeyMatches } from "./mcpLimit";

// The Convex runtime exposes environment variables here; Convex TypeScript does
// not declare it. Same declaration as the server adapters use.
declare const process: { env: Record<string, string | undefined> };

// The usage route is an open write without a credential, so it takes a shared
// key header compared to a server-side env value. Unset means closed. The
// expected value is only ever read here, never returned or logged.
function usageAuthorized(request: Request): boolean {
  return usageKeyMatches(request.headers.get(USAGE_KEY_HEADER), process.env["USAGE_ROUTE_KEY"]);
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
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Send JSON with a repoUrl." }, 400);
    }
    const record = (body ?? {}) as Record<string, unknown>;
    const repoUrl = typeof record["repoUrl"] === "string" ? record["repoUrl"] : "";
    if (!repoUrl) return json({ error: "repoUrl is required." }, 400);
    // No caller address is read here, and none is sent. The gate has a shared
    // hosted bucket, so there is nothing to key on and nothing to store.
    const gate = await ctx.runMutation(internal.mcpLimit.consumeMcpScan, {});
    if (!gate.allowed) {
      return json({ error: "This route is paused until the shared quota window resets." }, 429);
    }
    const scan = await ctx.runAction(api.scans.actions.runScan, { repoUrl });
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

const mcpCors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id",
  "Cache-Control": "no-store",
};

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
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON." } },
        { status: 400, headers: { ...mcpCors, "Content-Type": "application/json" } },
      );
    }
    // The caller's network address is not read on this route. The scan gate has a
    // shared hosted bucket, so no caller value is needed and none is stored.
    const result = await handleMcpMessage(body, (name, args) => callHostedTool(ctx, name, args));
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
): Promise<{ text: string; isError: boolean }> {
  switch (name) {
    case "launchsense_scan_public":
      return scanPublicTool(ctx, typeof args.repoUrl === "string" ? args.repoUrl : "");
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
): Promise<{ text: string; isError: boolean }> {
  if (!repoUrl) return { text: "repoUrl is required.", isError: true };
  const gate = await ctx.runMutation(internal.mcpLimit.consumeMcpScan, {});
  if (!gate.allowed) {
    return { text: "This route is paused until the shared quota window resets.", isError: true };
  }
  const scan = await ctx.runAction(api.scans.actions.runScan, { repoUrl });
  if (scan.status === "failed") {
    return { text: `Scan could not start. Scan ${scan.scanId}`, isError: true };
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
