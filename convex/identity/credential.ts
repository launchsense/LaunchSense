// The identifier the caller must present, and the rules for believing it.
//
// This module is pure on purpose: no Convex import, no database, no network.
// Every rule that decides whether a caller is who they say they are lives here
// so a test can drive it with a real fake rather than read it as text.
//
// The design is in three layers that never collapse into one another:
//
//   callerId         server-minted, resolved from a bearer token. Used for quota,
//                    attribution, and ownership. The only layer with authority.
//   declaredHarness  a label, recorded as a claim. Never an access decision, never
//                    a rate limit key. One caller sending a fresh label per request
//                    must not be able to widen a dimension or gain a budget.
//   verifiedBinding  a server-observed fact tying a credential to a person or an
//                    installation. It is null today and stays null: a scan reads
//                    public repositories through the server's own GitHub token, so
//                    there is nothing about the call that identifies a person. A
//                    GitHub App installation path would produce one. Until that
//                    exists, every harness-level number is a claim.
//
// What this module refuses to do:
//   - accept a session id as a credential (MCP security best practices forbid it)
//   - accept a client-declared string as identity
//   - compare a secret in anything other than constant time
//   - return the raw token, or any part of it, from a resolve

/**
 * The canonical MCP server URI. This is the audience a credential is minted for
 * and the resource a token must name. It is the value the hosted address is
 * reachable at, so a token minted for it cannot be replayed against a different
 * server, which is the point of RFC 8707 resource indicators.
 */
export const MCP_RESOURCE_URI = "https://harmless-chihuahua-667.convex.site/mcp";

/**
 * RFC 9728 protected resource metadata, at the well-known path derived from the
 * resource identifier.
 *
 * Deriving it from the resource rather than hand-writing it is what RFC 9728 is
 * for: an attacker cannot publish metadata that claims to describe this resource
 * and is not authoritative for it. There is no authorization server behind it
 * today, so the document says so, and it advertises no issuer it cannot honour.
 */
export const PROTECTED_RESOURCE_METADATA_URL =
  "https://harmless-chihuahua-667.convex.site/.well-known/oauth-protected-resource/mcp";

/** The token prefix. A credential that does not start with this is not one. */
export const TOKEN_PREFIX = "ls_live";

// 16 bytes of hex for the public id. It is a lookup prefix, not a secret: it is
// stored in plaintext precisely so resolution is one indexed read.
const PUBLIC_ID_BYTES = 8;
// 32 bytes of hex for the secret. 256 bits of server-generated randomness, which
// is why SHA-256 rather than a slow KDF is the right hash for the whole token.
const SECRET_BYTES = 32;

const HEX = "0123456789abcdef";

/**
 * Hex from a byte source, with no dependency on a runtime Buffer.
 *
 * `crypto.getRandomValues` is the only entropy source here. It is a global in the
 * Convex runtime and in Node, and it is a CSPRNG in both, so there is no path by
 * which this function returns a guessable token.
 */
export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += HEX[byte >> 4] + HEX[byte & 15];
  return out;
}

/**
 * A fresh credential: the publicId, the secret, and the assembled token.
 *
 * Returned exactly once, at issuance, and never stored in this shape. The
 * caller hands the token to the operator over whatever channel they already
 * trust, and the row keeps only the hash.
 */
export function mintCredentialMaterial(): {
  publicId: string;
  secret: string;
  token: string;
} {
  const publicId = randomHex(PUBLIC_ID_BYTES);
  const secret = randomHex(SECRET_BYTES);
  return { publicId, secret, token: `${TOKEN_PREFIX}_${publicId}_${secret}` };
}

function randomHex(byteLength: number): string {
  const subtle = globalThis.crypto;
  if (subtle === undefined || typeof subtle.getRandomValues !== "function") {
    // Failing closed matters more than failing open. A credential minted from a
    // non-CSPRNG would be guessable, so there is no fallback.
    throw new Error("No cryptographic random source is available.");
  }
  const bytes = new Uint8Array(byteLength);
  subtle.getRandomValues(bytes);
  return toHex(bytes);
}

/**
 * SHA-256 of the full token, as 64 hex characters.
 *
 * SHA-256 rather than Argon2id or bcrypt on purpose. The input is 256 bits of
 * server-generated randomness, not a user-chosen password, so there is no
 * dictionary to attack and no reason to make every resolve expensive. apikeys.guide
 * is explicit that a generated key carrying 128 or more bits of entropy does not
 * need a slow function, and OWASP's own page warns that a high work factor across
 * many callers is itself a denial-of-service vector.
 *
 * Returns null rather than throwing when Web Crypto is missing, so a resolve can
 * fail closed instead of taking the route down.
 */
