import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const status = query({
  args: {},
  returns: v.object({ status: v.literal("ok") }),
  handler: async () => ({ status: "ok" as const }),
});

// Connection probe only: no database writes, identity, or analytics.
export const checkConnection = mutation({
  args: {},
  returns: v.object({ status: v.literal("ok") }),
  handler: async () => ({ status: "ok" as const }),
});
