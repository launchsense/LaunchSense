// The sign-in consent records, in the database rather than in a browser's
// memory. This is the row the sign-in panel was missing.
//
// What it does:
//   recordSignInDecisions  writes one row per purpose for the signed-in caller
//   myConsentRecords       returns the caller's own rows, so they can be exported
//
// Three rules this file does not bend:
//
//   1. The caller comes from getAuthUserId and from nowhere else. There is no
//      userId argument, so a forged one in the arguments cannot move a record
//      onto somebody else's account. This is the same shape as every other
//      authenticated mutation in this directory.
//
//   2. A decision is upserted on (userId, purposeId, noticeVersion). Answering
//      the same question twice under the same wording updates the row; answering
//      it under new wording adds one. Neither creates a duplicate of a decision
//      the person can point at and find twice.
//
//   3. A refusal is a record. granted is written false exactly as readily as
//      true. The panel requires all four boxes today, so nothing in this build
//      can send a refusal through this mutation, and the shape still takes one,
//      because a consent store that can only hold agreement is the wrong store.
//
// The person is anonymous until the OAuth callback returns, so the click cannot
// reach this file. src/features/auth/signInDecision.ts persists the decision for
// the tab and the recorder calls this mutation once there is a session. If
// nothing is persisted, nothing is written: no record is invented for a person
// who signed in before this existed.
//
// source is set here, not taken as an argument. There is one surface that writes
// these rows, and a caller-chosen free-text column is a column a caller can lie
// in.

import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { CONSENT_PURPOSES } from "../shared/consent/vocabulary.ts";

/** The four purposes the sign-in panel asks about, in the order it lists them. */
const purposeId = v.union(
  v.literal("token"),
  v.literal("read"),
  v.literal("explain"),
  v.literal("usage"),
);

/**
 * The same four ids, read from the vocabulary, and checked in the handler.
 *
 * The argument validator already refuses anything else, and that is the boundary
 * that matters in production. The check is here too because a validator is the
 * only thing standing between a caller and a row, and because the vocabulary is
 * the single place a purpose is defined: a fifth purpose added there fails this
 * file rather than being silently refused at runtime.
 */
const KNOWN_PURPOSES: ReadonlySet<string> = new Set(CONSENT_PURPOSES.map((purpose) => purpose.id));

/**
 * The surface that writes these rows. A fixed string, not an argument, because
 * the honest value of this column is the one this server can vouch for.
 */
const SIGN_IN_SOURCE = "sign-in panel";

/**
 * How far ahead of this server's own clock a click may be.
 *
 * decidedAt comes from the browser, so it cannot be trusted and is not trusted:
 * it is stored so the record can say when the person decided, and the server
 * writes recordedAt as well so a wrong device clock cannot rewrite when the
 * controller learned. A click more than a day in the future is not a clock
 * offset, it is a fabricated value, and it is refused rather than stored.
 */
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

/** The oldest click this product will accept, as a lower bound on a real answer. */
const MIN_DECIDED_AT = Date.UTC(2020, 0, 1);

/** A dated version, or a short opaque token. Nothing looser is a version. */
const NOTICE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

export const recordSignInDecisions = mutation({
  args: {
    noticeVersion: v.string(),
    decidedAt: v.number(),
    decisions: v.array(v.object({ purposeId, granted: v.boolean() })),
  },
  // The row ids, so a caller can see which rows the upsert resolved to.
  returns: v.array(v.id("consentRecords")),
  handler: async (ctx, args) => {
    // The one source of the caller's identity. Nothing in args can replace it.
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");

    const noticeVersion = args.noticeVersion.trim();
    if (!NOTICE_VERSION.test(noticeVersion)) {
      throw new Error("A decision needs a notice version, the wording the person read.");
    }
    if (
      !Number.isInteger(args.decidedAt) ||
      args.decidedAt < MIN_DECIDED_AT ||
      args.decidedAt > Date.now() + MAX_CLOCK_SKEW_MS
    ) {
      throw new Error("A decision needs a decidedAt that is a real past or present time.");
    }
    if (args.decisions.length === 0) {
      throw new Error("A decision set with no purposes in it records nothing. Send no call instead.");
    }

    const seen = new Set<string>();
    for (const decision of args.decisions) {
      if (!KNOWN_PURPOSES.has(decision.purposeId)) {
        throw new Error(`${decision.purposeId} is not a purpose this product asks about.`);
      }
      if (seen.has(decision.purposeId)) {
        throw new Error(`The same purpose was answered twice in one decision: ${decision.purposeId}.`);
      }
      seen.add(decision.purposeId);
    }

    const recordedAt = Date.now();
    const ids: Id<"consentRecords">[] = [];
    for (const decision of args.decisions) {
      const existing = await ctx.db
        .query("consentRecords")
        .withIndex("by_user_purpose", (q) =>
          q.eq("userId", userId).eq("purposeId", decision.purposeId),
        )
        .collect();
      const match = existing.find((row) => row.noticeVersion === noticeVersion);
      if (match !== undefined) {
        // Same person, same purpose, same wording. An update, so a repeat is not a
        // second decision the person cannot find.
        await ctx.db.patch("consentRecords", match._id, {
          granted: decision.granted,
          decidedAt: args.decidedAt,
          recordedAt,
          source: SIGN_IN_SOURCE,
        });
        ids.push(match._id);
        continue;
      }
      ids.push(
        await ctx.db.insert("consentRecords", {
          userId,
          purposeId: decision.purposeId,
          granted: decision.granted,
          noticeVersion,
          decidedAt: args.decidedAt,
          recordedAt,
          source: SIGN_IN_SOURCE,
        }),
      );
    }
    return ids;
  },
});

export const myConsentRecords = query({
  args: {},
  // Null when nobody is signed in, and a list when they are. Those are different
  // facts: an empty list must not read as "you have agreed to nothing", which is
  // a claim about a person rather than about a table.
  returns: v.union(
    v.null(),
    v.array(
      v.object({
        _id: v.id("consentRecords"),
        userId: v.id("users"),
        purposeId,
        granted: v.boolean(),
        noticeVersion: v.string(),
        decidedAt: v.number(),
        recordedAt: v.number(),
        source: v.string(),
      }),
    ),
  ),
  handler: async (ctx) => {
    // Owner only. The index is keyed on the session's user id and there is no
    // argument that could point anywhere else, so one person's export cannot
    // carry another's rows.
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const rows = await ctx.db
      .query("consentRecords")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    // Newest answer first, then panel order, so a reader comparing this against
    // the boxes sees the same four purposes in the same order the panel showed.
    const order = new Map<string, number>([
      ["token", 0],
      ["read", 1],
      ["explain", 2],
      ["usage", 3],
    ]);
    return rows.sort((a, b) => {
      if (b.decidedAt !== a.decidedAt) return b.decidedAt - a.decidedAt;
      return (order.get(a.purposeId) ?? 0) - (order.get(b.purposeId) ?? 0);
    });
  },
});