export async function hashToken(token: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) return null;
  try {
    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(token));
    return toHex(new Uint8Array(digest));
  } catch {
    return null;
  }
}

/** The credential parts, or null when the string is not a token at all. */
export type ParsedToken = { publicId: string; secret: string };

/**
 * Split a presented token into its lookup prefix and its secret.
 *
 * Returns null for anything that is not exactly `ls_live_<hex>_<hex>`. A
 * malformed token is refused rather than repaired, because there is no shape of
 * malformed token that should resolve to a caller.
 */
export function parseToken(raw: unknown): ParsedToken | null {
  if (typeof raw !== "string") return null;
  // Bounded before anything else, so a caller cannot make the server chew on a
  // megabyte of text to discover it is not a token.
  if (raw.length > 512) return null;
  const parts = raw.split("_");
  if (parts.length !== 4) return null;
  const [prefixTag, prefixName, publicId, secret] = parts as [string, string, string, string];
  if (prefixTag !== "ls" || prefixName !== "live") return null;
  if (!/^[0-9a-f]{16}$/.test(publicId)) return null;
  if (!/^[0-9a-f]{64}$/.test(secret)) return null;
  return { publicId, secret };
}

/**
 * Constant-time string comparison over equal-length inputs.
 *
 * Length is compared first, which is not a leak: the length of a SHA-256 hex
 * digest is a fixed 64 characters, so there is nothing to learn. Every
 * character is then folded into one accumulator with no early return, so a
 * mismatch does not reveal how many leading characters were right. Without this
 * the resolve endpoint becomes a hash oracle.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * The value stored in the database for a presented token.
 *
 * Separate from constantTimeEquals on purpose: this one also refuses an
 * unparseable token and an absent hash, so the caller cannot accidentally
 * compare against `undefined` and be handed `true`.
 */
export function tokenHashMatches(tokenHash: string, providedHash: string | null): boolean {
  if (typeof providedHash !== "string") return false;
  if (!/^[0-9a-f]{64}$/.test(tokenHash)) return false;
  return constantTimeEquals(tokenHash, providedHash);
}

/**
 * Read the bearer token out of an Authorization header.
 *
 * `Mcp-Session-Id` is deliberately not consulted. MCP servers MUST NOT use
 * sessions for authentication: a session id is a routing handle the client
 * replays, and treating one as a credential would let anyone holding a stale id
 * act as the caller who opened it.
 *
 * The scheme match is case-insensitive because RFC 7235 says the scheme is, and
 * the token itself is compared case-sensitively by parseToken.
 */
export function bearerTokenFromHeader(header: string | null | undefined): string | null {
  if (typeof header !== "string") return null;
  const trimmed = header.trim();
  if (trimmed.length === 0 || trimmed.length > 1024) return null;
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(trimmed);
  const token = match?.[1];
  return typeof token === "string" ? token : null;
}

/** Why a credential was refused. Never the presented value. */
export type CredentialFailure =
  | "missing"
  | "malformed"
  | "unknown_credential"
  | "revoked"
  | "audience_mismatch";

/** What the resolve produced. A callerId here is server-minted, never supplied. */
export type ResolvedCredential = {
  callerId: string;
  userId?: string;
  /** An operator label from issuance. Recorded, never consulted for policy. */
  declaredHarness?: string;
  /** Always absent today. See the module header. */
  verifiedBinding?: string;
};

/**
 * The audience check, in code.
 *
 * A credential minted for this server is usable here. A credential minted for
 * something else is not, which is what stops a token being replayed against a
 * second deployment. When this moves to a real authorization server the claim
 * moves with it: an access token carries `aud` and RFC 8707 resource
 * indicators, and this becomes the same check against a JWT.
 */
export function audienceAccepts(rowAudience: string, expected: string): boolean {
  if (typeof rowAudience !== "string" || rowAudience.length === 0) return false;
  return constantTimeEquals(rowAudience, expected);
}

