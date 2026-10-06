// The sign-in decision, before it can be a record.
//
// The panel asks one box covering four purposes, and one button. The button
// starts an OAuth redirect, and until that redirect comes back the person is
// anonymous: there is no user id to attach a record to. So the click cannot write
// a consent record, and pretending otherwise would either need a client-supplied
// user id or a record with nobody's name on it.
//
// So the click only persists. The values go to sessionStorage, which survives the
// OAuth round trip in the same tab and dies with the tab. A person who abandons
// the redirect, or who signed in before this existed, leaves nothing behind, and
// nothing is written for them. That is the honest reading of "no persisted
// decision, no record": a decision the product cannot see is not a decision it
// may claim to hold.
//
// This module is pure on purpose. It takes the storage as an argument, so the
// payload and the persistence can be tested without a browser and without an
// OAuth redirect. convex/consent.ts is the only thing that writes a row.
//
// What is stored is the minimum the record needs: which purposes, whether each
// one was granted, which wording version was in force, and the moment of the
// click. No token, no email address, no repository name, and nothing about the
// repository the person intends to scan.

import { SIGN_IN_NOTICE_VERSION } from "../../../shared/copy/signIn.ts";
import { SIGN_IN_PURPOSE_IDS } from "../../../shared/consent/vocabulary.ts";
import type { SignInPurposeId } from "../../../shared/consent/vocabulary.ts";

export type PurposeId = SignInPurposeId;

/** One answer, as the person gave it. A refusal is an answer too. */
export interface SignInDecisionEntry {
  purposeId: PurposeId;
  granted: boolean;
}

/** Everything the mutation needs, and nothing else. */
export interface SignInDecision {
  /** The wording the person read. See SIGN_IN_NOTICE_VERSION. */
  noticeVersion: string;
  /** Epoch milliseconds at the click. The server writes its own time as well. */
  decidedAt: number;
  decisions: SignInDecisionEntry[];
}

/** The argument shape convex/consent.ts:recordSignInDecisions takes. */
export interface RecordSignInArgs {
  noticeVersion: string;
  decidedAt: number;
  decisions: SignInDecisionEntry[];
}

/**
 * The sessionStorage key. Named rather than left to the library, so the reader,
 * the writer, and the tests all agree on one string and so nothing else in the
 * origin can collide with it.
 */
export const PENDING_SIGN_IN_KEY = "launchsense.pendingSignInDecision";

/**
 * The storage this module needs. A structural type, not the DOM Storage, so a
 * test can pass a plain object and so a missing browser session is a value the
 * caller handles rather than a crash.
 */
export interface DecisionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PURPOSE_IDS: readonly string[] = SIGN_IN_PURPOSE_IDS;

function isPurposeId(value: unknown): value is PurposeId {
  return typeof value === "string" && PURPOSE_IDS.includes(value);
}

/**
 * Build the decision the click captured.
 *
 * The purposes arrive in the order the person read them, because that order is
 * the order the panel shows and a record that reordered itself would be a record
 * nobody can compare with the boxes they ticked. A repeated or unknown purpose is
 * refused rather than folded in: the panel cannot produce one, so one arriving
 * here means the caller is not the panel.
 */
export function buildSignInDecision(input: {
  noticeVersion?: string;
  decidedAt: number;
  purposeIds: readonly string[];
  /** Defaults to granted for every purpose, which is what the panel requires. */
  grantedFor?: (purposeId: string) => boolean;
}): SignInDecision {
  const noticeVersion = input.noticeVersion ?? SIGN_IN_NOTICE_VERSION;
  if (!isNoticeVersion(noticeVersion)) {
    throw new Error("a sign-in decision needs a notice version");
  }
  if (!isEpochMillis(input.decidedAt)) {
    throw new Error("a sign-in decision needs the click time in epoch milliseconds");
  }
  if (input.purposeIds.length === 0) {
    throw new Error("a sign-in decision needs at least one purpose");
  }
  const seen = new Set<string>();
  const decisions: SignInDecisionEntry[] = [];
  for (const purposeId of input.purposeIds) {
    if (!isPurposeId(purposeId)) throw new Error(`${purposeId} is not a purpose this product asks about`);
    if (seen.has(purposeId)) throw new Error(`${purposeId} was answered twice in one decision`);
    seen.add(purposeId);
    const granted = input.grantedFor === undefined ? true : input.grantedFor(purposeId) === true;
    decisions.push({ purposeId, granted });
  }
  return { noticeVersion, decidedAt: input.decidedAt, decisions };
}

/**
 * Read the persisted decision, or null when there is none this build can use.
 *
 * Anything unreadable is null rather than a guess: a half-written value, a value
 * from a build that wrote a different shape, or a value a person edited in the
 * browser. The caller records nothing in that case, which is the correct outcome
 * for a consent record.
 */
