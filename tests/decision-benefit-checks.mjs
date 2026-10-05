// Does the decision lane actually beat the deterministic table floor?
//
// The lane (shared/reports/priority.ts rankFromAnswers) lets a model reorder the
// findings the fixed checks produced. The floor (tableOrder) is always present.
// The operator's question is which one a builder should actually read.
//
// These tests lock three things:
//
//   1. The metric definitions, with hand-computed numbers, so a change to the
//      scorer cannot quietly flatter the lane.
//   2. The product invariants, on a seeded pseudo-random fixture: within a
//      severity band only, never add or drop a finding, and a missing or
//      non-numeric answer is neutral.
//   3. The mechanism, on a synthetic fixture where an informative answer exists.
//      There the lane must score at least as well as the table, and must score
//      strictly better when the table had a fix-first row sitting low.
//
// What these tests do NOT show, stated plainly so no one reads more into them:
// nothing here calls Jev, Perplexity, or Ollama. The answers in fixture 3 are
// hand-written stand-ins for an informative model. They prove the lane is wired
// so that an informative answer is used, not that any hosted rung produces one.
// The real numbers, and the honest "unknown" for the unlabelled bands, live in
// state/run/decision-benefit.md.
//
// Run: node --test tests/decision-benefit-checks.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addedOrDropped,
  bandCrossed,
  pairwiseAccuracyWithinBand,
  pairwiseCountsWithinBand,
  positivesInOrder,
  scoreOrders,
  severityOrderViolations,
  topKHitRate,
} from "../shared/reports/decisionBenefit.ts";
import { questionIdFor, rankFromAnswers, tableOrder } from "../shared/reports/priority.ts";

const f = (fingerprint, severity, ruleId = "code.sql-pattern") => ({
  fingerprint,
  severity,
  ruleId,
  title: fingerprint,
});

/** Severity rank used only to assert the band invariant in this file. */
const SEVERITY_RANK = { high: 0, medium: 1, low: 2, info: 3 };

// ---------------------------------------------------------------------------
// 1. The metric definitions, hand computed.
// ---------------------------------------------------------------------------

test("topKHitRate is the share of label-positive rows found in the first k", () => {
  // Two positives, k = 2, one order with neither in the top 2, one with both.
  assert.equal(topKHitRate(["x", "y", "a", "b"], new Set(["a", "b"]), 2), 0);
  assert.equal(topKHitRate(["a", "x", "y", "b"], new Set(["a", "b"]), 2), 0.5);
  assert.equal(topKHitRate(["b", "a", "x", "y"], new Set(["a", "b"]), 2), 1);
});

test("topKHitRate has no power on a uniform band, and says so instead of scoring", () => {
  // Every row is label-positive, so every order scores 1. This is the case that
  // makes "the model moved nothing" unmeasurable rather than measured.
  const uniform = new Set(["a", "b", "c", "d"]);
  assert.equal(topKHitRate(["a", "b", "c", "d"], uniform, 3), 1);
  assert.equal(topKHitRate(["d", "c", "b", "a"], uniform, 3), 1);
  // No positives at all is not a pass, it is an absent measurement.
  assert.equal(topKHitRate(["a", "b"], new Set(), 2), 1);
  assert.equal(positivesInOrder(new Set(), ["a", "b"]), 0);
});

test("pairwise accuracy counts only same-band pairs whose labels differ", () => {
  const sev = new Map([
    ["a", "medium"],
    ["b", "medium"],
    ["c", "medium"],
    ["h", "high"],
  ]);
  const of = (key) => sev.get(key);
  const labels = new Set(["a"]);

  // a before b and c: both pairs correct, 2 of 2.
  const counts = pairwiseCountsWithinBand(["a", "b", "c", "h"], labels, of);
  assert.equal(counts.total, 2);
  assert.equal(counts.correct, 2);
  assert.equal(pairwiseAccuracyWithinBand(["a", "b", "c", "h"], labels, of), 1);

  // b and c before a: 0 of 2.
  assert.equal(pairwiseAccuracyWithinBand(["b", "c", "a", "h"], labels, of), 0);

  // A high row is in another band, so pairing it with a medium row never counts.
  assert.equal(pairwiseCountsWithinBand(["h", "a", "b", "c"], labels, of).total, 2);

  // A band with no label-differing pair has nothing to be right or wrong about.
  assert.equal(pairwiseCountsWithinBand(["b", "c", "h"], new Set(), of).total, 0);
  assert.equal(pairwiseAccuracyWithinBand(["b", "c", "h"], new Set(), of), 1);
});

