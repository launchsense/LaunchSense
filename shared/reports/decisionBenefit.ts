// Decision-lane benefit: the measurement. PURE. No network, no convex/, no fs.
//
// The lane (rankFromAnswers in ./priority.ts) lets a model reorder the findings
// the deterministic checks already produced. The floor (tableOrder) is always
// present. This file exists to answer one question with numbers instead of
// opinions: is the lane order better than the floor order?
//
// It measures. It never ranks. It does not call a model, it does not read a
// finding, and it cannot change an order it is handed. Everything here is a
// function of its arguments, so the same numbers come out on every run.
//
// The three metrics, defined precisely so a change here cannot flatter the lane:
//
//   topKHitRate(order, labels, k)
//     How many of the label-positive rows landed in the first k, as a share of
//     min(k, positives). 1.0 is a perfect top-k. When a band holds at most k
//     positives, every order scores 1.0, so the metric has no power there. That
//     is a property of the band, not a result, and it is the reason an
//     unlabelled or homogeneous band cannot be scored.
//
//   pairwiseAccuracyWithinBand(order, labels, severityOf)
//     Of the same-severity pairs whose labels differ, the share placed in the
//     labelled order. Only within a band, because crossing a band is already
//     forbidden by the product rules, so those pairs carry no information.
//
//   addedOrDropped(before, after)
//     Keys whose count differs between the two orders. Multiset, not set: a
//     duplicated fingerprint that survives is still a row, and a corpus scan
//     really does emit duplicate fingerprints.
//
// Every metric returns 1 (nothing to be wrong about) when its denominator is
// zero, matching kendallTau in ./ranking.ts. Callers that care about the
// difference must read the accompanying counts, which scoreOrders always
// returns, rather than reading 1.0 as a win.

import {
  actionableFindings,
  questionIdFor,
  rankFromAnswers,
  tableOrder,
  type NoulAnswerLike,
  type RankableFinding,
} from "./priority.ts";

type Severity = RankableFinding["severity"];
type RankSource = ReturnType<typeof rankFromAnswers>["source"];

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };

/** Looks up the severity of a key. Missing keys are outside every band. */
export type SeverityOf = (key: string) => Severity | undefined;

// ---------------------------------------------------------------------------
// The metrics.
// ---------------------------------------------------------------------------

/**
 * Share of the label-positive rows found in the first `k` of `order`, over
 * min(k, positives). Returns 1 when there is nothing to find, which means
 * "unmeasured", so read `positivesInOrder` before quoting this as a score.
 */
export function topKHitRate(order: string[], labels: Set<string>, k: number): number {
  if (k <= 0) return 1;
  const top = new Set(order.slice(0, k));
  let hit = 0;
  let positives = 0;
  for (const key of labels) {
    if (!order.includes(key)) continue;
    positives += 1;
    if (top.has(key)) hit += 1;
  }
  const denominator = Math.min(k, positives);
  if (denominator === 0) return 1;
  return hit / denominator;
}

/** How many of `labels` are present in `order` at all. */
export function positivesInOrder(labels: Set<string>, order: string[]): number {
  const present = new Set(order);
  let count = 0;
  for (const key of labels) if (present.has(key)) count += 1;
  return count;
}

/**
 * Count the same-band, label-differing pairs of an order and how many are right.
 *
 * `correct` is counted when the label-positive row of the pair sits above the
 * negative one. A pair is eligible only when both rows resolve to the SAME
 * severity through `severityOf`: a cross-band pair is a violation of the
 * product rules, not a ranking error, so it is excluded rather than scored.
 */
export function pairwiseCountsWithinBand(
  order: string[],
  labels: Set<string>,
  severityOf: SeverityOf,
): { correct: number; total: number; accuracy: number } {
  let correct = 0;
  let total = 0;
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) {
      const a = order[i];
      const b = order[j];
      const sa = severityOf(a);
      const sb = severityOf(b);
      if (sa === undefined || sb === undefined || sa !== sb) continue;
      const la = labels.has(a);
      const lb = labels.has(b);
      if (la === lb) continue;
      total += 1;
      if (la) correct += 1;
    }
  }
  return { correct, total, accuracy: total === 0 ? 1 : correct / total };
}