export function readSignInDecision(storage: DecisionStorage): SignInDecision | null {
  let raw: string | null;
  try {
    raw = storage.getItem(PENDING_SIGN_IN_KEY);
  } catch {
    return null;
  }
  if (raw === null || raw.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return parseDecision(parsed);
}

function parseDecision(value: unknown): SignInDecision | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (!isNoticeVersion(candidate["noticeVersion"])) return null;
  if (!isEpochMillis(candidate["decidedAt"])) return null;
  const rawDecisions = candidate["decisions"];
  if (!Array.isArray(rawDecisions) || rawDecisions.length === 0) return null;
  const seen = new Set<string>();
  const decisions: SignInDecisionEntry[] = [];
  for (const entry of rawDecisions) {
    if (typeof entry !== "object" || entry === null) return null;
    const item = entry as Record<string, unknown>;
    const purposeId = item["purposeId"];
    const granted = item["granted"];
    if (!isPurposeId(purposeId)) return null;
    if (typeof granted !== "boolean") return null;
    if (seen.has(purposeId)) return null;
    seen.add(purposeId);
    decisions.push({ purposeId, granted });
  }
  return {
    noticeVersion: candidate["noticeVersion"],
    decidedAt: candidate["decidedAt"],
    decisions,
  };
}

/** A dated version, or a short opaque token. Anything else is not a version. */
function isNoticeVersion(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(value);
}

/** A real timestamp: a finite whole number of milliseconds, not zero. */
function isEpochMillis(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** Persist the decision for this tab to pick up after the OAuth redirect. */
export function saveSignInDecision(storage: DecisionStorage, decision: SignInDecision): void {
  storage.setItem(PENDING_SIGN_IN_KEY, JSON.stringify(decision));
}

/** Drop the persisted decision. Called after the row is written, never before. */
export function clearSignInDecision(storage: DecisionStorage): void {
  try {
    storage.removeItem(PENDING_SIGN_IN_KEY);
  } catch {
    // A storage that refuses to forget is not a reason to fail a sign-in. The
    // mutation is an upsert, so a second attempt writes the same row again.
  }
}

export type RecordOutcome = "recorded" | "no decision" | "recording failed";

/**
 * The scan the person was reading when they chose to sign in.
 *
 * Saved at the sign-in click and read back after the OAuth round trip, so the
 * page they return to is the scan they left, not an empty box. Same storage and
 * same lifetime as the decision: sessionStorage, this tab, gone with the tab.
 */
export const PENDING_SCAN_KEY = "launchsense.pendingScanId";

/** Persist the scan id on screen, so the return lands back on it. */
export function savePendingScan(storage: DecisionStorage, scanId: string | null): void {
  if (scanId === null || scanId.length === 0) return;
  try {
    storage.setItem(PENDING_SCAN_KEY, scanId);
  } catch {
    // A storage that refuses to remember is not a reason to fail a sign-in.
    // The person lands on the empty box they would have gotten anyway.
  }
}

/** Read the persisted scan id, or null when there is none this build can use. */
export function readPendingScan(storage: DecisionStorage): string | null {
  let raw: string | null;
  try {
    raw = storage.getItem(PENDING_SCAN_KEY);
  } catch {
    return null;
  }
  // The same shape the server mints: a Convex row id, lower-case alphanumeric.
  return raw !== null && /^[a-z0-9]{16,64}$/.test(raw) ? raw : null;
}

/** Drop the persisted scan id after it has been used, so it cannot fire twice. */
export function clearPendingScan(storage: DecisionStorage): void {
  try {
    storage.removeItem(PENDING_SCAN_KEY);
  } catch {
    // Nothing to do: an unused id is harmless, it only reopens a scan.
  }
}

/**
 * Write the persisted decision, once, and clear it afterwards.
 *
 * `record` is the Convex mutation, passed in so this module needs no Convex
 * client and no React. It is called at most once per call.
 *
 * Clearing happens after the call resolves and not before: a decision that failed
 * to write stays where it is so the next attempt can retry it, and the mutation
 * upserts, so a retry updates the same row rather than duplicating it.
 */
export async function recordPendingDecision(
  storage: DecisionStorage,
  record: (args: RecordSignInArgs) => Promise<unknown>,
): Promise<RecordOutcome> {
  const decision = readSignInDecision(storage);
  if (decision === null) return "no decision";
  try {
    await record({ noticeVersion: decision.noticeVersion, decidedAt: decision.decidedAt, decisions: decision.decisions });
  } catch {
    return "recording failed";
  }
  clearSignInDecision(storage);
  return "recorded";
}