"use node";

import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { callAiLane } from "../adapters/ai";
import { buildExplainPrompt, deterministicPlan } from "../../shared/ai/deterministic";
import { validateAiPlan } from "../../shared/ai/validate";
import { fnv1aHex } from "../../shared/redaction";

export const explainScan = action({
  args: { scanId: v.id("scans") },
  returns: v.object({
    scanId: v.id("scans"),
    source: v.union(
      v.literal("gemini"),
      v.literal("deterministic"),
    ),
    explained: v.number(),
    rejected: v.boolean(),
    note: v.string(),
    explanations: v.array(v.object({ fingerprint: v.string(), plain: v.string() })),
    notActionable: v.array(v.object({ fingerprint: v.string(), reason: v.string() })),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    scanId: Id<"scans">;
    source: "gemini" | "deterministic";
    explained: number;
    rejected: boolean;
    note: string;
    explanations: Array<{ fingerprint: string; plain: string }>;
    notActionable: Array<{ fingerprint: string; reason: string }>;
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
    const promptHash = fnv1aHex(prompt);
    const call = await callAiLane(prompt);
    const recordUsage = async (source: "gemini" | "deterministic", ok: boolean, errorKind?: string) => {
      await ctx.runMutation(internal.scans.store.saveProviderCall, {
        scanId: args.scanId,
        kind: "explain",
        source,
        model: source === "gemini" ? "gemini-2.0-flash" : undefined,
        latencyMs: call.latencyMs,
        promptHash,
        inputTokens: call.usage.inputTokens ?? undefined,
        outputTokens: call.usage.outputTokens ?? undefined,
        totalTokens: call.usage.totalTokens ?? undefined,
        ok,
        errorKind,
        now: Date.now(),
      });
    };

    if (!call.ok) {
      await recordUsage("deterministic", true, "no_provider");
      const plan = deterministicPlan(findings);
      return {
        scanId: args.scanId,
        source: "deterministic" as const,
        explained: plan.explanations.length,
        rejected: false,
        note: "No AI provider answered. Plain wording is shown instead.",
        explanations: plan.explanations,
        notActionable: plan.notActionable,
      };
    }

    const validated = validateAiPlan(call.json, findings);
    if (!validated.ok) {
      await recordUsage(call.source, false, "validation_rejected");
      const fallback = deterministicPlan(findings);
      return {
        scanId: args.scanId,
        source: "deterministic" as const,
        explained: fallback.explanations.length,
        rejected: true,
        note: `AI output was rejected: ${validated.reason}`,
        explanations: fallback.explanations,
        notActionable: fallback.notActionable,
      };
    }

    await recordUsage(call.source, true);
    return {
      scanId: args.scanId,
      source: call.source,
      explained: validated.value.explanations.length,
      rejected: false,
      note: `Explained by ${call.model ?? "the AI provider"}.`,
      explanations: validated.value.explanations,
      notActionable: validated.value.notActionable,
    };
  },
});