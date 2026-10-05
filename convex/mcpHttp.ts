// Hosted MCP (Model Context Protocol) for the public read.
// One POST returns one JSON answer. Convex does not keep a socket open.

export const MCP_PUBLIC_URL = "https://harmless-chihuahua-667.convex.site/mcp";

const PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"] as const;
type ProtocolVersion = (typeof PROTOCOL_VERSIONS)[number];

export type ToolName = "launchsense_scan_public" | "launchsense_get_report";

export type ToolCall = {
  text: string;
  isError: boolean;
  /** Set when the shared quota refused the call. Never the raw error text. */
  outcome?: "quota_denied";
  /**
   * The day-scoped hash of the repo this call read, computed by the caller.
   *
   * A hash, or nothing. The raw owner/repo never leaves the scan tool, and the
   * protocol layer only forwards what it was handed.
   */
  repoKey?: string;
};

// Which harness is calling. clientInfo.name is client-declared, so it is
// attacker-controlled: one caller sending a fresh random name per initialize
// would otherwise fill the table with dimensions nobody can aggregate. The map
// is fixed and closed. Anything unrecognised becomes "other", never a new value.
export const CLIENT_NAMES = [
  "cursor",
  "claude_code",
  "claude_desktop",
  "codex",
  "vscode",
  "windsurf",
  "other",
  "unknown",
] as const;
export type ClientName = (typeof CLIENT_NAMES)[number];

// Normalised client-declared name to the value we store. Normalisation strips
// case and punctuation, so "Claude Code", "claude-code" and "ClaudeCode" are one
// dimension rather than three.
const CLIENT_ALLOWLIST: Record<string, ClientName> = {
  cursor: "cursor",
  claudecode: "claude_code",
  claudedesktop: "claude_desktop",
  claudeapp: "claude_desktop",
  codex: "codex",
  openaicodex: "codex",
  codexcli: "codex",
  vscode: "vscode",
  visualstudiocode: "vscode",
  windsurf: "windsurf",
  windsurfnext: "windsurf",
  code: "vscode",
};

function normalizeClientName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The allowlist check, in code rather than in policy.
 *
 * The raw name is never stored, never logged, and never returned. An absent or
 * unusable name is "unknown" rather than a guess, so a caller that sends
 * nonsense widens nothing.
 */
export function allowlistedClientName(raw: unknown): ClientName {
  const key = normalizeClientName(raw);
  if (key.length === 0) return "unknown";
  return CLIENT_ALLOWLIST[key] ?? "other";
}

// Version is client-declared too. It is kept because a harness version is the
// fastest way to explain a protocol change, and it is bounded: anything that does
// not look like a version is dropped rather than stored, so it cannot become a
// free-text field or a dimension.
const CLIENT_VERSION_SHAPE = /^[A-Za-z0-9.+_-]{1,32}$/;
export function allowlistedClientVersion(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!CLIENT_VERSION_SHAPE.test(trimmed)) return undefined;
  return trimmed;
}

function clientInfoOf(params: unknown): { name: ClientName; version: string | undefined } {
  if (typeof params !== "object" || params === null) {
    return { name: "unknown", version: undefined };
  }
  const info = (params as Record<string, unknown>).clientInfo;
  if (typeof info !== "object" || info === null || Array.isArray(info)) {
    return { name: "unknown", version: undefined };
  }
  const record = info as Record<string, unknown>;
  return {
    name: allowlistedClientName(record.name),
    version: allowlistedClientVersion(record.version),
  };
}

// Property names below are the OpenTelemetry MCP semantic conventions, kept
// verbatim so a row can be exported to an OTel-aware backend with no translation
// layer. The four Opt-In attributes are refused and never reach this table.
export type McpUsageEvent = {
  kind: "mcp_session_initialized" | "mcp_tools_listed" | "mcp_tool_called";
  /** mcp.method.name */
  mcpMethodName: "initialize" | "tools/list" | "tools/call";
  /** gen_ai.tool.name. Absent for initialize and tools/list. */
  toolName?: ToolName;
  clientName: ClientName;
  clientVersion?: string;
  /** mcp.protocol.version, the version actually answered. */
  protocolVersion: ProtocolVersion;
  /** Spans the outcome: OK for ok, ERROR for the other three. */
  outcome: "ok" | "tool_error" | "protocol_error" | "quota_denied";
  /** error.type. "tool_error" when CallToolResult.isError, else the JSON-RPC code. */
  errorType?: string;
  /** rpc.response.status.code, for -32600, -32601, -32602. */
  rpcResponseStatusCode?: number;
  durationMs: number;
  /** The day-scoped hash of the repo this call read. Never the literal. */
  repoKey?: string;
};

