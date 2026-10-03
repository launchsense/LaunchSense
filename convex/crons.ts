import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

// Nothing in this repo had a scheduled job, so queue rows from a visitor who
// gave up waiting were never removed. This runs the sweep every 5 minutes,
// which keeps the table near empty against a 10 minute abandonment TTL.
const crons = cronJobs();

// 5 minutes: frequent enough that abandoned rows disappear quickly, rare enough
// to be one small indexed query.
crons.interval("sweep abandoned queue", { minutes: 5 }, internal.scans.quota.sweepAbandonedQueue, {});

export default crons;