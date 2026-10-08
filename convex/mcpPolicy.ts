// Online policy source. Static coaching material only, no code processed.
//
// Local reads the files. Online serves the policies. The harness reads rules
// from here, guided by the skill, and the model writes the audit locally.
//
// Four tools, all closed and argument-free. No repo URL, no file reads, no
// scans, no stored code. A call is counted server-side with no gate and no
// PII: the usage row carries the method and the outcome only.

import { AI_DISCLOSURE_SHORT } from "../shared/copy/aiDisclosure.ts";
import { KNOWN_RULE_IDS } from "../shared/policies/severity.ts";

export const POLICY_PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"] as const;
export type PolicyProtocolVersion = (typeof POLICY_PROTOCOL_VERSIONS)[number];
export const POLICY_DEFAULT_VERSION: PolicyProtocolVersion = "2025-03-26";

export type PolicyToolName =
  | "launchsense_get_skill"
  | "launchsense_get_rules"
  | "launchsense_get_checklist"
  | "launchsense_get_audit_instructions";

export type PolicyUsageKind = "mcp_session_initialized" | "mcp_tools_listed" | "mcp_tool_called";

interface PolicyResult {
  status: number;
  body: unknown;
  usage: { kind: PolicyUsageKind; toolName?: string; outcome: string } | null;
}

const SKILL_TEXT =
  "LaunchSense reviews your checkout on your machine, free and unlimited. " +
  "One system: the local check. Install with ./install.sh, which copies this skill " +
  "into your coding tool and registers the local server with LAUNCHSENSE_ROOT at " +
  "your checkout. Run launchsense_scan_repo with no arguments. " +
  "Governance lives in .ls/policy.yaml next to .ls/reports. Every acceptance " +
  "names the finding and carries a reason. The not-checked list goes back as it " +
  "is, line for line. Do not summarise it. A partial result is not a pass. " +
  "The policy source for rules, checklists, and audit instructions is this address.";

const CHECKLIST_TEXT =
  "Pre-share checklist. Secrets: no keys, tokens, or private keys in tracked files. " +
  "Licenses: every dependency declares one, Unknown stays Unknown, copyleft needs a " +
  "person. Dependencies: pinned versions, OSV checked for up to 50 packages, rest not " +
  "checked. Hygiene: README, tests, CI present. Duplicates and large files listed. " +
  "Coverage: file counts stated, not-checked list quoted line for line, partial never a pass.";

const AUDIT_INSTRUCTIONS =
  "Run the local review against the working tree, including uncommitted work. " +
  "Read every check family: secrets, risky code, deps, licenses, hygiene, duplicates, " +
  "large files. Apply .ls/policy.yaml acceptances by fingerprint, rule and path, or " +
  "rule alone, each with a reason; refuse sandbag files whole. Write the report copy " +
  "to .ls/reports. Repeat findings, coverage line, and the not-checked list as they " +
  "are. Explain a fixed finding in plain words. Reorder inside one severity band only " +
  "when a lane is configured. Suggest a licence id only through the guarded lookup.";

function rulesText(): string {
  const ids = [...KNOWN_RULE_IDS].sort();
  const shown = ids.slice(0, 80).join(", ");
  const more = ids.length > 80 ? `, and ${ids.length - 80} more` : "";
  return (
    "Check families: secrets, risky code, dependencies, licenses, project hygiene, " +
    "duplicate files, large files. OSV covers up to 50 packages, rest not checked. " +
    `Rule ids (${ids.length}): ${shown}${more}. ` +
    "Severity comes from a fixed table. " +
    AI_DISCLOSURE_SHORT
  );
}

export function policyToolDefs(): Array<{ name: PolicyToolName; description: string; inputSchema: unknown }> {
  const closed = { type: "object", properties: {}, additionalProperties: false };
  return [
    {
      name: "launchsense_get_skill",
      description: "Read what the LaunchSense skill covers and how to install it. Static text, no arguments.",
      inputSchema: closed,
    },
    {
      name: "launchsense_get_rules",
      description: "Read the check families, rule ids, and severity policy. Static text, no arguments.",
      inputSchema: closed,
    },
    {
      name: "launchsense_get_checklist",
      description: "Read the pre-share checklist. Static text, no arguments.",
      inputSchema: closed,
    },
    {
      name: "launchsense_get_audit_instructions",
      description: "Read how to run the local audit and report it. Static text, no arguments.",
      inputSchema: closed,
    },
  ];
}