/** The accuracy half of `pairwiseCountsWithinBand`, for direct comparison. */
export function pairwiseAccuracyWithinBand(
  order: string[],
  labels: Set<string>,
  severityOf: SeverityOf,
): number {
  return pairwiseCountsWithinBand(order, labels, severityOf).accuracy;
}

/**
 * True when the two findings sit in different severity bands, so putting one
 * above the other would cross a boundary the product does not allow crossing.
 */
export function bandCrossed(a: RankableFinding, b: RankableFinding): boolean {
  return a.severity !== b.severity;
}

/**
 * Check the band invariant by reading the order rather than trusting the lane.
 *
 * The invariant is that a band-safe order has NON-DECREASING severity ranks, so
 * severity groups stay contiguous. A sequence is non-decreasing exactly when it
 * has no adjacent descent, so one check per adjacent pair is complete. Each
 * descent names the EARLIER key: that is the row sitting above a strictly better
 * one, which is the row out of place. A key with no finding behind it is also
 * named, because it has no legal position at all.
 *
 * An empty list means the invariant holds.
 */
export function severityOrderViolations(
  order: string[],
  findings: RankableFinding[],
): string[] {
  const severityByKey = new Map(findings.map((finding) => [finding.fingerprint, finding.severity]));
  const rankOf = (key: string): number | undefined => {
    const severity = severityByKey.get(key);
    return severity === undefined ? undefined : SEVERITY_RANK[severity];
  };
  const violations: string[] = [];
  const named = new Set<string>();
  for (let i = 1; i < order.length; i++) {
    const previous = order[i - 1];
    const current = order[i];
    const before = rankOf(previous);
    const after = rankOf(current);
    if (before === undefined || after === undefined) {
      for (const key of [previous, current]) {
        if (rankOf(key) === undefined && !named.has(key)) {
          named.add(key);
          violations.push(key);
        }
      }
      continue;
    }
    if (before > after && !named.has(previous)) {
      named.add(previous);
      violations.push(previous);
    }
  }
  return violations;
}

/** Keys whose count differs between the two orders: what the lane added or lost. */
export function addedOrDropped(before: string[], after: string[]): string[] {
  const count = (keys: string[]): Map<string, number> => {
    const tally = new Map<string, number>();
    for (const key of keys) tally.set(key, (tally.get(key) ?? 0) + 1);
    return tally;
  };
  const from = count(before);
  const to = count(after);
  const differing = new Set<string>();
  for (const [key, n] of from) if ((to.get(key) ?? 0) !== n) differing.add(key);
  for (const [key, n] of to) if ((from.get(key) ?? 0) !== n) differing.add(key);
  return [...differing].sort();
}

/** How many positions differ between the lane order and the floor. */
export function movedPositions(floor: string[], order: string[]): number {
  const shared = Math.min(floor.length, order.length);
  let moved = Math.abs(floor.length - order.length);
  for (let i = 0; i < shared; i++) if (floor[i] !== order[i]) moved += 1;
  return moved;
}

// ---------------------------------------------------------------------------
// The scored comparison.
// ---------------------------------------------------------------------------

export interface OrderMetrics {
  topKHitRate: number;
  pairwiseAccuracyWithinBand: number;
  /** Same-band, label-differing pairs available. 0 means the metric is inert. */
  discriminatingPairs: number;
  /** Label-positive rows actually present in the order. */
  positives: number;
}

export interface Invariants {
  /** Rows that crossed a severity band. Must be empty. */
  bandCrossings: string[];
  /** Rows the lane added or dropped. Must be empty. */
  addedOrDropped: string[];
  /** The lane order is byte-identical to the floor, so it said nothing. */
  neutral: boolean;
  /** The answers were null, or carried no number at all. */
  uninformative: boolean;
}

