import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isAbandonedQueuedRow, isStaleRunningRow } from "../shared/queue.ts";

// W1. A visitor who hit the queue and gave up used to leak a scanQueue row
// forever, which inflated every later visitor's reported position.
//
// NOT TESTABLE HERE, and stated rather than faked: real FIFO position
// preservation across a resume, sweep atomicity under a concurrent claim, and
// cron cadence all need the Convex runtime. There is no convex-test dependency
// in this repo, and a hand-rolled ctx.db mock would only assert what the mock
// says. Those need manual dashboard verification.

const quota = readFileSync(new URL("../convex/scans/quota.ts", import.meta.url), "utf8");
const crons = readFileSync(new URL("../convex/crons.ts", import.meta.url), "utf8");
const guest = readFileSync(new URL("../src/features/scan/GuestScan.tsx", import.meta.url), "utf8");

const TTL = 600000;
const NOW = 1_700_000_000_000;

describe("abandoned queue row predicate", () => {
  it("treats an old waiting row as abandoned", () => {
    assert.equal(isAbandonedQueuedRow({ startedAt: 0, queuedAt: NOW - TTL - 1 }, NOW, TTL), true);
  });

  it("keeps a waiting row that is still inside the window", () => {
    assert.equal(isAbandonedQueuedRow({ startedAt: 0, queuedAt: NOW - TTL + 1 }, NOW, TTL), false);
    assert.equal(isAbandonedQueuedRow({ startedAt: 0, queuedAt: NOW }, NOW, TTL), false);
  });

  it("never sweeps a started row, whatever its age", () => {
    // This is the property that protects a slot a concurrent claim just took.
    assert.equal(isAbandonedQueuedRow({ startedAt: NOW, queuedAt: 0 }, NOW, TTL), false);
    assert.equal(isAbandonedQueuedRow({ startedAt: 1, queuedAt: 0 }, NOW, TTL), false);
  });

  it("excludes the exact TTL boundary so two sweeps cannot race a fencepost", () => {
    assert.equal(isAbandonedQueuedRow({ startedAt: 0, queuedAt: NOW - TTL }, NOW, TTL), false);
  });

  it("survives a very old queuedAt on a started row", () => {
    assert.equal(isAbandonedQueuedRow({ startedAt: NOW - 10 * TTL, queuedAt: 0 }, NOW, TTL), false);
  });
});

describe("stale running row predicate", () => {
  it("flags a running row past the stale window", () => {
    assert.equal(isStaleRunningRow({ startedAt: NOW - 200000 }, NOW, 180000), true);
  });

  it("keeps a running row inside the window", () => {
    assert.equal(isStaleRunningRow({ startedAt: NOW - 1000 }, NOW, 180000), false);
  });

  it("never flags a waiting row, which is not running", () => {
    assert.equal(isStaleRunningRow({ startedAt: 0 }, NOW, 180000), false);
  });
});

describe("the sweep cannot delete a claimed row", () => {
  it("re-reads the row inside the mutation before deleting", () => {
    const sweep = quota.slice(quota.indexOf("sweepAbandonedQueue"));
    const body = sweep.slice(0, sweep.indexOf("export const releaseSlot"));
    assert.match(body, /ctx\.db\.get\("scanQueue"/, "the sweep must re-read the row, not trust an earlier filter");
    const readIndex = body.indexOf('ctx.db.get("scanQueue"');
    const deleteIndex = body.indexOf("ctx.db.delete");
    const guardIndex = body.indexOf("isAbandonedQueuedRow");
    assert.ok(readIndex < guardIndex, "re-read must come before the eligibility check");
    assert.ok(guardIndex < deleteIndex, "eligibility check must come before the delete");
  });

  it("gates the delete on the predicate, not on age alone", () => {
    const sweep = quota.slice(quota.indexOf("sweepAbandonedQueue"));
    const body = sweep.slice(0, sweep.indexOf("export const releaseSlot"));
    assert.match(body, /if \(!isAbandonedQueuedRow\([\s\S]*?continue;/);
  });

  it("bounds the batch so one sweep cannot produce an oversized transaction", () => {
    assert.match(quota, /const SWEEP_BATCH = \d+;/);
    assert.match(quota, /\.take\(SWEEP_BATCH\)/);
  });

  it("uses a 10 minute TTL, well above the 60 second client wait", () => {
    assert.match(quota, /const ABANDONED_WAITING_MS = 600000;/);
  });
});

describe("the sweep is scheduled", () => {
  it("registers a recurring job for it", () => {
    assert.match(crons, /sweepAbandonedQueue/);
    assert.match(crons, /crons\.interval\(/);
    assert.match(crons, /minutes: 5/);
  });
});

describe("resume keeps the visitor's place", () => {
  it("resumes with analyzeScan on the stored scanId", () => {
    assert.match(guest, /async function onResume\(\)/);
    const resume = guest.slice(guest.indexOf("async function onResume()"));
    const body = resume.slice(0, resume.indexOf("async function onShare"));
    assert.match(body, /analyzeScan\(\{ scanId: queuedScan\.scanId \}\)/);
  });

  it("never calls runScan on the resume path", () => {
    const resume = guest.slice(guest.indexOf("async function onResume()"));
    const body = resume.slice(0, resume.indexOf("async function onShare"));
    assert.doesNotMatch(body, /runScan\(/, "runScan would mint a new scan and drop the visitor to the back");
  });

  it("falls back honestly when the queued scan no longer exists", () => {
    const resume = guest.slice(guest.indexOf("async function onResume()"));
    const body = resume.slice(0, resume.indexOf("async function onShare"));
    assert.match(body, /setQueuedScan\(null\)/);
    assert.match(body, /Press Run scan to start a new one/);
  });

  it("tells the visitor the difference between resuming and starting over", () => {
    assert.match(guest, /picks up from that same place/);
    assert.match(guest, /starts a new scan\s+at the back of the line/);
  });

  it("clears the held scan when a new scan is started", () => {
    assert.match(guest, /setQueuedScan\(null\);\s*\n\s*setPhase\("fetching"\)/);
  });
});