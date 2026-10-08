import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

// Archived web scan queue sweep went with convex/scans. Analytics crons stay.
const crons = cronJobs();

// 03:20 UTC, once a day. It folds YESTERDAY, not today, so a day's numbers do not
// change under a reader while they are being read. Late enough that a UTC day has
// closed and every scan of it has reached a terminal status or has not.
crons.daily("roll up analytics", { hourUTC: 3, minuteUTC: 20 }, internal.analytics.rollup.rollupDaily, {});

// 20 minutes later, the staging rows that fell out of the window go. Separate from
// the fold because a Convex mutation cannot call another mutation, and because a
// retention failure must not be able to leave a day's numbers half written.
//
// The cron takes no arguments on purpose. A cron argument is frozen when the module
// loads, so a Date.now() in the registration would be one fixed instant that never
// moves. The mutation computes its own cutoff at run time.
crons.daily(
  "purge expired usage events",
  { hourUTC: 3, minuteUTC: 40 },
  internal.analytics.retention.purgeExpiredUsageEvents,
  {},
);

crons.daily(
  "purge expired visitor ids",
  { hourUTC: 3, minuteUTC: 50 },
  internal.analytics.retention.purgeExpiredVisitorIds,
  {},
);

export default crons;