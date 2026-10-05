import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

// Nothing in this repo had a scheduled job, so queue rows from a visitor who
// gave up waiting were never removed. This runs the sweep every 5 minutes,
// which keeps the table near empty against a 10 minute abandonment TTL.
const crons = cronJobs();

// 5 minutes: frequent enough that abandoned rows disappear quickly, rare enough
// to be one small indexed query.
crons.interval("sweep abandoned queue", { minutes: 5 }, internal.scans.quota.sweepAbandonedQueue, {});

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

export default crons;