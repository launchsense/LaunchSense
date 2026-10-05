import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildVerdict, buildNotCheckedList, SCOPE_LABEL } from "../shared/reports/scope.ts";

// The defect this guards: "No findings. The checks found nothing to flag." read as
// a clean bill of health, while the qualifying scope sat about 60 lines below it,
// after the report, the rescan block, four signal tabs, and the compare view.

const BASE = {
  fetched: 12,
  skipped: 0,
  total: 340,
  findingCount: 0,
  actionableCount: 0,
  status: "completed",
};

describe("buildVerdict", () => {
  it("never lets a clean result read as safe on its own", () => {
    const v = buildVerdict(BASE);
    assert.match(v.headline, /not a clean bill of health/i);
    assert.doesNotMatch(v.headline, /\b(safe|secure|all clear|good to go)\b/i);
  });

  it("puts the read coverage in the scope line, not only in the headline", () => {
    const v = buildVerdict(BASE);
    assert.match(v.scope, /read 12 of 340 files/i);
    assert.match(v.scope, /were not read/i);
  });

  it("reports the unfinished state rather than a result when the scan failed", () => {
    const v = buildVerdict({ ...BASE, status: "failed" });
    assert.match(v.headline, /did not finish/i);
    assert.equal(v.state, "notChecked");
  });

  it("calls a skipped-file scan partial and still gives the counts", () => {
    const v = buildVerdict({
      ...BASE,
      fetched: 200,
      skipped: 140,
      status: "partial",
      findingCount: 3,
      actionableCount: 3,
    });
    assert.equal(v.state, "partial");
    assert.match(v.headline, /partial/i);
    assert.match(v.headline, /3 to fix/i);
    const contents = v.stages.find((s) => s.label === "File contents");
    assert.equal(contents?.state, "partial");
    assert.match(contents?.detail ?? "", /Read 200, skipped 140/);
  });

  it("counts info findings as notes, not things to fix", () => {
    const mixed = buildVerdict({ ...BASE, findingCount: 4, actionableCount: 3 });
    assert.match(mixed.headline, /3 to fix/);
    assert.match(mixed.headline, /1 note/);
    assert.doesNotMatch(mixed.headline, /4 (thing|to fix)/);

    const allNotes = buildVerdict({ ...BASE, findingCount: 2, actionableCount: 0 });
    assert.match(allNotes.headline, /2 notes/);
    assert.doesNotMatch(allNotes.headline, /to fix/);

    const oneNote = buildVerdict({ ...BASE, findingCount: 1, actionableCount: 0 });
    assert.match(oneNote.headline, /1 note/);
    assert.doesNotMatch(oneNote.headline, /\bnotes\b/);

    const partialMixed = buildVerdict({
      ...BASE,
      status: "partial",
      skipped: 5,
      findingCount: 3,
      actionableCount: 1,
    });
    assert.match(partialMixed.headline, /1 to fix/);
    assert.match(partialMixed.headline, /2 notes/);
  });

  it("marks file contents not checked when the scan failed before reading them", () => {
    const v = buildVerdict({ ...BASE, status: "failed", fetched: 0 });
    const contents = v.stages.find((s) => s.label === "File contents");
    assert.equal(contents?.state, "notChecked");
  });

  it("says everything was read only when it actually was", () => {
    const all = buildVerdict({ ...BASE, fetched: 340, total: 340 });
    assert.match(all.scope, /read all 340 files/i);

    const some = buildVerdict(BASE);
    assert.doesNotMatch(some.scope, /read all/i);
  });

  it("marks the file list unknown when the tree never finished", () => {
    const v = buildVerdict({ ...BASE, total: undefined });
    const list = v.stages.find((s) => s.label === "File list");
    assert.equal(list?.state, "unknown");
    assert.match(v.scope, /did not finish listing/i);
  });

  it("never uses singular or plural wrongly", () => {
    const one = buildVerdict({ ...BASE, fetched: 1, total: 1, findingCount: 1, actionableCount: 1 });
    assert.match(one.scope, /read all 1 file/i);
    assert.match(one.headline, /1 to fix/i);

    const many = buildVerdict({ ...BASE, findingCount: 4, actionableCount: 4 });
    assert.match(many.headline, /4 to fix/i);
  });

  it("uses only the four defined states", () => {
    const allowed = new Set(Object.keys(SCOPE_LABEL));
    const inputs = [
      BASE,
      { ...BASE, status: "partial" },
      { ...BASE, status: "failed" },
      { ...BASE, total: undefined },
      { ...BASE, skipped: 5 },
    ];
    for (const input of inputs) {
      const v = buildVerdict(input);
      assert.ok(allowed.has(v.state), `verdict state ${v.state} is not one of the four`);
      for (const stage of v.stages) {
        assert.ok(allowed.has(stage.state), `stage state ${stage.state} is not one of the four`);
      }
    }
  });

  it("always returns a scope line, in every branch", () => {
    for (const status of ["validating", "fetching", "completed", "partial", "failed"]) {
      for (const total of [undefined, 0, 340]) {
        for (const findingCount of [0, 1, 9]) {
          const v = buildVerdict({ ...BASE, status, total, findingCount, actionableCount: findingCount });
          assert.ok(v.scope.length > 0, `empty scope for ${status}/${total}/${findingCount}`);
          assert.ok(v.headline.length > 0, `empty headline for ${status}/${total}/${findingCount}`);
        }
      }
    }
  });
});

