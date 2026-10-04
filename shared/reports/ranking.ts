// Ranking math. PURE. No network, no convex/, no fs.
//
// This turns ranking into math so the decision lane can be measured instead of
// argued about. It is a development and scoring instrument: it computes the
// table's own order, the model's tilt, the rotation between them, and the
// agreement against human labels. It never ships a production order by itself.
//
// The invariants, as math:
//   - a finding is a feature vector x_i;
//   - severity partitions findings into bands, and a permutation may not cross a band;
//   - the table is a fixed weight vector w_table;
//   - a model adds a tilt delta, so w_model = w_table + delta;
//   - rotation phi = angle between the two unit rays;
//   - the reward only ever moves trust between rungs, never the finding set.
//
// It must never: add or drop a finding, change a severity, or read a finding as
// fixed when it is unknown. Those are not terms in any function here.

import type { RankableFinding } from "./priority";

/** One finding as a named feature vector. Order is fixed; do not reorder. */
export interface Features {
  high: number;
  medium: number;
  low: number;
  credential: number;
  siblings: number;
  bias: number;
}

export type Severity = RankableFinding["severity"];

/** A weight vector over the same features, plus a small severity one-hot. */
export interface Weights {
  high: number;
  medium: number;
  low: number;
  credential: number;
  siblings: number;
}

export const TABLE_WEIGHTS: Weights = { high: 0, medium: 0, low: 0, credential: 1, siblings: 0 };

/** Matches the ruleIds that usually mean a live credential a stranger can use. */
function isCredential(ruleId: string): boolean {
  return /secret|credential|key|token/i.test(ruleId);
}

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };

/** Partition actionable findings into severity bands. Info is not an action. */
export function bandPartition(findings: RankableFinding[]): Map<Severity, RankableFinding[]> {
  const bands = new Map<Severity, RankableFinding[]>();
  for (const finding of findings) {
    if (finding.severity === "info") continue;
    const list = bands.get(finding.severity) ?? [];
    list.push(finding);
    bands.set(finding.severity, list);
  }
  return bands;
}

/** Feature vector for one finding. `siblings` is the count of its band. */
export function featureVector(finding: RankableFinding, bandSize: number): Features {
  return {
    high: finding.severity === "high" ? 1 : 0,
    medium: finding.severity === "medium" ? 1 : 0,
    low: finding.severity === "low" ? 1 : 0,
    credential: isCredential(finding.ruleId) ? 1 : 0,
    siblings: bandSize,
    bias: 1,
  };
}

/** Inner product of a feature vector against a weight vector. */
export function project(features: Features, weights: Weights): number {
  return (
    features.high * weights.high +
    features.medium * weights.medium +
    features.low * weights.low +
    features.credential * weights.credential +
    features.siblings * weights.siblings
  );
}

/**
 * The table's own order over a band, matching priority.ts exactly: credential
 * first, then severity, then fingerprint. Expressed here as a total order so the
 * math layer and the product layer agree by construction.
 */
export function tableOrderOf(findings: RankableFinding[]): string[] {
  return [...findings]
    .sort((a, b) => {
      const aCred = isCredential(a.ruleId) ? 1 : 0;
      const bCred = isCredential(b.ruleId) ? 1 : 0;
      if (aCred !== bCred) return bCred - aCred;
      const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (sev !== 0) return sev;
      return a.fingerprint.localeCompare(b.fingerprint);
    })
    .map((f) => f.fingerprint);
}

/**
 * L2-normalise the weight vector so it can be treated as a ray direction.
 * A zero vector returns itself (the ray is undefined; callers treat that as the
 * table floor).
 */
export function normalize(weights: Weights): Weights {
  const norm = Math.sqrt(
    weights.high ** 2 +
      weights.medium ** 2 +
      weights.low ** 2 +
      weights.credential ** 2 +
      weights.siblings ** 2,
  );
  if (norm === 0) return weights;
  return {
    high: weights.high / norm,
    medium: weights.medium / norm,
    low: weights.low / norm,
    credential: weights.credential / norm,
    siblings: weights.siblings / norm,
  };
}

