"use node";

// The priority action: ask the decision lane, then hand the answers to the pure
// ranking in shared/reports/priority.ts.
//
// This is the same split as the writing lane. shared/ owns the rules and the
// ordering, this file owns the network call. Nothing here decides what is a
// finding; it only asks the lane one closed question per finding and passes the
// answers back.

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { decide } from "../adapters/decision";
import type { DecisionQuestion } from "../adapters/decision";
import { findingsToAsk, laneCanReorder, rankFromAnswers, questionIdFor, rankState } from "../../shared/reports/priority";
import type { RankableFinding } from "../../shared/reports/priority";

export const rankScan = internalAction({
  args: { scanId: v.id("scans") },
  returns: v.object({
    order: v.array(v.string()),
    source: v.union(v.literal("local"), v.literal("jev"), v.literal("perplexity"), v.literal("table")),
    note: v.string(),
  }),
  handler: async (ctx, args) => {
    const rows = await ctx.runQuery(internal.scans.store.listFindings, { scanId: args.scanId });
    const findings: RankableFinding[] = rows.map((r) => ({
      fingerprint: r.fingerprint,
      severity: r.severity,
      ruleId: r.ruleId,
      title: r.title,
    }));

    // Standards rows are not sent. The model may only reorder inside a severity
    // band, and only when that band has two or more findings.
    if (!laneCanReorder(findings)) {
      return rankFromAnswers(findings, null, "table");
    }

    const state = rankState(findings);

    // One closed question per finding the model is allowed to move. It can
    // answer only with the probability of yes, so it cannot name a check, a
    // tool, or anything we did not enumerate.
    const questions: Record<string, DecisionQuestion> = {};
    for (const f of findingsToAsk(findings)) {
      questions[questionIdFor(f.fingerprint)] = {
        type: "noul",
        instructions: `Does this need fixing before the builder shares their repo: ${f.title} (severity ${f.severity}).`,
        criteria: {
          true: "A stranger could be harmed or embarrassed if this ships as it is.",
          false: "Real, but not something to fix before sharing.",
        },
      };
    }

    if (Object.keys(questions).length === 0) {
      return rankFromAnswers(findings, null, "table");
    }

    const result = await decide(state, questions);
    return rankFromAnswers(findings, result.ok ? result.answers : null, result.source);
  },
});