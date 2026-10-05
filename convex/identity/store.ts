// The credential store: mint, revoke, and resolve a bearer token.
//
// Three functions, and the shape of each is the point:
//
//   mintCredential   internal. Server/admin only. Returns the token exactly once.
//   revokeCredential internal. Immediate, because revoked is read on every resolve.
//   resolveToken     internal query. One indexed read, then a constant-time compare.
//
// Bootstrap issuance has no UI. `mintCredential` is an internal mutation, so it
// is reachable from a Convex dashboard, a script, or another server function and
// from nowhere else: there is no public function that mints a credential, and no
// route that accepts one. That is the honest alpha shape. The migration path
// changes only where the token comes from: OAuth 2.1 with this server as the
// resource server, RFC 9728 discovery, RFC 8707 audience binding, and the token's
// `sub` becomes callerId. Everything downstream, the quota keys, the scan
// columns, and the metric, is unchanged.

import { internalMutation, internalQuery } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import {
  MCP_RESOURCE_URI,
  hashToken,
  mintCredentialMaterial,
  resolveCredential,
} from "./credential";

/** The fields a resolve reads. Never the token, and never the raw row. */
type StoredCredential = {
  callerId: string;
  tokenHash: string;
  userId?: string;
  declaredHarness?: string;
  verifiedBinding?: string;
  audience: string;
  revoked: boolean;
};

/**
 * One indexed read on publicId, projected to exactly the fields the resolve
 * needs.
 *
 * Projected rather than returning the row because a resolve has no business
 * seeing createdAt or lastUsedAt, and a wider return type is a wider thing to get
 * wrong later.
 */
async function readCredential(ctx: QueryCtx, publicId: string): Promise<StoredCredential | null> {
  const row = await ctx.db
    .query("credentials")
    .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
    .unique();
  if (row === null) return null;
  return {
    callerId: row._id,
    tokenHash: row.tokenHash,
    userId: row.userId,
    declaredHarness: row.declaredHarness,
    verifiedBinding: row.verifiedBinding,
    audience: row.audience,
    revoked: row.revoked === true,
  };
}

export const mintCredential = internalMutation({
  // No publicId, no hash, no audience, and no revoked flag from the caller. Every
  // value that ends up in a key or in an access decision is minted here.
  args: {
    userId: v.optional(v.id("users")),
    declaredHarness: v.optional(v.string()),
  },
  returns: v.object({
    callerId: v.id("credentials"),
    publicId: v.string(),
    token: v.string(),
    createdAt: v.number(),
  }),
  handler: async (ctx, args): Promise<{
    callerId: Id<"credentials">;
    publicId: string;
    token: string;
    createdAt: number;
  }> => {
    const material = mintCredentialMaterial();
    const tokenHash = await hashToken(material.token);
    // No hash means no crypto. A row carrying a placeholder hash is a credential
    // that could never verify, so refuse rather than write one.
    if (tokenHash === null) throw new Error("Could not mint a credential here.");

    const createdAt = Date.now();
    const callerId = await ctx.db.insert("credentials", {
      // Plaintext on purpose: it is the lookup prefix, and resolution is one
      // indexed read because of it.
      publicId: material.publicId,
      // The hash of the full token, never the token.
      tokenHash,
      userId: args.userId,
      // Recorded at issuance, by the operator, so a leaked harness can be named.
      // It is a claim and nothing reads it for policy.
      declaredHarness: args.declaredHarness,
      // verifiedBinding is left absent. There is no server-observed binding to a
      // person on this path; see the header of ./credential.ts.
      audience: MCP_RESOURCE_URI,
      revoked: false,
      createdAt,
    });

    // The only moment the raw token exists outside the caller's own hands. It is
    // written nowhere, logged nowhere, and cannot be recovered afterwards.
    return { callerId, publicId: material.publicId, token: material.token, createdAt };
  },
});

export const revokeCredential = internalMutation({
  args: { callerId: v.id("credentials") },
  returns: v.object({ callerId: v.id("credentials"), revokedAt: v.number() }),
  handler: async (ctx, args) => {
    const revokedAt = Date.now();
    await ctx.db.patch("credentials", args.callerId, { revoked: true, revokedAt });
    return { callerId: args.callerId, revokedAt };
  },
});

/** Why a resolve refused. A named reason, never the presented value. */
export const RESOLVE_FAILURES = [
  "missing",
  "malformed",
  "unknown_credential",
  "revoked",
  "audience_mismatch",
] as const;
export type ResolveFailure = (typeof RESOLVE_FAILURES)[number];

export const resolveToken = internalQuery({
  // The raw token arrives as an argument, and is never stored, logged, or
  // returned. The caller passes what the Authorization header carried.
  args: { token: v.optional(v.string()) },
  returns: v.object({
    resolved: v.boolean(),
    callerId: v.optional(v.id("credentials")),
    userId: v.optional(v.id("users")),
    declaredHarness: v.optional(v.string()),
    verifiedBinding: v.optional(v.string()),
    failure: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const outcome = await resolveCredential(
      args.token ?? null,
      (publicId) => readCredential(ctx, publicId),
      { audience: MCP_RESOURCE_URI },
    );
    if (!outcome.ok) {
      // The failure name is safe to return and useful to the route: it decides
      // between "no credential presented" and "credential refused", and both
      // are a 401 with the same header.
      return { resolved: false, failure: outcome.failure };
    }
    const credential = outcome.credential;
    return {
      resolved: true,
      callerId: credential.callerId as Id<"credentials">,
      userId: credential.userId as Id<"users"> | undefined,
      // Recorded so the metric can split by harness, labelled a claim. No access
      // decision and no rate limit key reads either field.
      declaredHarness: credential.declaredHarness,
      verifiedBinding: credential.verifiedBinding,
    };
  },
});

/** Touch the last-used stamp. Best effort: a failed write never fails a scan. */
export const markCredentialUsed = internalMutation({
  args: { callerId: v.id("credentials") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("credentials", args.callerId, { lastUsedAt: Date.now() });
    return null;
  },
});

export type { StoredCredential };