export interface ScoredOrders {
  k: number;
  /** Actionable findings, which is the pool both orders must cover. */
  actionable: number;
  /** How many of those the lane is even allowed to look at. */
  eligibleForReorder: number;
  table: OrderMetrics;
  model: OrderMetrics;
  delta: { topKHitRate: number; pairwiseAccuracyWithinBand: number };
  moved: number;
  tableOrder: string[];
  modelOrder: string[];
  /** Which rung produced `answers`, as named by the caller. Never inferred. */
  source: RankSource;
  invariants: Invariants;
  invariantsHeld: boolean;
}

/** True when `answers` carries no usable number, so the lane has nothing to say. */
export function isUninformative(
  findings: RankableFinding[],
  answers: Record<string, NoulAnswerLike> | null,
): boolean {
  if (answers === null) return true;
  const pool = actionableFindings(findings);
  for (const finding of pool) {
    const answer = answers[questionIdFor(finding.fingerprint)];
    if (answer !== undefined && typeof answer.noul === "number") return false;
  }
  return true;
}

/**
 * Score the floor against the lane on one finding set.
 *
 * `findings` is the whole set the checks produced. `answers` is the raw map the
 * lane received, keyed by `questionIdFor`, or null when no rung answered.
 * `labels` is the set of keys a person marked fix-first. `source` is the name of
 * the instrument that produced the answers and is passed straight through: this
 * function never decides which rung ran, and defaults to "local" rather than
 * naming a hosted provider it cannot know answered.
 *
 * A non-zero delta is the only claim of benefit this module can support, and it
 * is only meaningful when `discriminatingPairs` is above zero and `positives` is
 * above zero. Both are returned so a caller cannot quote 1.0 from a band with
 * nothing in it.
 */
export function scoreOrders(
  findings: RankableFinding[],
  answers: Record<string, NoulAnswerLike> | null,
  labels: Set<string>,
  k: number,
  source: RankSource = "local",
): ScoredOrders {
  const pool = actionableFindings(findings);
  const floor = tableOrder(pool);
  const effectiveSource: RankSource = answers === null ? "table" : source;
  const ranked = rankFromAnswers(findings, answers, effectiveSource);
  const model = ranked.order;

  const severityByKey = new Map(pool.map((finding) => [finding.fingerprint, finding.severity]));
  const severityOf: SeverityOf = (key) => severityByKey.get(key);

  const measure = (order: string[]): OrderMetrics => {
    const pairs = pairwiseCountsWithinBand(order, labels, severityOf);
    return {
      topKHitRate: topKHitRate(order, labels, k),
      pairwiseAccuracyWithinBand: pairs.accuracy,
      discriminatingPairs: pairs.total,
      positives: positivesInOrder(labels, order),
    };
  };

  const table = measure(floor);
  const modelMetrics = measure(model);
  const bandCrossings = severityOrderViolations(model, pool);
  const lost = addedOrDropped(floor, model);
  const neutral = floor.length === model.length && floor.every((key, i) => key === model[i]);
  const uninformative = isUninformative(findings, answers);

  return {
    k,
    actionable: pool.length,
    eligibleForReorder: countEligible(pool),
    table,
    model: modelMetrics,
    delta: {
      topKHitRate: modelMetrics.topKHitRate - table.topKHitRate,
      pairwiseAccuracyWithinBand:
        modelMetrics.pairwiseAccuracyWithinBand - table.pairwiseAccuracyWithinBand,
    },
    moved: movedPositions(floor, model),
    tableOrder: floor,
    modelOrder: model,
    source: effectiveSource,
    invariants: { bandCrossings, addedOrDropped: lost, neutral, uninformative },
    invariantsHeld: bandCrossings.length === 0 && lost.length === 0,
  };
}

/**
 * How many findings sit in a severity band of two or more, which is the same
 * rule the lane uses to decide what it may ask about. Duplicated across
 * priority.ts deliberately: a local copy here keeps this file a pure scorer that
 * cannot drift into importing behaviour it is only meant to measure.
 */
function countEligible(pool: RankableFinding[]): number {
  const counts = new Map<Severity, number>();
  for (const finding of pool) counts.set(finding.severity, (counts.get(finding.severity) ?? 0) + 1);
  let eligible = 0;
  for (const finding of pool) {
    if ((counts.get(finding.severity) ?? 0) >= 2) eligible += 1;
  }
  return eligible;
}