test("bandCrossed is exactly a severity difference, in both directions", () => {
  assert.equal(bandCrossed(f("a", "high"), f("b", "medium")), true);
  assert.equal(bandCrossed(f("a", "high"), f("b", "high")), false);
  assert.equal(bandCrossed(f("a", "low"), f("b", "info")), true);
});

test("addedOrDropped compares multisets, so a duplicated row still counts twice", () => {
  assert.deepEqual(addedOrDropped(["a", "b", "c"], ["c", "b", "a"]), []);
  assert.deepEqual(addedOrDropped(["a", "b", "c"], ["a", "c"]), ["b"]);
  assert.deepEqual(addedOrDropped(["a", "b"], ["a", "b", "d"]), ["d"]);
  // A row repeated twice and kept once is a dropped row, not a set difference.
  assert.deepEqual(addedOrDropped(["a", "a", "b"], ["a", "b"]), ["a"]);
});

test("severityOrderViolations names a row sitting above a better row", () => {
  const rows = [f("h", "high"), f("m1", "medium"), f("m2", "medium"), f("l", "low")];
  // Ranks 0,1,1,2 are non-decreasing, so severity groups stay contiguous.
  assert.deepEqual(severityOrderViolations(["h", "m1", "m2", "l"], rows), []);
  // Ranks 0,2,1,1: the low row sits above a medium, so it is the one out of place.
  assert.deepEqual(severityOrderViolations(["h", "l", "m1", "m2"], rows), ["l"]);
  // Reversing one band puts the second medium above the high row.
  assert.deepEqual(severityOrderViolations(["m2", "m1", "h"], rows), ["m1"]);
  // A key with no finding behind it has no legal position at all.
  assert.deepEqual(severityOrderViolations(["h", "ghost", "m1"], rows), ["ghost"]);
});

// ---------------------------------------------------------------------------
// 2. The synthetic band fixture. Six medium findings, no credential shapes, so
// the table's only tiebreak is the fingerprint and the floor is reproducible.
// Two of the six are labelled fix-first.
// ---------------------------------------------------------------------------

const SYNTHETIC = [
  f("code.sql-pattern:24:src/api/users.ts:4a1c9e02", "medium"),
  f("code.inner-html:88:src/views/Comment.tsx:1f0b7d33", "medium"),
  f("code.eval-use:12:src/tools/report.ts:77c2ae18", "medium"),
  f("code.child-process:31:scripts/build.sh:2b8d5f60", "medium"),
  f("code.debug-leftover:40:src/lib/cache.ts:9e0a2c74", "medium"),
  f("code.weak-crypto:55:src/crypto/sign.ts:3d5f8b91", "medium"),
];

const SYNTHETIC_LABELS = new Set([
  "code.sql-pattern:24:src/api/users.ts:4a1c9e02",
  "code.inner-html:88:src/views/Comment.tsx:1f0b7d33",
]);

/** Stand-in for an informative model: the two labelled rows answered high. */
function informativeAnswers(worthByFingerprint) {
  const answers = {};
  for (const [fingerprint, noul] of Object.entries(worthByFingerprint)) {
    answers[questionIdFor(fingerprint)] = { type: "noul", noul };
  }
  return answers;
}

