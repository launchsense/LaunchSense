// The anonymous visitor id: shape, check, and issuance cap, in one place with
// no Convex import so tests can import it directly. The server mints it, the
// browser keeps it, and the write path keeps only this shape.
export const VISITOR_ID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Keep a visitor id only when it has the shape the server mints.
 *
 * `logEvent` is a public mutation, so the visitorId arrives from a browser
 * and may be anything. Only a UUID is kept. A malformed one is dropped while
 * the event is still recorded, so a forged id buys no metric and breaks no
 * count.
 */
export function visitorIdOrNull(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return VISITOR_ID_SHAPE.test(value) ? value.toLowerCase() : undefined;
}

/**
 * New ids per day, globally. Same pattern as the per-kind event caps: past
 * the cap the call returns null and the browser proceeds without an id, so
 * events still log and no count breaks.
 */
export const VISITOR_DAY_CAP = 5000;