describe("buildNotCheckedList", () => {
  it("names the guest read caps by default", () => {
    const list = buildNotCheckedList({ aiConfigured: false, liveProvided: false });
    assert.ok(list.some((l) => /200 file and 2MB/.test(l)));
    assert.ok(!list.some((l) => /1,000/.test(l)));
  });

  it("names the signed-in read caps when the scan used them", () => {
    const list = buildNotCheckedList({
      aiConfigured: true,
      liveProvided: true,
      maxFiles: 1000,
      maxBytes: 8_000_000,
    });
    assert.ok(list.some((l) => /1,000 file and 8MB/.test(l)));
    assert.ok(!list.some((l) => /200 file/.test(l)));
  });

  it("says the live app was skipped only when no URL was given", () => {
    assert.ok(buildNotCheckedList({ aiConfigured: true, liveProvided: false }).some((l) => /did not give a URL/i.test(l)));
    assert.ok(!buildNotCheckedList({ aiConfigured: true, liveProvided: true }).some((l) => /did not give a URL/i.test(l)));
  });

  it("says AI explanations were skipped only when no provider answered", () => {
    assert.ok(buildNotCheckedList({ aiConfigured: false, liveProvided: true }).some((l) => /No AI provider/i.test(l)));
    assert.ok(!buildNotCheckedList({ aiConfigured: true, liveProvided: true }).some((l) => /No AI provider/i.test(l)));
  });

  it("never claims a check that was skipped is fine", () => {
    for (const item of buildNotCheckedList({ aiConfigured: false, liveProvided: false })) {
      assert.doesNotMatch(item, /\b(pass|passed|clean|ok|fine)\b/i);
    }
  });
});

describe("verdict and scope are rendered together", () => {
  const report = readFileSync(new URL("../src/features/report/ScanReport.tsx", import.meta.url), "utf8");
  const guest = readFileSync(new URL("../src/features/scan/GuestScan.tsx", import.meta.url), "utf8");

  it("wraps the verdict and the not-checked list in one labelled region", () => {
    assert.match(report, /aria-label="Result and scope"/);
    // The headline and the scope line must be siblings inside that region.
    const region = report.slice(report.indexOf('aria-label="Result and scope"'));
    const block = region.slice(0, region.indexOf("</section>"));
    assert.match(block, /verdict\.headline/);
    assert.match(block, /verdict\.scope/);
    assert.match(block, /What was not checked/);
  });

  it("renders the scope line directly after the headline", () => {
    const headline = report.indexOf("{verdict.headline}");
    const scope = report.indexOf("{verdict.scope}");
    assert.ok(headline !== -1 && scope !== -1, "both must be rendered");
    assert.ok(scope > headline, "the scope must follow the headline");
    const between = report.slice(headline, scope);
    assert.doesNotMatch(between, /<\/h3>\s*<p[^>]*>\s*(Finding|The rest|Share)/i);
  });

  it("no longer renders the old unqualified verdict string", () => {
    assert.doesNotMatch(report, /No findings\. The checks found nothing to flag\./);
    assert.doesNotMatch(guest, /No findings\. The checks found nothing to flag\./);
  });

  it("no longer leaves a separate not-checked block at the bottom of the page", () => {
    // The old block sat below the report, rescan, tabs, and compare view.
    assert.doesNotMatch(guest, /aria-label="What was not checked"/);
    assert.doesNotMatch(guest, /This is a partial result\. Unlisted files were not examined\./);
  });

  it("no longer prints the raw analysed/skipped counts outside the verdict block", () => {
    assert.doesNotMatch(guest, /Analyzed \{scan\.fetchedFileCount\} files, skipped/);
  });

  it("renders the lead and the three prompts after the scope line", () => {
    const scope = report.indexOf("{verdict.scope}");
    const lead = report.indexOf('aria-label="One thing to look at"');
    const actions = report.indexOf('aria-label="Three actions"');
    const fix = report.indexOf('aria-label="Fix before you share"');
    assert.ok(scope !== -1 && lead !== -1 && actions !== -1 && fix !== -1);
    assert.ok(scope < lead && lead < actions && actions < fix);
    const actionsBlock = report.slice(actions, fix);
    assert.match(actionsBlock, /priority-note/);
    assert.match(actionsBlock, /A model may only reorder items that share a severity/);
    assert.doesNotMatch(report, /\b(safe to share|certified|is secure)\b/i);
  });

  it("passes every scope input the verdict needs", () => {
    for (const prop of [
      "status=",
      "fetchedFileCount=",
      "skippedFileCount=",
      "fileCount=",
      "treeTruncated=",
      "liveProvided=",
      "aiConfigured=",
      "signedIn=",
    ]) {
      assert.ok(guest.includes(prop), `ScanReport call site is missing ${prop}`);
    }
  });

  it("derives the actionable count from finding severities, not the raw total", () => {
    assert.match(report, /actionableCount:/);
    assert.match(report, /severity !== "info"/);
  });

  it("passes the scan caps to the not-checked line", () => {
    assert.match(report, /maxFiles:/);
    assert.match(report, /maxBytes:/);
    assert.ok(guest.includes("signedIn="));
  });
});