// The bounds, the protocol versions, and the small shared types for the local
// LaunchSense MCP server. One module holds them so every other module reads the
// same numbers instead of repeating them.

// One JSON-RPC message is one line of JSON with no length header, so the line
// itself is the only bound on memory. 4 MiB is far above any message this
// server sends or receives. A longer line is refused before its bytes are kept,
// and the rest of it is drained so the next message still starts on a newline.
export const maxMessageBytes = 4 << 20;

// One report body from the API. A body that reaches this limit is reported as a
// partial answer, never returned as a whole report.
export const maxReportBytes = 1 << 20;

// One call to the LaunchSense API. review-entry.ts gives its own fetch the same
// 8 seconds, so the two surfaces give up at the same moment.
export const apiTimeoutMs = 8_000;

// The local review subprocess. The review is a node script that may reach the
// network for OSV, so it is slower than an API call. It is a budget on the
// review itself, so a review that never finishes cannot live for ever.
export const reviewTimeoutMs = 10 * 60_000;

// The protocol versions this server negotiates. It is the same four the hosted
// surface serves (convex/mcpHttp.ts), so one client library works against both.
export const supportedProtocolVersions = [
  "2024-11-05",
  "2025-03-26",
  "2025-06-18",
  "2025-11-25",
];

// Answered when the client asks for nothing, or for something this server does
// not implement. A client that asked for a version this server does not have is
// answered with one it does, rather than refused.
export const defaultProtocolVersion = "2025-03-26";

// The production website, used when LAUNCHSENSE_API_URL is unset.
export const defaultApiUrl = "https://harmless-chihuahua-667.convex.site";

// One JSON-RPC error. Code and message are the only members the spec defines.
export interface RpcError {
  code: number;
  message: string;
}
