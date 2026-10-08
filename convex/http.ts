import { httpRouter } from "convex/server";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { components } from "./_generated/api";
import { httpAction } from "./_generated/server";

const http = httpRouter();
http.route({
  path: "/api/health",
  method: "GET",
  handler: httpAction(async () => Response.json({ status: "ok", service: "launchsense" })),
});

// Exact health route wins over this static site fallback.
// Archived: hosted scan, MCP protocol, usage, share, passport, licence, and
// sign-in routes went with the web scan. The site is a position page and the
// check runs on your machine.
registerStaticRoutes(http, components.staticHosting);
export default http;