/** Cosine between two weight rays. Returns the rotation angle in radians. */
export function rotationAngle(a: Weights, b: Weights): number {
  const ua = normalize(a);
  const ub = normalize(b);
  const dot =
    ua.high * ub.high +
    ua.medium * ub.medium +
    ua.low * ub.low +
    ua.credential * ub.credential +
    ua.siblings * ub.siblings;
  const clamped = Math.max(-1, Math.min(1, dot));
  return Math.acos(clamped);
}

/**
 * Kendall tau between two orders over the same key set. 1 means identical,
 * -1 means reversed, ~0 means unrelated. Extra keys are ignored; a key present
 * in only one order is skipped so a partial order does not crash the metric.
 */
export function kendallTau(a: string[], b: string[]): number {
  const posB = new Map(b.map((k, i) => [k, i]));
  const common = a.filter((k) => posB.has(k));
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < common.length; i++) {
    for (let j = i + 1; j < common.length; j++) {
      const ai = i;
      const aj = j;
      const bi = posB.get(common[i]) as number;
      const bj = posB.get(common[j]) as number;
      if (ai < aj && bi < bj) concordant++;
      else if (ai < aj && bi > bj) discordant++;
    }
  }
  const total = concordant + discordant;
  if (total === 0) return 1;
  return (concordant - discordant) / total;
}

/**
 * Pairwise hinge loss of an order against binary labels.
 *
 * `labels` maps a finding key to 1 (fix before sharing) or 0 (not). For every
 * ordered pair (i, j) where i precedes j and their labels differ, a correct
 * order (1 above 0) costs nothing; a wrong order costs the margin. This is the
 * loss a `delta` would minimise. It is offline: no network, no finding changes.
 */
export function hingeLoss(order: string[], labels: Map<string, number>, margin = 1): number {
  let loss = 0;
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) {
      const li = labels.get(order[i]);
      const lj = labels.get(order[j]);
      if (li === undefined || lj === undefined || li === lj) continue;
      // Wrong when a lower-label item precedes a higher-label item.
      if (li < lj) loss += margin;
    }
  }
  return loss;
}

/** Top-k hit rate: share of the true-positive keys that appear in the first k. */
export function topKHits(order: string[], labels: Map<string, number>, k = 3): number {
  const positives = [...labels.entries()].filter(([, v]) => v === 1).map(([k2]) => k2);
  if (positives.length === 0) return 1;
  const top = new Set(order.slice(0, k));
  const hit = positives.filter((p) => top.has(p)).length;
  return hit / Math.min(k, positives.length);
}

/**
 * The zero-miss guard as a function: given the table's top-3 and a candidate
 * order, return the label-positive table rows that the candidate dropped out of
 * the top 3. An empty list means the guard holds.
 */
export function zeroMissViolations(
  candidate: string[],
  tableOrder: string[],
  labels: Map<string, number>,
  k = 3,
): string[] {
  const tableTop = tableOrder.slice(0, k).filter((fp) => labels.get(fp) === 1);
  const candidateTop = new Set(candidate.slice(0, k));
  return tableTop.filter((fp) => !candidateTop.has(fp));
}

/** Swap budget: total absolute rank movement between two orders over common keys. */
export function swapDistance(a: string[], b: string[]): number {
  const posB = new Map(b.map((k, i) => [k, i]));
  let total = 0;
  a.forEach((k, i) => {
    const j = posB.get(k);
    if (j !== undefined) total += Math.abs(i - j);
  });
  return total;
}

/** Apply a model's per-finding urgency scores to a band, inside the band only. */
export function orderByWorth(
  band: RankableFinding[],
  worth: Map<string, number>,
): string[] {
  const floor = tableOrderOf(band);
  const floorIndex = new Map(floor.map((fp, i) => [fp, i]));
  return [...floor].sort((a, b) => {
    const wa = worth.get(a);
    const wb = worth.get(b);
    if (wa !== undefined && wb !== undefined && wa !== wb) return wb - wa;
    return (floorIndex.get(a) ?? 0) - (floorIndex.get(b) ?? 0);
  });
}
