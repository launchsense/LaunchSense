import { httpRouter } from "convex/server";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { components, internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { handlePolicyMessage } from "./mcpPolicy";

const http = httpRouter();
http.route({
  path: "/api/health",
  method: "GET",
  handler: httpAction(async () => Response.json({ status: "ok", service: "launchsense" })),
});

const policyCors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

// The online policy source. Static coaching material only: skill, rules,
// checklist, audit instructions. No repo URL, no file reads, no scans, no
// stored code. A call is counted with no gate and no PII.
http.route({
  path: "/mcp",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: policyCors })),
});

http.route({
  path: "/mcp",
  method: "GET",
  handler: httpAction(async () =>
    Response.json({ error: "POST a JSON-RPC message to this URL." }, { status: 405, headers: policyCors }),
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
        { status: 400, headers: { ...policyCors, "Content-Type": "application/json" } },
      );
    }
    const result = await handlePolicyMessage(body);
    // Count the call. Best effort: a failed row never fails the answer, and the
    // row carries the method and the outcome only, never file text, because
    // there is none on this route.
    if (result.usage !== null) {
      try {
        const outcome = result.usage.outcome;
        if (outcome === "ok" || outcome === "protocol_error") {
          await ctx.runMutation(internal.analytics.ingest.recordMcpUsageEvent, {
            kind: result.usage.kind,
            clientName: "unknown",
            outcome,
            ...(result.usage.toolName !== undefined ? { toolName: result.usage.toolName } : {}),
          });
        }
      } catch {
        // Counting must never be the reason a caller gets no answer.
      }
    }
    if (result.status === 202 || result.body === null) {
      return new Response(null, { status: 202, headers: policyCors });
    }
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { ...policyCors, "Content-Type": "application/json" },
    });
  }),
});

// Exact health and policy routes win over this static site fallback.
// Archived: hosted scan, report, usage, share, passport, licence, and sign-in
// routes went with the web scan. The site is a position page and the file
// review runs on your machine.
registerStaticRoutes(http, components.staticHosting);
export default http;
