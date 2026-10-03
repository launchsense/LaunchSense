import { httpRouter } from "convex/server";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { components, api } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";

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
    name: "launchsense_scan_public_repo",
    description: "Run a guest scan on one public GitHub repository. No account required.",
    inputSchema: {
      repoUrl: "https://github.com/owner/repo",
    },
  },
  {
    name: "launchsense_get_report",
    description: "Read a redacted LaunchSense report by scan id.",
    inputSchema: {
      scanId: "convex scan id",
    },
  },
  {
    name: "launchsense_explain_findings",
    description: "Explain existing findings in plain words using the validated AI lane or fixed wording.",
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