export function policyToolText(name: PolicyToolName): string {
  switch (name) {
    case "launchsense_get_skill":
      return SKILL_TEXT;
    case "launchsense_get_rules":
      return rulesText();
    case "launchsense_get_checklist":
      return CHECKLIST_TEXT;
    case "launchsense_get_audit_instructions":
      return AUDIT_INSTRUCTIONS;
  }
}

export function negotiatePolicyProtocol(version: unknown): PolicyProtocolVersion {
  if (typeof version === "string" && (POLICY_PROTOCOL_VERSIONS as readonly string[]).includes(version)) {
    return version as PolicyProtocolVersion;
  }
  return POLICY_DEFAULT_VERSION;
}

function error(id: unknown, code: number, message: string, usage: PolicyResult["usage"] = null): PolicyResult {
  return { status: 400, body: { jsonrpc: "2.0", id: id ?? null, error: { code, message } }, usage };
}

// handlePolicyMessage answers one JSON-RPC message with static policy text.
// The returned usage descriptor lets the route count the call without ever
// seeing file text, because there is none to see.
export async function handlePolicyMessage(body: unknown): Promise<PolicyResult> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return error(null, -32600, "Send one JSON-RPC message.");
  }
  const msg = body as Record<string, unknown>;
  if (msg["jsonrpc"] !== "2.0") {
    return error(msg["id"], -32600, "Invalid Request.");
  }
  const method = msg["method"];
  const id = msg["id"] ?? null;
  const hasId = Object.hasOwn(msg, "id");

  if (method === "initialize") {
    const params = (msg["params"] ?? {}) as Record<string, unknown>;
    const version = negotiatePolicyProtocol(params["protocolVersion"]);
    return {
      status: 200,
      body: {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: version,
          capabilities: { tools: {} },
          serverInfo: { name: "launchsense-policy", version: "0.1.0" },
        },
      },
      usage: { kind: "mcp_session_initialized", outcome: "ok" },
    };
  }
  if (method === "ping") {
    return { status: 200, body: { jsonrpc: "2.0", id, result: {} }, usage: null };
  }
  if (method === "notifications/initialized") {
    return { status: 202, body: null, usage: null };
  }
  if (!hasId) {
    return { status: 202, body: null, usage: null };
  }
  if (method === "tools/list") {
    return {
      status: 200,
      body: { jsonrpc: "2.0", id, result: { tools: policyToolDefs() } },
      usage: { kind: "mcp_tools_listed", outcome: "ok" },
    };
  }
  if (method === "tools/call") {
    const params = (msg["params"] ?? {}) as Record<string, unknown>;
    const name = params["name"];
    if (typeof name !== "string") {
      return error(id, -32602, "Invalid tool call.", { kind: "mcp_tool_called", outcome: "protocol_error" });
    }
    if (!policyToolDefs().some((d) => d.name === name)) {
      return error(id, -32602, `Unknown tool: ${name}`, { kind: "mcp_tool_called", toolName: "other", outcome: "protocol_error" });
    }
    const args = params["arguments"];
    if (args !== undefined && (args === null || typeof args !== "object" || Array.isArray(args))) {
      return error(id, -32602, "Invalid arguments.", { kind: "mcp_tool_called", toolName: name, outcome: "protocol_error" });
    }
    if (args !== undefined && Object.keys(args).length > 0) {
      return error(id, -32602, "This tool takes no arguments.", { kind: "mcp_tool_called", toolName: name, outcome: "protocol_error" });
    }
    return {
      status: 200,
      body: {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: policyToolText(name as PolicyToolName) }], isError: false },
      },
      usage: { kind: "mcp_tool_called", toolName: name, outcome: "ok" },
    };
  }
  return error(id, -32601, "Method not found.");
}
