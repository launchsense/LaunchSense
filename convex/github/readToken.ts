import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";

// Reads the signed-in GitHub token for this action. Returns null for a guest.
// Callers must not log the string or put it on a return value.
export async function readSessionToken(ctx: ActionCtx): Promise<string | null> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  return await ctx.runQuery(internal.github.sessionToken.readScanToken, { userId });
}