/**
 * The complete resolve, given a lookup.
 *
 * `lookup` is a function rather than a direct table read so this rule can be
 * tested against a real fake store and so the same rule is used from the query
 * and from a test. It must return the row for the publicId, or null.
 *
 * Returns either a resolved credential or a named failure. It never returns the
 * token, the hash, or the raw row, so no caller of this can leak one by
 * accident.
 */
export async function resolveCredential(
  rawToken: string | null | undefined,
  lookup: (publicId: string) => Promise<CredentialRow | null>,
  options: { audience: string },
): Promise<{ ok: true; credential: ResolvedCredential } | { ok: false; failure: CredentialFailure }> {
  if (rawToken === null || rawToken === undefined || rawToken.length === 0) {
    return { ok: false, failure: "missing" };
  }
  const parsed = parseToken(rawToken);
  if (parsed === null) return { ok: false, failure: "malformed" };

  // One indexed read on the plaintext prefix. The secret is never used to find
  // the row, so a guess cannot probe for a publicId that exists.
  const row = await lookup(parsed.publicId);
  if (row === null) return { ok: false, failure: "unknown_credential" };

  // Revocation is read on every resolve, before the hash compare, so a revoked
  // credential is refused immediately rather than at the next expiry.
  if (row.revoked === true) return { ok: false, failure: "revoked" };

  if (!audienceAccepts(row.audience, options.audience)) {
    return { ok: false, failure: "audience_mismatch" };
  }

  const providedHash = await hashToken(rawToken);
  // A null hash means Web Crypto is unavailable. That is a refusal, never a pass.
  if (providedHash === null) return { ok: false, failure: "malformed" };
  if (!tokenHashMatches(row.tokenHash, providedHash)) {
    return { ok: false, failure: "unknown_credential" };
  }

  const credential: ResolvedCredential = { callerId: row.callerId };
  if (typeof row.userId === "string" && row.userId.length > 0) credential.userId = row.userId;
  // Recorded so the metric can split by harness, labelled as a claim. Nothing
  // below reads it, and no rate limit key is built from it.
  if (typeof row.declaredHarness === "string" && row.declaredHarness.length > 0) {
    credential.declaredHarness = row.declaredHarness;
  }
  // Absent today. Copied when it exists so the shape is already right when the
  // GitHub App path lands, rather than needing a migration at that point.
  if (typeof row.verifiedBinding === "string" && row.verifiedBinding.length > 0) {
    credential.verifiedBinding = row.verifiedBinding;
  }
  return { ok: true, credential };
}

/** The stored shape this module reads. Never the token. */
export type CredentialRow = {
  callerId: string;
  tokenHash: string;
  userId?: string;
  declaredHarness?: string;
  verifiedBinding?: string;
  audience: string;
  revoked: boolean;
  revokedAt?: number;
};

/**
 * The 401 body and headers.
 *
 * RFC 9728 and the MCP authorization spec both require WWW-Authenticate on a
 * 401, pointing at the protected resource metadata so a client can discover
 * where to get a token. The header names the metadata URL and nothing else: no
 * token, no hint about which part of the presented value was wrong, and no
 * issuer, because there is no authorization server behind this yet.
 */
export function unauthorizedResponse(
  reason: "missing" | "invalid",
  options: { metadataUrl?: string } = {},
): { status: 401; headers: Record<string, string>; body: Record<string, unknown> } {
  const metadataUrl = options.metadataUrl ?? PROTECTED_RESOURCE_METADATA_URL;
  return {
    status: 401,
    headers: {
      "WWW-Authenticate": `Bearer resource_metadata="${metadataUrl}", error="invalid_token"`,
      "Cache-Control": "no-store",
    },
    body: {
      error:
        reason === "missing"
          ? "This route needs a LaunchSense credential. Send Authorization: Bearer <token>."
          : "That credential was refused.",
    },
  };
}

/**
 * The headers a browser client must be allowed to send.
 *
 * Authorization is here because without it a browser-based MCP client silently
 * sends no credential at all and every request looks anonymous. That was a real
 * limitation, not a footnote: the header existed nowhere on the server.
 *
 * Mcp-Session-Id stays in the allowed list because clients send it, but nothing
 * on this server authenticates on it and the server issues none.
 */
export const MCP_ALLOWED_HEADERS = [
  "Content-Type",
  "Accept",
  "Authorization",
  "MCP-Protocol-Version",
  "Mcp-Session-Id",
] as const;

export const MCP_ALLOWED_HEADERS_VALUE = MCP_ALLOWED_HEADERS.join(", ");