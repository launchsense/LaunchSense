import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bandPartition,
  featureVector,
  hingeLoss,
  kendallTau,
  normalize,
  orderByWorth,
  project,
  rotationAngle,
  swapDistance,
  TABLE_WEIGHTS,
  tableOrderOf,
  topKHits,
  zeroMissViolations,
} from "../shared/reports/ranking.ts";

const f = (fingerprint, severity, ruleId = "code.sql-pattern") => ({ fingerprint, severity, ruleId, title: fingerprint });

// A mixed high band: two credential rows and two exec rows, interleaved by fingerprint.
const band = [
  f("a1", "high", "code.child-process"),
  f("a2", "high", "secret.credential-pattern"),
  f("a3", "high", "code.child-process"),
  f("a4", "high", "secret.credential-pattern"),
];

test("band partition keeps info out and groups by severity", () => {
  const bands = bandPartition([...band, f("i1", "info")]);
  assert.equal(bands.get("info"), undefined);
  assert.equal(bands.get("high")?.length, 4);
});

test("table order puts credential rows first, then fingerprint", () => {
  assert.deepEqual(tableOrderOf(band), ["a2", "a4", "a1", "a3"]);
});

test("table order equals itself, tau is 1", () => {
  const o = tableOrderOf(band);
  assert.equal(kendallTau(o, o), 1);
});

test("reversing an order gives tau -1", () => {
  const o = tableOrderOf(band);
  assert.equal(kendallTau(o, [...o].reverse()), -1);
});

test("feature vector and projection read the credential flag", () => {
  const cred = featureVector(f("x", "high", "secret.credential-pattern"), 4);
  const exec = featureVector(f("y", "high", "code.child-process"), 4);
  assert.equal(project(cred, TABLE_WEIGHTS) > project(exec, TABLE_WEIGHTS), true);
});

test("rotation angle is zero for identical rays and grows with a tilt", () => {
  assert.equal(rotationAngle(TABLE_WEIGHTS, TABLE_WEIGHTS), 0);
  const tilt = { ...TABLE_WEIGHTS, siblings: 1 };
  assert.ok(rotationAngle(TABLE_WEIGHTS, tilt) > 0);
});

test("normalize returns a unit ray", () => {
  const n = normalize({ high: 0, medium: 0, low: 0, credential: 3, siblings: 4 });
  assert.ok(Math.abs(Math.sqrt(n.credential ** 2 + n.siblings ** 2) - 1) < 1e-9);
});

test("hinge loss is zero on a correct order and positive on a wrong one", () => {
  const labels = new Map([["a2", 1], ["a4", 1], ["a1", 0], ["a3", 0]]);
  const good = ["a2", "a4", "a1", "a3"];
  const bad = ["a1", "a3", "a2", "a4"];
  assert.equal(hingeLoss(good, labels), 0);
  assert.ok(hingeLoss(bad, labels) > 0);
});

test("top-k hit rate counts positives in the first k", () => {
  const labels = new Map([["a2", 1], ["a4", 1], ["a1", 0]]);
  assert.equal(topKHits(["a2", "a4", "a1"], labels, 3), 1);
  assert.equal(topKHits(["a1", "a2", "a4"], labels, 1), 0);
});

test("zero-miss guard fires when a label-positive top-3 row is dropped", () => {
  const labels = new Map([["a2", 1], ["a4", 1], ["a1", 0], ["a3", 0]]);
  const table = ["a2", "a4", "a1", "a3"];
  assert.deepEqual(zeroMissViolations(table, table, labels), []);
  assert.deepEqual(zeroMissViolations(["a1", "a2", "a3", "a4"], table, labels), ["a4"]);
});

test("swap distance measures total movement", () => {
  const table = ["a2", "a4", "a1", "a3"];
  assert.equal(swapDistance(table, table), 0);
  assert.equal(swapDistance(["a4", "a2", "a1", "a3"], table), 2);
});

test("orderByWorth reorders inside the band and keeps unknown rows on the floor", () => {
  const worth = new Map([["a1", 0.5], ["a3", 0.9]]);
  const out = orderByWorth(band, worth);
  // a3 outranks a1 by worth, a2 and a4 keep nothing and stay on the floor index.
  assert.ok(out.indexOf("a3") < out.indexOf("a1"));
});
