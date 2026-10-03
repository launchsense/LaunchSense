// Queue row eligibility for the abandoned-row sweep.
//
// Split out from the Convex mutation so the rule is unit testable without the
// Convex runtime. The helper decides ELIGIBILITY only. Atomicity, and the
// re-check that protects a concurrently claimed row, stay in the mutation.

/** A waiting row older than the TTL is abandoned and may be swept. */
export function isAbandonedQueuedRow(
  row: { startedAt: number; queuedAt: number },
  now: number,
  ttlMs: number,
): boolean {
  // startedAt === 0 marks "waiting, not yet started". A row with any other
  // value is holding or has held a slot, so it is never swept here.
  if (row.startedAt !== 0) return false;
  // Strictly less than, so a row exactly at the TTL boundary survives this pass
  // and is swept on the next one. Avoids a fencepost where two sweeps race.
  return row.queuedAt < now - ttlMs;
}

/** A running row older than the stale window is from a crashed action. */
export function isStaleRunningRow(
  row: { startedAt: number },
  now: number,
  staleMs: number,
): boolean {
  return row.startedAt !== 0 && row.startedAt < now - staleMs;
}