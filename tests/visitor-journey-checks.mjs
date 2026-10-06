import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  visitorIdOrNull,
  VISITOR_DAY_CAP,
} from "../shared/visitorId.ts";
import {
  deriveVisitors,
} from "../shared/visitorJourney.ts";

// Unique visitors, the user journey, and structured feedback. Three defects,
// one file of tests.
//
// 1. Total unique users was unmeasurable: guests share one quota bucket and the
//    analytics rule allowed exactly one identifier, the repo id. The anonymous
//    visitor id closes that gap without naming a person, a device, or an
//    address. A column that could hold any of those would be PII, and this is
//    where that has to stop.
// 2. The journey had no evidence: visits, scans, shares, and rescans lived in
//    separate rows with no shared key. The visitor id joins them in memory in
//    the fold, and only counts are stored.
// 3. Feedback had no channel except free text, which the analytics rule
//    forbids on a row. The widget asks one boolean plus one of six fixed
//    labels, and the write path stores nothing else.
//
// No network, no database, and no clock. Pure helpers are imported directly,
// everything else is read as repo text.

const queries = readFileSync(new URL("../convex/scans/queries.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("../convex/schema.ts", import.meta.url), "utf8");
const widget = readFileSync(
  new URL("../src/features/report/ReportFeedback.tsx", import.meta.url),
  "utf8",
);

describe("the visitor id carries no identity", () => {
  it("keeps a minted UUID and lower-cases it", () => {
    assert.equal(
      visitorIdOrNull("A1B2C3D4-E5F6-7890-ABCD-EF1234567890"),
      "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    );
  });

  it("drops anything that is not the minted shape, including an email", () => {
    assert.equal(visitorIdOrNull("ada@example.com"), undefined);
    assert.equal(visitorIdOrNull("not-a-uuid"), undefined);
    assert.equal(visitorIdOrNull(""), undefined);
    assert.equal(visitorIdOrNull(undefined), undefined);
  });

  it("caps new ids per day, so one caller cannot fill the table", () => {
    assert.ok(Number.isInteger(VISITOR_DAY_CAP) && VISITOR_DAY_CAP > 0);
    assert.match(queries, /visitor:\$\{day\}/);
  });

  it("never lets a visitor id become a metric dimension", () => {
    const seen = [];
    deriveVisitors(
      [{ visitorId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }],
      [{ kind: "scan_started", scanId: "s1", visitorId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }],
      new Set(),
      (metric, dims, count) => seen.push([metric, dims, count]),
    );
    for (const [, dims] of seen) {
      assert.deepEqual(Object.keys(dims), ["surface"]);
      for (const value of Object.values(dims)) {
        assert.doesNotMatch(value, /[0-9a-f]{8}-/);
      }
    }
  });
});

describe("the journey folds to counts", () => {
  it("declares the visitor and feedback metrics", () => {
    const rollup = readFileSync(new URL("../convex/analytics/rollup.ts", import.meta.url), "utf8");
    const block = rollup.slice(rollup.indexOf("export const METRIC_NAMES"));
    for (const name of [
      "visitors",
      "visitors_with_scan",
      "visitors_with_share",
      "visitors_with_rescan",
      "report_feedback",
    ]) {
      assert.ok(block.includes(`"${name}"`), `METRIC_NAMES is missing ${name}`);
    }
  });

  it("joins stages on the visitor id in memory", () => {
    const seen = new Map();
    deriveVisitors(
      [{ visitorId: "v1" }, { visitorId: "v2" }, { visitorId: "v3" }],
      [
        { kind: "scan_started", scanId: "s1", visitorId: "v1" },
        { kind: "scan_started", scanId: "s2", visitorId: "v1" },
        { kind: "scan_started", scanId: "s3", visitorId: "v2" },
        { kind: "share_created", scanId: "s1", visitorId: "v1" },
      ],
      new Set(["s2"]),
      (metric, dims, count = 1) => seen.set(metric, count),
    );
    assert.equal(seen.get("visitors"), 3);
    assert.equal(seen.get("visitors_with_scan"), 2);
    assert.equal(seen.get("visitors_with_share"), 1);
    assert.equal(seen.get("visitors_with_rescan"), 1);
  });

  it("ignores events with no visitor id rather than guessing", () => {
    const seen = new Map();
    deriveVisitors(
      [],
      [{ kind: "scan_started", scanId: "s9" }],
      new Set(),
      (metric, dims, count = 1) => seen.set(metric, count),
    );
    assert.equal(seen.get("visitors_with_scan"), 0);
  });

  it("splits feedback by useful and reason, and skips incomplete rows", () => {
    const seen = [];
    deriveVisitors(
      [],
      [
        { kind: "report_feedback", scanId: "s1", feedbackUseful: true, feedbackReason: "found_issue" },
        { kind: "report_feedback", scanId: "s2", feedbackUseful: false, feedbackReason: "too_noisy" },
        { kind: "report_feedback", scanId: "s3" },
      ],
      new Set(),
      (metric, dims, count = 1) => {
        if (metric === "report_feedback") seen.push([metric, dims, count]);
      },
    );
    assert.deepEqual(seen, [
      ["report_feedback", { useful: "yes", reason: "found_issue" }, 1],
      ["report_feedback", { useful: "no", reason: "too_noisy" }, 1],
    ]);
  });
});

describe("feedback is closed vocabulary end to end", () => {
  it("declares report_feedback in both analytics unions", () => {
    assert.match(queries, /v\.literal\("report_feedback"\)/);
    assert.match(schema, /v\.literal\("report_feedback"\)/);
  });

  it("offers six fixed reasons and no text box", () => {
    for (const reason of [
      "found_issue",
      "fix_prompt_helped",
      "too_noisy",
      "confusing",
      "missing_check",
      "other",
    ]) {
      assert.ok(widget.includes(`"${reason}"`), `widget is missing the reason ${reason}`);
    }
    assert.doesNotMatch(widget, /<textarea/);
    assert.doesNotMatch(widget, /type="text"/);
  });

  it("stores feedback fields only on feedback rows", () => {
    assert.match(queries, /args\.kind === "report_feedback" \? args\.feedbackUseful : undefined/);
    assert.match(queries, /args\.kind === "report_feedback" \? args\.feedbackReason : undefined/);
  });
});

describe("the new copy stays inside house style", () => {
  it("uses no em dash, en dash, ellipsis, or middle dot in the new surfaces", () => {
    for (const [name, text] of [
      ["ReportFeedback.tsx", widget],
      ["useVisitorId.ts", readFileSync(new URL("../src/features/scan/useVisitorId.ts", import.meta.url), "utf8")],
    ]) {
      for (const character of [/\u2014/, /\u2013/, /\u2026/, /\u00b7/]) {
        assert.doesNotMatch(text, character, `${name} contains ${character}`);
      }
    }
  });
});