test("the synthetic band: an informative answer scores at least as well as the table", () => {
  const worth = {};
  for (const finding of SYNTHETIC) {
    worth[finding.fingerprint] = SYNTHETIC_LABELS.has(finding.fingerprint) ? 0.95 : 0.05;
  }

  const scored = scoreOrders(SYNTHETIC, informativeAnswers(worth), SYNTHETIC_LABELS, 2);

  console.log(
    [
      "",
      "TRACK C synthetic fixture: 6 medium findings, 2 labelled fix-first, k=2",
      `  table order: ${scored.tableOrder.map((key) => key.split(":")[1]).join(", ")}`,
      `  model order: ${scored.modelOrder.map((key) => key.split(":")[1]).join(", ")}`,
      `  top-3-style hit rate   table ${scored.table.topKHitRate}  model ${scored.model.topKHitRate}  delta ${scored.delta.topKHitRate}`,
      `  within-band pair acc  table ${scored.table.pairwiseAccuracyWithinBand}  model ${scored.model.pairwiseAccuracyWithinBand}  delta ${scored.delta.pairwiseAccuracyWithinBand}`,
      `  discriminating pairs ${scored.table.discriminatingPairs}, positives ${scored.table.positives}, positions moved ${scored.moved}`,
      `  invariants held: ${scored.invariantsHeld}`,
      "",
    ].join("\n"),
  );

  // The floor really does bury the labelled rows, so the comparison is not
  // comparing two identical orders.
  const floorTop = new Set(scored.tableOrder.slice(0, 2));
  const buried = [...SYNTHETIC_LABELS].filter((key) => !floorTop.has(key));
  assert.equal(buried.length, 2, "the table floor leaves both fix-first rows outside the top 2");

  assert.equal(scored.table.topKHitRate, 0);
  assert.equal(scored.model.topKHitRate, 1);
  assert.ok(
    scored.model.topKHitRate >= scored.table.topKHitRate,
    "the model order is never worse than the table order on this fixture",
  );
  assert.ok(
    scored.model.pairwiseAccuracyWithinBand > scored.table.pairwiseAccuracyWithinBand,
    "with an informative answer the lane beats the floor on within-band pairs too",
  );
  assert.equal(scored.table.discriminatingPairs, 8, "2 positives x 4 negatives inside one band");
  assert.equal(scored.model.discriminatingPairs, 8);
  assert.equal(scored.invariantsHeld, true);
  assert.equal(scored.modelOrder.length, 6);
  assert.deepEqual(addedOrDropped(scored.tableOrder, scored.modelOrder), []);
});

test("table wins: a band with nothing to say scores the same both ways", () => {
  // Uninformative in two different ways: no answers at all, then a flat answer.
  const flat = {};
  for (const finding of SYNTHETIC) flat[finding.fingerprint] = 0.5;
  const cases = [
    ["no answers", null],
    ["empty answers", {}],
    ["one flat answer everywhere", informativeAnswers(flat)],
  ];
  for (const [name, answers] of cases) {
    const scored = scoreOrders(SYNTHETIC, answers, SYNTHETIC_LABELS, 2);
    console.log(
      `  table-wins case "${name}": sameAsFloor=${scored.invariants.neutral} ` +
        `delta=${scored.delta.topKHitRate}, table=${scored.table.topKHitRate}, model=${scored.model.topKHitRate}`,
    );
    assert.deepEqual(scored.modelOrder, scored.tableOrder, `${name} must not move the order`);
    assert.equal(scored.invariants.neutral, true);
    assert.equal(scored.delta.topKHitRate, 0);
    assert.equal(scored.delta.pairwiseAccuracyWithinBand, 0);
    assert.equal(scored.invariantsHeld, true);
  }
  // The uninformative floor scores poorly, and it is reported as such rather
  // than hidden behind the word "neutral".
  const floorOnly = scoreOrders(SYNTHETIC, null, SYNTHETIC_LABELS, 2);
  assert.equal(floorOnly.table.topKHitRate, 0);
  assert.equal(floorOnly.source, "table");
});

// ---------------------------------------------------------------------------
// 3. The product invariants, on a seeded pseudo-random fixture.
// ---------------------------------------------------------------------------

/** Linear congruential generator. Fixed seed, so this fixture never drifts. */
function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const RULE_IDS = [
  "code.sql-pattern",
  "code.eval-use",
  "code.inner-html",
  "code.child-process",
  "code.debug-leftover",
  "secret.credential-pattern",
  "secret.sql-pattern",
  "license.policy",
];
const SEVERITIES = ["high", "high", "medium", "medium", "medium", "low", "info"];

function pseudoFindings(seed, count) {
  const next = lcg(seed);
  const seen = new Set();
  const rows = [];
  for (let i = 0; i < count; i++) {
    const ruleId = RULE_IDS[Math.floor(next() * RULE_IDS.length)];
    const severity = SEVERITIES[Math.floor(next() * SEVERITIES.length)];
    let fingerprint = `${ruleId}:${i}:src/mod${i % 7}/file${i}.ts:${Math.floor(next() * 1e8)
      .toString(16)
      .padStart(8, "0")}`;
    // Collisions would hide a real add-or-drop bug behind a set lookup.
    while (seen.has(fingerprint)) fingerprint = `${fingerprint}~${i}`;
    seen.add(fingerprint);
    rows.push(f(fingerprint, severity, ruleId));
  }
  return rows;
}

