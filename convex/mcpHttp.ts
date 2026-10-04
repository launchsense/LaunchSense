// Hosted MCP (Model Context Protocol) for the public read.
// One POST returns one JSON answer. Convex does not keep a socket open.

export const MCP_PUBLIC_URL = "https://harmless-chihuahua-667.convex.site/mcp";

const PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"] as const;
type ProtocolVersion = (typeof PROTOCOL_VERSIONS)[number];

export type ToolName = "launchsense_scan_public" | "launchsense_get_report";

export type ToolCall = {
  text: string;
  isError: boolean;
};

export type McpHttpResult =
  | { status: 202; body: null }
  | { status: number; body: Record<string, unknown> };

type ToolHandler = (name: ToolName, args: Record<string, unknown>) => Promise<ToolCall>;

type HandledMethod = "initialize" | "ping" | "tools/list" | "tools/call";

const TOOLS: Array<{ name: ToolName; description: string; inputSchema: Record<string, unknown> }> = [
  {
    name: "launchsense_scan_public",
    description:
      "Read one public GitHub repository on the LaunchSense server. Same caps as the website paste: 200 files and about 2MB. Does not read a repo that exists only on the caller laptop. Alpha has no login.",
    inputSchema: {
      type: "object",
      properties: {
        repoUrl: { type: "string", description: "https://github.com/owner/repo" },
      },
      required: ["repoUrl"],
    },
  },
  {
    name: "launchsense_get_report",
    description:
      "Read a LaunchSense report by scan id. A partial result is not a pass. The coverage line says what was not read.",
    inputSchema: {
      type: "object",
      properties: {
        scanId: { type: "string" },
      },
      required: ["scanId"],
    },
  },
];

export function wantsEventStream(accept: string): boolean {
  return accept.includes("text/event-stream") && !accept.includes("application/json");
}

export function formatPublicScan(report: {
  scanId: string;
  status: string;
  coverageNote: string | null;
  findingCount: number;
  findings: Array<{ ruleId: string; severity: string; title: string; path: string; line: number | null }>;
}): string {
  const lines = [
    `Scan ${report.scanId}`,
    `Status: ${report.status}`,
    `Coverage: ${report.coverageNote ?? "not recorded"}`,
    `Findings listed: ${report.findingCount}`,
  ];
  for (const finding of report.findings) {
    const line = finding.line === null ? "" : `:${finding.line}`;
    lines.push(`- ${finding.severity} ${finding.ruleId} ${finding.path}${line} ${finding.title}`);
  }
  lines.push("A partial result is not a pass.");
  return lines.join("\n");
}

export function formatReport(report: {
  scanId: string;
  sha: string | null;
  status: string;
  coverageNote: string | null;
  findingCount: number;
  findings: Array<{ ruleId: string; severity: string; title: string; path: string; line: number | null }>;
}): string {
  const lines = [
    `Scan ${report.scanId}`,
    `Commit: ${report.sha ?? "not recorded"}`,
    `Status: ${report.status}`,
    `Coverage: ${report.coverageNote ?? "not recorded"}`,
    `Findings listed: ${report.findingCount}`,
  ];
  for (const finding of report.findings) {
    const line = finding.line === null ? "" : `:${finding.line}`;
    lines.push(`- ${finding.severity} ${finding.ruleId} ${finding.path}${line} ${finding.title}`);
  }
  lines.push("A partial result is not a pass.");
  return lines.join("\n");
}

export async function handleMcpMessage(body: unknown, callTool: ToolHandler): Promise<McpHttpResult> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return rpcError(null, 400, -32600, "Send one JSON-RPC object.");
  }
  const record = body as Record<string, unknown>;
  const hasId = Object.prototype.hasOwnProperty.call(record, "id") && record.id !== null && record.id !== undefined;
  const method = typeof record.method === "string" ? record.method : "";
  if (method.startsWith("notifications/") || method === "initialized") {
    return hasId ? rpcResult(record.id, {}) : { status: 202, body: null };
  }
  if (!hasId) return { status: 202, body: null };
  if (!isHandledMethod(method)) return rpcError(record.id, 200, -32601, "Method not found.");

  switch (method) {
    case "initialize":
      return rpcResult(record.id, {
        protocolVersion: supportedVersion(record.params),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "launchsense", version: "0.1.0" },
      });
    case "ping":
      return rpcResult(record.id, {});
    case "tools/list":
      return rpcResult(record.id, { tools: TOOLS });
    case "tools/call": {
      const parsed = toolCall(record.params);
      if (parsed === null) return rpcError(record.id, 200, -32602, "Invalid tool call.");
      if (!isToolName(parsed.name)) {
        return rpcResult(record.id, toolText(`Unknown tool ${parsed.name}.`, true));
      }
      const called = await callTool(parsed.name, parsed.args);
      return rpcResult(record.id, toolText(called.text, called.isError));
    }
    default: {
      const _never: never = method;
      return _never;
    }
  }
}

function isHandledMethod(method: string): method is HandledMethod {
  switch (method) {
    case "initialize":
    case "ping":
    case "tools/list":
    case "tools/call":
      return true;
    default:
      return false;
  }
}

function isToolName(name: string): name is ToolName {
  switch (name) {
    case "launchsense_scan_public":
    case "launchsense_get_report":
      return true;
    default:
      return false;
  }
}

function supportedVersion(params: unknown): ProtocolVersion {
  if (typeof params !== "object" || params === null) return "2025-03-26";
  const version = (params as Record<string, unknown>).protocolVersion;
  if (typeof version === "string" && (PROTOCOL_VERSIONS as readonly string[]).includes(version)) {
    return version as ProtocolVersion;
  }
  return "2025-03-26";
}

function toolCall(params: unknown): { name: string; args: Record<string, unknown> } | null {
  if (typeof params !== "object" || params === null) return null;
  const record = params as Record<string, unknown>;
  if (typeof record.name !== "string" || record.name.length === 0) return null;
  if (record.arguments === undefined) return { name: record.name, args: {} };
  if (typeof record.arguments === "object" && record.arguments !== null && !Array.isArray(record.arguments)) {
    return { name: record.name, args: record.arguments as Record<string, unknown> };
  }
  return null;
}

function toolText(text: string, isError: boolean): Record<string, unknown> {
  return {
    content: [{ type: "text", text }],
    isError,
  };
}

function rpcResult(id: unknown, result: unknown): McpHttpResult {
  return { status: 200, body: { jsonrpc: "2.0", id, result } };
}

function rpcError(id: unknown, status: number, code: number, message: string): McpHttpResult {
  return { status, body: { jsonrpc: "2.0", id, error: { code, message } } };
}
