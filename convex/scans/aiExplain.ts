"use node";

import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { callAiLane } from "../adapters/ai";
import { buildExplainPrompt, deterministicPlan } from "../../shared/ai/deterministic";
import { validateAiPlan } from "../../shared/ai/validate";

export const explainScan = action({
  args: { scanId: v.id("scans") },
  returns: v.object({
    scanId: v.id("scans"),
    source: v.union(
      v.literal("gemini"),
      v.literal("openrouter"),
      v.literal("deterministic"),
    ),
    explained: v.number(),
    rejected: v.boolean(),
    note: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    scanId: Id<"scans">;
    source: "gemini" | "openrouter" | "deterministic";
    explained: number;
    rejected: boolean;
    note: string;
  }> => {
    const scan = await ctx.runQuery(internal.scans.store.fetchScan, { scanId: args.scanId });
    if (scan === null || scan.analyzedAt === undefined) {
      throw new Error("Analyze the scan before asking for explanations.");
    }
    const rows = await ctx.runQuery(internal.scans.store.listFindings, { scanId: args.scanId });
    const findings = rows.map((r) => ({
      fingerprint: r.fingerprint,
      severity: r.severity,
      title: r.title,
      why: r.why,
    }));

    const prompt = buildExplainPrompt(findings);
    const call = await callAiLane(prompt);

    if (!call.ok) {
      const plan = deterministicPlan(findings);
      return {
        scanId: args.scanId,
        source: "deterministic" as const,
        explained: plan.explanations.length,
        rejected: false,
        note: "No AI provider answered. Plain wording is shown instead.",
      };
    }

    const validated = validateAiPlan(call.json, findings);
    if (!validated.ok) {
      return {
        scanId: args.scanId,
        source: "deterministic" as const,
        explained: findings.filter((f) => f.severity !== "info").length,
        rejected: true,
        note: `AI output was rejected: ${validated.reason}`,
      };
    }

    return {
      scanId: args.scanId,
      source: call.source,
      explained: validated.value.explanations.length,
      rejected: false,
      note: `Explained by ${call.model ?? "the AI provider"}.`,
    };
  },
});