function pseudoAnswers(seed, rows) {
  const next = lcg(seed + 1);
  const answers = {};
  for (const row of rows) {
    const roll = next();
    if (roll < 0.2) continue; // the lane did not answer this one
    if (roll < 0.3) {
      // Answered, but not with a number. Must read as neutral, never as false.
      answers[questionIdFor(row.fingerprint)] = { type: "noul" };
      continue;
    }
    if (roll < 0.35) {
      // A numeric string is still not a number.
      answers[questionIdFor(row.fingerprint)] = { type: "noul", noul: "0.99" };
      continue;
    }
    answers[questionIdFor(row.fingerprint)] = { type: "noul", noul: Number(next().toFixed(4)) };
  }
  return answers;
}

test("the lane never crosses a severity band and never adds or drops a finding", () => {
  for (const seed of [1, 7, 99, 20251005]) {
    const rows = pseudoFindings(seed, 40);
    const answers = pseudoAnswers(seed, rows);
    const actionable = rows.filter((row) => row.severity !== "info");
    const floor = tableOrder(actionable);
    const result = rankFromAnswers(rows, answers, "jev");

    // Info is not an action, so it is absent from both sides by construction.
    assert.equal(result.order.length, actionable.length, `seed ${seed}: length`);
    assert.deepEqual(addedOrDropped(floor, result.order), [], `seed ${seed}: add or drop`);

    // No row may sit under a strictly more severe row.
    const violations = severityOrderViolations(result.order, rows);
    assert.deepEqual(violations, [], `seed ${seed}: band crossings`);

    // Independent restatement of the same invariant, written differently from
    // the helper: the severity sequence must equal its own sorted copy.
    const ranks = result.order.map(
      (key) => SEVERITY_RANK[rows.find((row) => row.fingerprint === key).severity],
    );
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), `seed ${seed}: ranks out of order`);

    // The same run, scored, must also report clean invariants.
    const scored = scoreOrders(rows, answers, new Set(actionable.slice(0, 6).map((r) => r.fingerprint)), 3);
    assert.equal(scored.invariantsHeld, true, `seed ${seed}: invariantsHeld`);
    assert.deepEqual(scored.invariants.addedOrDropped, []);
    assert.deepEqual(scored.invariants.bandCrossings, []);
  }
});

test("a missing or non-numeric answer is neutral, and returns the table floor", () => {
  const rows = pseudoFindings(4242, 24);
  const actionable = rows.filter((row) => row.severity !== "info");
  const floor = tableOrder(actionable);

  const cases = {
    null: null,
    "empty object": {},
    "answer with no number": { [questionIdFor(actionable[0].fingerprint)]: { type: "noul" } },
    "answer with a numeric string": {
      [questionIdFor(actionable[0].fingerprint)]: { type: "noul", noul: "1.0" },
    },
    "answer for a key that was never asked": { "wnotarealkey": { type: "noul", noul: 1 } },
  };

  for (const [name, answers] of Object.entries(cases)) {
    const result = rankFromAnswers(rows, answers, "jev");
    assert.deepEqual(result.order, floor, `${name} must equal the table floor`);
    assert.equal(result.note.includes("did not choose"), true, `${name} note`);
  }

  // A null answers object is reported as the floor, not as a rung that ran.
  assert.equal(rankFromAnswers(rows, null, "jev").source, "table");
});

test("a confident wrong answer cannot lift a medium row above a high one", () => {
  const medium = f("code.sql-pattern:9:src/db/pool.ts:11112222", "medium");
  const high = f("code.eval-use:3:src/app/eval.ts:33334444", "high");
  const answers = {
    [questionIdFor(medium.fingerprint)]: { type: "noul", noul: 1 },
    [questionIdFor(high.fingerprint)]: { type: "noul", noul: 0 },
  };
  const result = rankFromAnswers([medium, high], answers, "jev");
  assert.equal(result.order[0], high.fingerprint, "severity wins over a confident answer");
  assert.deepEqual(addedOrDropped(tableOrder([medium, high]), result.order), []);
  assert.deepEqual(severityOrderViolations(result.order, [medium, high]), []);
});