/**
 * One usage event per protocol action.
 *
 * Awaited by the protocol layer, not fired and forgotten. An httpAction that
 * returns before its write settles can drop that write entirely, and a metric that
 * quietly loses rows looks like a drop in traffic. A reporter that throws must not
 * fail the caller's answer, so that decision belongs to the caller, not here.
 */
export type McpUsageReporter = (event: McpUsageEvent) => void | Promise<void>;

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

/**
 * One JSON-RPC message in, one answer out.
 *
 * `report` is optional and receives one usage event per protocol action. It is a
 * callback, not a database call, so this module stays free of any Convex import
 * and can be read as plain protocol code. The caller decides whether a reported
 * event becomes a stored row.
 *
 * Report on failures too. An unknown tool and a quota refusal are the two facts
 * this surface most needs to know about, and neither appears anywhere else.
 */
export async function handleMcpMessage(
  body: unknown,
  callTool: ToolHandler,
  report?: McpUsageReporter,
): Promise<McpHttpResult> {
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  const emit = async (event: McpUsageEvent) => {
    if (report === undefined) return;
    await report(event);
  };

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    // No method to name, so this is counted against no dimension rather than
    // guessed into one.
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
    case "initialize": {
      const client = clientInfoOf(record.params);
      const protocolVersion = supportedVersion(record.params);
      await emit({
        kind: "mcp_session_initialized",
        mcpMethodName: "initialize",
        clientName: client.name,
        clientVersion: client.version,
        protocolVersion,
        outcome: "ok",
        durationMs: elapsed(),
      });
      return rpcResult(record.id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "launchsense", version: "0.1.0" },
      });
    }
    case "ping":
      return rpcResult(record.id, {});
    case "tools/list": {
      // clientInfo is read here too. A stateless POST carries no session, so the
      // only honest source of which harness is calling is whatever the caller
      // repeats; absent that, the event is "unknown" rather than a guess.
      const client = clientInfoOf(record.params);
      await emit({
        kind: "mcp_tools_listed",
        mcpMethodName: "tools/list",
        clientName: client.name,
        clientVersion: client.version,
        protocolVersion: supportedVersion(record.params),
        outcome: "ok",
        durationMs: elapsed(),
      });
      return rpcResult(record.id, { tools: TOOLS });
    }
    case "tools/call": {
      const client = clientInfoOf(record.params);
      const protocolVersion = supportedVersion(record.params);
      const parsed = toolCall(record.params);
      if (parsed === null) {
        await emit({
          kind: "mcp_tool_called",
          mcpMethodName: "tools/call",
          clientName: client.name,
          clientVersion: client.version,
          protocolVersion,
          outcome: "protocol_error",
          errorType: "-32602",
          rpcResponseStatusCode: -32602,
          durationMs: elapsed(),
        });
        return rpcError(record.id, 200, -32602, "Invalid tool call.");
      }
      if (!isToolName(parsed.name)) {
        // The declared name is echoed to the caller, but it is client-declared
        // free text, so it is never stored as a dimension.
        await emit({
          kind: "mcp_tool_called",
          mcpMethodName: "tools/call",
          clientName: client.name,
          clientVersion: client.version,
          protocolVersion,
          outcome: "protocol_error",
          errorType: "unknown_tool",
          durationMs: elapsed(),
        });
        return rpcResult(record.id, toolText(`Unknown tool ${parsed.name}.`, true));
      }
      const called = await callTool(parsed.name, parsed.args);
      await emit({
        kind: "mcp_tool_called",
        mcpMethodName: "tools/call",
        toolName: parsed.name,
        clientName: client.name,
        clientVersion: client.version,
        protocolVersion,
        outcome: called.outcome ?? (called.isError ? "tool_error" : "ok"),
        errorType: called.isError ? "tool_error" : undefined,
        durationMs: elapsed(),
        repoKey: called.repoKey,
      });
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
