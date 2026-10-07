"use node";

// The licence suggestion lane: ask the decision lane to order the candidates,
// then hand the answers to the pure ordering in shared/licensing/suggest.ts.
//
// Same split as the ranking lane. shared/ owns the floor and the ordering,
// this file owns the network call. Nothing here decides a licence fact; the
// suggestion stays a suggestion, and a failed or absent lane leaves the table
// floor, so this step is safe to fail and the scan is complete either way.

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { decide } from "../adapters/decision";
import type { DecisionQuestion } from "../adapters/decision";
import {
  orderSuggestions,
  suggestProjectLicence,
  suggestionQuestionId,
  suggestionState,
} from "../../shared/licensing/suggest.ts";

const mixEntry = v.object({ id: v.string(), count: v.number() });

export const suggestLicence = internalAction({
  args: {
    scanId: v.id("scans"),
    project: v.optional(v.string()),
    mix: v.array(mixEntry),
    allowed: v.array(v.string()),
  },
  returns: v.object({
    pick: v.union(v.string(), v.null()),
    source: v.union(
      v.literal("local"),
      v.literal("jev"),
      v.literal("perplexity"),
      v.literal("table"),
    ),
    note: v.string(),
  }),
  handler: async (ctx, args) => {
    const floor = suggestProjectLicence({
      project: args.project ?? null,
      mix: args.mix.map((entry) => ({ id: entry.id, count: entry.count })),
      allowed: args.allowed,
    });
    if (floor.candidates.length === 0) {
      await ctx.runMutation(internal.scans.store.saveLicenceSuggestion, {
        scanId: args.scanId,
        suggestedLicence: "none",
        suggestionSource: "table",
        suggestionNote: floor.note,
      });
      return { pick: null, source: "table" as const, note: floor.note };
    }

    const state = suggestionState({
      project: args.project ?? null,
      mix: args.mix.map((entry) => ({ id: entry.id, count: entry.count })),
      allowed: args.allowed,
    });
    const questions: Record<string, DecisionQuestion> = {};
    for (const id of state.candidates) {
      questions[suggestionQuestionId(id)] = {
        type: "noul",
        instructions: `Is ${id} a good licence pick for a repo with this dependency mix: ${state.counts.join(", ")}.`,
        criteria: {
          true: "The pick fits what the repo already declares and a stranger could reuse it safely.",
          false: "The pick fits poorly, or the terms need a person to decide.",
        },
      };
    }

    const result = await decide(state, questions);
    const ordered = orderSuggestions(
      floor,
      result.ok ? result.answers : null,
      result.ok ? result.source : "table",
    );
    await ctx.runMutation(internal.scans.store.saveLicenceSuggestion, {
      scanId: args.scanId,
      suggestedLicence: ordered.pick ?? "none",
      suggestionSource: ordered.source,
      suggestionNote: ordered.note,
    });
    return { pick: ordered.pick, source: ordered.source, note: ordered.note };
  },
});
