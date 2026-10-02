import { defineSchema } from "convex/server";
import { authTables } from "@convex-dev/auth/server";

// Product tables are added alongside the features that need them.
export default defineSchema({ ...authTables });
