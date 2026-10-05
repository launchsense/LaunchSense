// What a scan row records about who asked for it, and who may read it.
//
// Pure, so the rules can be tested with real fakes rather than read as text.
//
// Three layers, and the column each one lands in. Keeping them apart is the whole
// point: a single `caller` string would let a client-declared value sit next to a
// server-minted one with nothing to tell them apart.
//
//   callerId         scans.attributedCallerId. Server-minted, from a resolved
//                    credential. Ownership and quota read this.
//   declaredHarness  recorded alongside. A client-declared claim. Nothing reads it.
//   verifiedBinding  recorded alongside, absent today. A server-observed fact that
//                    cannot exist yet, because no scan path observes one.
//
// Two channels and two surfaces, and they are not the same axis. `channel` is the
// door: web, mcp, api. `surface` is the product: web, mcp_hosted. Two doors share
// the hosted MCP read, which is why the two fields exist rather than one.

export type Channel = "web" | "mcp" | "api";
export type Surface = "web" | "mcp_hosted";

/** The hosted MCP protocol endpoint and the JSON API are one surface. */
export function surfaceForChannel(channel: Channel): Surface {
  return channel === "web" ? "web" : "mcp_hosted";
}

/** What the scan row records. Named for the columns so a mistake is visible. */
export type ScanAttribution = {
  channel: Channel;
  surface: Surface;
  /** Absent when no credential resolved. */
  callerId?: string;
  /** A claim, recorded and never read for a decision. */
  declaredHarness?: string;
  /** Absent today. See the header. */
  verifiedBinding?: string;
};

/**
 * The identity a caller arrives with.
 *
 * The distinction that matters: `resolved: true` means a server-minted credential
 * was found. `callerId` absent with `resolved: true` is not possible, and
 * `resolved: false` never carries one.
 */
export type CallerIdentity = {
  resolved: boolean;
  callerId?: string;
  userId?: string;
  declaredHarness?: string;
  verifiedBinding?: string;
};

/**
 * Turn a resolve result into the fields a scan row carries.
 *
 * The `attributed: false` write is the important part. A scan with no or an
 * invalid credential is stored with attributed explicitly false rather than
 * omitted, so attributed / total is a real ratio and the headline metric cannot
 * be inflated by quietly dropping the rows that did not resolve. A row with no
 * `attributed` field at all cannot be counted honestly in either direction.
 */
export function attributionFor(
  identity: CallerIdentity,
  channel: Channel,
): ScanAttribution & { attributed: boolean } {
  const attributed = identity.resolved === true && typeof identity.callerId === "string" && identity.callerId.length > 0;
  const out: ScanAttribution & { attributed: boolean } = {
    channel,
    surface: surfaceForChannel(channel),
    attributed,
  };
  if (attributed) out.callerId = identity.callerId;
  // A declared harness on an unattributed scan is still recorded. The claim is
  // what the client said about itself, and it is worth knowing alongside the
  // fact that no credential backed it.
  if (typeof identity.declaredHarness === "string" && identity.declaredHarness.length > 0) {
    out.declaredHarness = identity.declaredHarness;
  }
  if (typeof identity.verifiedBinding === "string" && identity.verifiedBinding.length > 0) {
    out.verifiedBinding = identity.verifiedBinding;
  }
  return out;
}

/** An identity with no credential. What every anonymous caller arrives as. */
export const ANONYMOUS: CallerIdentity = { resolved: false };

/**
 * Who owns a scan row.
 *
 * Two credentials are two owners. Rotating a token does not hand the previous
 * token's scans to the new one, which is what makes "was this abused" a question
 * with an answer after a revoke.
 *
 * An unattributed scan row belongs to nobody in particular: it is a guest scan of
 * a public repository and stays id-addressed, which is the existing rule in
 * shared/reports/scanAccess.ts and is not changed here.
 */
export function callerOwnsScan(
  scan: { attributedCallerId?: string | null },
  callerId: string | null,
): boolean {
  const owner = scan.attributedCallerId ?? null;
  if (owner === null || callerId === null) return false;
  return owner === callerId;
}

/**
 * Whether an in-flight row may be handed back to this caller.
 *
 * This is the rule the old findInFlight was missing. It matched on (owner, repo)
 * with no sha and no identity, so two callers scanning the same public repository
 * at the same moment shared one row, and whichever finished second was handed a
 * scan row belonging to the first. With attribution on the row that is not a
 * shared cache entry, it is a scan owned by the wrong person, and the claim that
 * each scan attaches to the user who did it would be false.
 *
 * The rule: a caller may reuse an in-flight row only when the row belongs to that
 * caller. Anonymous callers share the anonymous pool, which is the honest shape
 * while identity is new. Anything else gets its own row.
 */
export function mayReuseInFlight(
  row: { attributedCallerId?: string | null; userId?: string | null },
  callerId: string | null,
): boolean {
  const rowCaller = row.attributedCallerId ?? null;
  if (rowCaller === null) {
    // An unattributed row carries no caller, so only an anonymous caller may
    // take it. A credentialed caller must not receive a row that belongs to
    // nobody, because it would then attach an unowned row to an owned scan.
    return callerId === null;
  }
  return callerId !== null && rowCaller === callerId;
}