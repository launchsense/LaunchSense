"use node";

import { action } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { callAiLane } from "../adapters/ai";
import { looksLikeSecret } from "../adapters/decision";
import { buildExplainPrompt, deterministicPlan } from "../../shared/ai/deterministic";
import { validateAiPlan } from "../../shared/ai/validate";
import { fnv1aHex } from "../../shared/redaction";
import { canReadScan } from "../../shared/reports/scanAccess";

// The caller's own account id, read the same way the report queries read it. It
// is both the bucket key for the spend gate and the viewer the ownership rule is
// checked against. An identity that cannot be read is null, which is the stricter
// answer everywhere: the guest rules on spend, and no ownership on a signed-in
// scan. It is never the looser one.
async function viewerId(ctx: ActionCtx): Promise<string | null> {
  const auth = ctx.auth as { getUserIdentity?: () => Promise<{ subject: string } | null> } | undefined;
  if (typeof auth?.getUserIdentity !== "function") return null;
  try {
    const identity = await auth.getUserIdentity();
    if (identity === null) return null;
    // Convex Auth's getAuthUserId reads the user id from the subject: the part
    // before the claim divider. Reading it the same way here keeps this lane and
    // the report queries on one identity, so the ownership rule compares equal
    // values on both paths.
    return identity.subject.split("|")[0];
  } catch {
    return null;
  }
}

// The spend gate. Fail closed: if the limit cannot be read, the call does not
// happen, because a spend nobody can account for is the thing this gate is for.
// A press it turns away carries no findings at all, so the reader loses the plain
// wording for that press and nothing else.
async function claimExplain(
  ctx: ActionCtx,
  scanId: Id<"scans">,
  caller: string | null,
): Promise<{ allowed: boolean; reason: string }> {
  try {
    const gate = await ctx.runMutation(internal.mcpLimit.consumeExplain, {
      scanId,
      caller: caller ?? undefined,
    });
    if (gate === null || typeof gate.allowed !== "boolean") {
      return { allowed: false, reason: "gate_unreadable" };
    }
    return { allowed: gate.allowed, reason: gate.reason };
  } catch {
    return { allowed: false, reason: "gate_unreadable" };
  }
}

export const explainScan = action({
  args: { scanId: v.id("scans") },
  returns: v.object({
    scanId: v.id("scans"),
    source: v.union(
      v.literal("gemini"),
      v.literal("ollama"),
      v.literal("deterministic"),
    ),
    explained: v.number(),
    rejected: v.boolean(),
    // Structural, never read off a string: true only when the wording in this
    // answer was written by a provider. A refused call, a rejected answer, and a
    // press with no provider all show the deterministic wording, so all three are
    // false. A provider chooses its own model name and that name reaches the
    // reader, so a boolean derived from the note text could be moved by whoever
    // answered. This one cannot.
    providerCalled: v.boolean(),
    note: v.string(),
    explanations: v.array(v.object({ fingerprint: v.string(), plain: v.string() })),
    notActionable: v.array(v.object({ fingerprint: v.string(), reason: v.string() })),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    scanId: Id<"scans">;
    source: "gemini" | "ollama" | "deterministic";
    explained: number;
    rejected: boolean;
    providerCalled: boolean;
    note: string;
    explanations: Array<{ fingerprint: string; plain: string }>;
    notActionable: Array<{ fingerprint: string; reason: string }>;
  }> => {
    const viewer = await viewerId(ctx);

    // A refusal carries no findings. It is the shape the report queries already
    // return for a scan the viewer may not read, so a held scan id learns nothing
    // about the scan it names.
    const emptyAnswer = (note: string, rejected: boolean) => ({
      scanId: args.scanId,
      source: "deterministic" as const,
      explained: 0,
      rejected,
      providerCalled: false,
      note,
      explanations: [],
      notActionable: [],
    });

    // The spend gate runs first, before the scan row and the findings are read, so
    // a press the cap turns away costs a caller with many scan ids no reads at
    // all. The first press for a guest still reaches the provider below.
    const gate = await claimExplain(ctx, args.scanId, viewer);
    if (!gate.allowed) {
      return emptyAnswer(
        gate.reason === "gate_unreadable"
          ? "The plain wording limit could not be checked, so nothing was sent to an AI provider."
          : "The plain wording limit for this scan is used up. Plain wording is not available right now.",
        false,
      );
    }

    const scan = await ctx.runQuery(internal.scans.store.fetchScan, { scanId: args.scanId });
    if (scan === null || scan.analyzedAt === undefined) {
      throw new Error("Analyze the scan before asking for explanations.");
    }
    // Ownership, before the findings are read and long before anything is posted.
    // The report queries enforce this same rule on the read path; this lane reads
    // the same row, so it runs the same rule instead of trusting a scan id. A
    // guest scan of a public repo stays readable by id, which is what
    // canReadScan defines.
    if (!canReadScan(scan, viewer)) {
      return emptyAnswer(
        "That scan is not available to your account. Sign in with the account that made it, then try again.",
        false,
      );
    }
    const rows = await ctx.runQuery(internal.scans.store.listFindings, { scanId: args.scanId });
    const findings = rows.map((r) => ({
      fingerprint: r.fingerprint,
      severity: r.severity,
      title: r.title,
      why: r.why,
    }));

    // The deterministic wording, used on every path where no provider is asked.
    // Its text is the shipped wording and this lane never changes it.
    const plainAnswer = (note: string, rejected: boolean) => {
      const plan = deterministicPlan(findings);
      return {
        scanId: args.scanId,
        source: "deterministic" as const,
        explained: plan.explanations.length,
        rejected,
        providerCalled: false,
        note,
        explanations: plan.explanations,
        notActionable: plan.notActionable,
      };
    };

    const prompt = buildExplainPrompt(findings);
    const promptHash = fnv1aHex(prompt);

    // Defensive gate, before anything leaves this machine. Finding wording is
    // built from snippets, and a snippet can carry a key, so the guard the reorder
    // lane already runs runs here too. One list of shapes, not two, and a match
    // is named by its label instead of quoted back.
    const secretShape = looksLikeSecret(prompt);
    if (secretShape !== null) {
      return plainAnswer(
        `Nothing was sent to an AI provider. This scan's wording holds something that looks like a ${secretShape}, so plain wording is shown instead.`,
        false,
      );
    }

    const call = await callAiLane(prompt);
    const recordUsage = async (source: "gemini" | "ollama" | "deterministic", ok: boolean, errorKind?: string) => {
      await ctx.runMutation(internal.scans.store.saveProviderCall, {
        scanId: args.scanId,
        kind: "explain",
        source,
        // The model the lane actually called, never a name typed here. A model
        // that was never reached (no provider answered) stores nothing.
        model: call.model ?? undefined,
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
      return plainAnswer("No AI provider answered. Plain wording is shown instead.", false);
    }

    const validated = validateAiPlan(call.json, findings);
    if (!validated.ok) {
      await recordUsage(call.source, false, "validation_rejected");
      // The provider answered, but the wording the reader gets is ours, so the
      // disclosure in the not-checked box stays in place.
      return plainAnswer(`AI output was rejected: ${validated.reason}`, true);
    }

    await recordUsage(call.source, true);
    return {
      scanId: args.scanId,
      source: call.source,
      explained: validated.value.explanations.length,
      rejected: false,
      providerCalled: true,
      note: `Explained by ${call.model ?? "the AI provider"}.`,
      explanations: validated.value.explanations,
      notActionable: validated.value.notActionable,
    };
  },
});