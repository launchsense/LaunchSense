// What may never reach an analytics row, in code rather than in policy.
//
// Two of these are the OpenTelemetry MCP semantic convention's own Opt-In
// attributes. The spec attaches a WARNING to each: they "may contain sensitive
// information". Here the argument to a scan is a repository URL, so honouring
// the Opt-In would turn the event table into a list of whose code you read.
//
// The rest is this product's own boundary: a path, a title and a snippet are
// customer code structure, and a raw error message is unreviewed free text that
// can carry anything. The mixpanel rule applies: no unreviewed free text on the
// analytics stream.
//
// Deliberately absent from this list, and worth saying why:
//   - The caller's network address. The OTel spec recommends client.address for
//     tracing. This is a divergence: the value stays in the rate limiter and is
//     never persisted to an event row.
//   - Model names and prompt text. providerCalls owns those, with its own
//     governance, so one leak cannot reach model or prompt data from here.

/**
 * Property names that may never appear on an analytics row, whatever the caller.
 *
 * Every name is lower case, because the check lower-cases a key before comparing.
 * A camelCase entry here would never match, which is the same as not listing it.
 */
export const FORBIDDEN_PROPERTIES: readonly string[] = [
  // OpenTelemetry Opt-In. Refused, not merely omitted.
  "gen_ai.tool.call.arguments",
  "gen_ai.tool.call.result",
  "gen_ai.prompt.variable.name",
  "gen_ai.prompt.variable.value",
  "mcp.resource.uri",
  // Customer code structure.
  "path",
  "paths",
  "content",
  "contents",
  "snippet",
  "redactedsnippet",
  "title",
  "why",
  "line",
  "filecontent",
  // Repo identity in the clear.
  "owner",
  "repo",
  "repourl",
  "sha",
  "url",
  // Free text and credentials.
  "errormessage",
  "arguments",
  "result",
  "accesstoken",
  "clientaddress",
];

/** Every forbidden name this bag carries. */
export function forbiddenPropertiesIn(bag: Record<string, unknown>): string[] {
  return Object.keys(bag)
    .map((key) => key.toLowerCase())
    .filter((key) => FORBIDDEN_PROPERTIES.includes(key));
}

/** True when the bag can be written as an analytics row. */
export function isWritableAnalyticsBag(bag: Record<string, unknown>): boolean {
  return forbiddenPropertiesIn(bag).length === 0;
}

/**
 * Hash a repo identity into the day-scoped key an analytics row may carry.
 *
 * The secret is the deployment salt and the day is inside the signed message, so
 * two rows on the same day join and nothing joins across days. A raw private repo
 * name stored beside a stable caller id is the single most damaging thing this
 * dataset could leak.
 *
 * An unset or short salt yields no key at all. A row with no repoKey is honest; a
 * row with a raw repo name is not. Returns null rather than throwing, so a missing
 * salt can never fail a tool call.
 */
export async function repoKeyFor(
  salt: string | undefined,
  day: string,
  owner: string,
  repo: string,
): Promise<string | null> {
  if (typeof salt !== "string" || salt.length < 16) return null;
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) return null;
  try {
    const key = await subtle.importKey(
      "raw",
      new TextEncoder().encode(salt),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${day}:${owner}/${repo}`),
    );
    const bytes = new Uint8Array(signature);
    let out = "";
    for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
    return out;
  } catch {
    return null;
  }
}