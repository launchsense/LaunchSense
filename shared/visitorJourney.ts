// The visitor journey, derived in memory and stored as counts only.
//
// visited comes from visitorDays (one row per visitor per day by construction).
// Every later stage joins on the visitorId the browser sent with its events:
// scanned, shared, and rescanned. Feedback rows carry a boolean plus one of
// six closed labels, and incomplete rows are skipped rather than guessed.
// No visitor id ever becomes a dimension: the id counts, the row never names.
//
// Pure on purpose, like the rest of shared/: the Convex fold calls it, and
// tests import it directly with no database behind it.

export type JourneyEvent = {
  kind: string;
  scanId?: string;
  visitorId?: string;
  feedbackUseful?: boolean;
  feedbackReason?: string;
};

export function deriveVisitors(
  visitorDays: ReadonlyArray<{ visitorId: string }>,
  events: ReadonlyArray<JourneyEvent>,
  rescanScanIds: ReadonlySet<string>,
  add: (metric: string, dims: Record<string, string>, count?: number) => void,
): void {
  add("visitors", { surface: "all" }, visitorDays.length);
  const scanned = new Set<string>();
  const shared = new Set<string>();
  const rescanned = new Set<string>();
  for (const event of events) {
    const visitor = event.visitorId;
    if (event.kind === "report_feedback") {
      if (event.feedbackUseful !== undefined && event.feedbackReason !== undefined) {
        add(
          "report_feedback",
          { useful: event.feedbackUseful ? "yes" : "no", reason: event.feedbackReason },
          1,
        );
      }
      continue;
    }
    if (typeof visitor !== "string" || visitor.length === 0) continue;
    if (event.kind === "scan_started") {
      scanned.add(visitor);
      if (event.scanId !== undefined && rescanScanIds.has(event.scanId)) {
        rescanned.add(visitor);
      }
    } else if (event.kind === "share_created") {
      shared.add(visitor);
    }
  }
  add("visitors_with_scan", { surface: "all" }, scanned.size);
  add("visitors_with_share", { surface: "all" }, shared.size);
  add("visitors_with_rescan", { surface: "all" }, rescanned.size);
}
