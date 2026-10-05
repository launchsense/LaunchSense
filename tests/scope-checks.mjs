import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildVerdict, buildNotCheckedList, SCOPE_LABEL } from "../shared/reports/scope.ts";
// A namespace import on purpose. A named import of an export that does not exist
// yet is a module load error, which fails every test in this file at once and
// hides which rule broke. Namespace access fails one line at a time.
import * as scope from "../shared/reports/scope.ts";
import { toUserError } from "../src/features/scan/userError.ts";
import { validateLiveUrl } from "../shared/ssrf.ts";

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

  it("never prints a zero remainder when files were skipped rather than left unread", () => {
    // fetched === total with skipped > 0 is reachable: every path in the tree was
    // selected and some content fetches failed. analyze.ts sets status partial on
    // exactly that condition, so the scope line used to contradict the headline
    // with "The other 0 files were not read."
    const v = buildVerdict({ ...BASE, fetched: 200, skipped: 3, total: 200, status: "partial" });
    assert.doesNotMatch(v.scope, /the other/i, "a zero remainder is still a remainder claim");
    assert.doesNotMatch(v.scope, /\b0\b/, "a skipped file is not a zero count");
    assert.match(v.scope, /read all 200 files listed/i);
    assert.match(v.scope, /3 files could not be read/i);

    const one = buildVerdict({ ...BASE, fetched: 12, skipped: 1, total: 12, status: "partial" });
    assert.match(one.scope, /1 file could not be read/i);
    assert.doesNotMatch(one.scope, /1 files/i);
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

//
// The guest cap, the live lane, and the slot release. Three defects a reader
// sees: one dialog that cannot say which of two causes opened it, a live check
// that is called from one of four completion paths and whose every failure is
// reported as a broken repository scan, and a saved scan that a slot release
// can still turn back into a failure.
//

const guestSource = readFileSync(new URL("../src/features/scan/GuestScan.tsx", import.meta.url), "utf8");
const analyzeSource = readFileSync(new URL("../convex/scans/analyze.ts", import.meta.url), "utf8");
const ssrfSource = readFileSync(new URL("../shared/ssrf.ts", import.meta.url), "utf8");
const livecheckSource = readFileSync(new URL("../convex/scans/livecheck.ts", import.meta.url), "utf8");

function occurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

// The text of one named function, up to the next named function.
function blockOf(source, from, to) {
  const start = source.indexOf(from);
  assert.ok(start !== -1, `could not find ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert.ok(end !== -1, `could not find ${to} after ${from}`);
  return source.slice(start, end);
}

describe("the live lane has its own error mapper", () => {
  // Every input below is one real path to a message that used to be discarded.
  // shared/ssrf.ts writes each of them in plain words with no hostname, path or
  // upstream text, and livecheck.ts throws them verbatim.
  const cases = [
    ["", "Enter a live site URL."],
    [`https://example.com/${"a".repeat(500)}`, "That URL is too long."],
    ["not a url", "That does not look like a URL. Use https://example.com."],
    ["ftp://example.com", "Only http and https sites can be checked."],
    ["https://user:pw@example.com", "URLs with credentials are not allowed."],
    [`https://${"a".repeat(250)}.com`, "That hostname is not allowed."],
    ["http://169.254.169.254/", "That address is not allowed."],
    ["http://localhost:3000/", "Local and test hostnames are not allowed."],
    ["http://intranet/", "Single-word hostnames are not allowed."],
    ["http://[::1]/", "That address is not allowed."],
  ];

  it("exports a live mapper, so live reasons are not forced onto the scan fallback", () => {
    assert.equal(typeof scope.toLiveUserError, "function");
  });

  it("shows each real live-URL reason instead of one scan message", () => {
    for (const [input, expected] of cases) {
      const parsed = validateLiveUrl(input);
      assert.equal(parsed.ok, false, `expected ${JSON.stringify(input.slice(0, 30))} to be rejected`);
      if (parsed.ok === true) continue;
      assert.equal(parsed.error, expected);
      const shown = scope.toLiveUserError(new Error(parsed.error), "Could not check the live app.");
      assert.equal(shown, parsed.error, `collapsed to a generic message: ${parsed.error}`);
    }
  });

  it("shows the reason checkLive itself throws for a scan it cannot find", () => {
    const thrown = livecheckSource.match(/throw new Error\("([^"]+)"\)/);
    assert.ok(thrown !== null, "checkLive no longer throws a fixed sentence");
    assert.equal(
      scope.toLiveUserError(new Error(thrown[1] ?? ""), "Could not check the live app."),
      thrown[1],
    );
  });

  it("allow-lists every sentence the live lane can produce, so a new one cannot collapse", () => {
    const reasons = scope.LIVE_CHECK_REASONS;
    assert.ok(Array.isArray(reasons) && reasons.length > 0, "the allow list is missing");
    // shared/ssrf.ts holds only these sentences and the livecheck throws. A
    // message added there without a list entry is the regression this catches.
    const sentences = new Set();
    for (const match of ssrfSource.matchAll(/"([A-Z][^"]{6,}\.)"/g)) sentences.add(match[1] ?? "");
    for (const match of livecheckSource.matchAll(/new Error\("([^"]+)"\)/g)) sentences.add(match[1] ?? "");
    assert.ok(sentences.size >= 9, `only ${sentences.size} live sentences were found to check`);
    for (const sentence of sentences) {
      assert.ok(
        reasons.some((r) => sentence.startsWith(r)),
        `not allow-listed, so it would be replaced by a generic message: ${sentence}`,
      );
    }
  });

  it("still hides a raw backend message, so the live lane is not a leak", () => {
    const fallback = "Could not check the live app.";
    const leaky = new Error("getaddrinfo ENOTFOUND db.internal.example.com at /var/lib/convex/store");
    assert.equal(scope.toLiveUserError(leaky, fallback), fallback);
    assert.equal(scope.toLiveUserError("just a string", fallback), fallback);
    assert.equal(scope.toLiveUserError(null, fallback), fallback);
  });

  it("leaves the repository lane narrow, so a live reason cannot reach a scan error", () => {
    assert.equal(
      toUserError(new Error("Enter a live site URL."), "Could not run the scan. Try again."),
      "Could not run the scan. Try again.",
    );
  });
});

describe("the guest cap dialog says which case it is", () => {
  it("no longer merges a repository that would not open with a read that hit the cap", () => {
    assert.doesNotMatch(
      guestSource,
      /This sample stopped at the guest cap, or the repo was not public\./,
      "one sentence for two different causes is still there",
    );
  });

  it("names the repository-miss case and gives it its own heading", () => {
    assert.match(guestSource, /That repository did not open/);
    assert.match(
      guestSource,
      /GitHub would not open that repository\. It may be private, or the address may be wrong\. No files were read\./,
    );
  });

  it("names the cap case from the shared cap constants, not a hardcoded 200", () => {
    assert.match(guestSource, /guest limit of \$\{GUEST_MAX_FILES/);
    assert.match(guestSource, /GUEST_MAX_BYTES/);
    assert.match(guestSource, /The rest of the repository was not read\./);
  });

  it("chooses the heading and the body from the case, not from one fixed line", () => {
    // One name says which case the dialog is in, and it is null exactly when the
    // dialog is closed, so the wording cannot drift from the condition.
    assert.match(
      guestSource,
      /const capReason: "guestCap" \| "repoMiss" \| null = !showSignIn\s*\?\s*null\s*:\s*repoMiss\s*\?\s*"repoMiss"\s*:\s*"guestCap"/,
    );
    assert.match(
      guestSource,
      /const capHeading = capReason === "repoMiss" \? "That repository did not open" : "Sign in to read more"/,
    );
    assert.match(
      guestSource,
      /const capBody =\s*capReason === "repoMiss"\s*\? "GitHub would not open that repository\.[\s\S]{0,240}?`This scan stopped at the guest limit/,
      "the body must branch on the case too",
    );
    assert.match(guestSource, /<h2 id="limit-signin-title">\{capHeading\}<\/h2>/);
    assert.match(guestSource, /<p>\{capBody\}<\/p>/);
  });

  it("still opens the dialog for either cause", () => {
    assert.match(guestSource, /!isAuthenticated && \(guestCapHit \|\| repoMiss\)/);
    assert.match(guestSource, /showSignIn && \(\s*<dialog/);
  });
});

describe("the live check runs on every path that finishes a scan", () => {
  const lane = blockOf(guestSource, "async function runLiveCheck", "async function onSubmit");

  it("binds checkLive once and calls it from one function", () => {
    assert.equal(occurrences(guestSource, "api.scans.livecheck.checkLive"), 1);
    assert.equal(occurrences(guestSource, "async function runLiveCheck"), 1);
    assert.equal(
      occurrences(lane, "await checkLive("),
      1,
      "checkLive must be called only inside runLiveCheck",
    );
  });

  it("runs it on all four completion paths", () => {
    const submit = blockOf(guestSource, "async function onSubmit", "async function onResume");
    const resume = blockOf(guestSource, "async function onResume", "async function onShare");
    const rescan = blockOf(guestSource, "async function onRescan", "async function onExplain");
    // onSubmit finishes twice: the run that never opened a repository, and the
    // scan that was analyzed. onResume and onRescan each finish once.
    assert.equal(occurrences(submit, "await runLiveCheck("), 2, "onSubmit has two completion paths");
    assert.equal(occurrences(resume, "await runLiveCheck("), 1, "the resume path skips the live check");
    assert.equal(occurrences(rescan, "await runLiveCheck("), 1, "the rescan path skips the live check");
    assert.equal(occurrences(guestSource, "await runLiveCheck("), 4, "four completion paths, four calls");
  });

  it("does nothing when no URL was given", () => {
    assert.match(lane, /if \(liveUrl\.trim\(\)\.length === 0\) return;/);
  });
});

describe("a live failure is reported as a live failure", () => {
  const lane = blockOf(guestSource, "async function runLiveCheck", "async function onSubmit");

  it("keeps a live throw out of the scan error state", () => {
    assert.doesNotMatch(lane, /setSubmitError/, "a live throw must not set the scan error");
    assert.match(lane, /catch \(error\)/);
    assert.match(lane, /toLiveUserError\(/);
    assert.match(guestSource, /\{liveError\.length > 0 && <p role="alert">\{liveError\}<\/p>\}/);
  });

  it("never puts the scan fallback inside the live lane", () => {
    assert.doesNotMatch(lane, /Could not run the scan/);
    assert.match(guestSource, /Could not check the live app\. The repository scan is finished\./);
  });

  it("cannot print a machine status beside a failure notice", () => {
    assert.match(
      guestSource,
      /status !== null && submitError\.length === 0 && liveError\.length === 0/,
      "Status: completed must not sit next to an alert",
    );
  });
});

describe("the live result survives a scan whose analysis never finished", () => {
  const lane = blockOf(guestSource, "async function runLiveCheck", "async function onSubmit");

  it("keeps the action's own answer in state, not only in the scan row", () => {
    // getResults returns the stored live row only once analyzedAt is set, and
    // the signed-in token gate returns before saveResults. The action's return
    // value is the one copy of this result that gate cannot drop.
    assert.match(guestSource, /const \[liveOutcome, setLiveOutcome\] = useState/);
    assert.match(lane, /setLiveOutcome\(\{ reaches: checked\.reaches, httpStatus: checked\.httpStatus \}\)/);
  });

  it("shows it when the report itself cannot render", () => {
    assert.match(guestSource, /liveOutcome !== null && !analyzed/);
    assert.match(guestSource, /aria-label="Live app result"/);
  });

  it("drives the not-checked box from the attempt, not from the input box", () => {
    assert.match(guestSource, /liveProvided=\{liveAttempted\}/);
    assert.doesNotMatch(
      guestSource,
      /liveProvided=\{liveUrl\.trim\(\)\.length > 0\}/,
      "a typed URL that was never checked still claims the live app was looked at",
    );
  });

  it("leaves the signed-in token gate a return, so the live lane is still reached", () => {
    const gate = blockOf(analyzeSource, "if (signedRead && token === null)", "const maxFiles");
    assert.match(gate, /status: "failed"/);
    assert.doesNotMatch(gate, /throw new Error/, "a throw here would skip the live lane entirely");
  });
});

describe("a saved scan is not rejected by the slot release", () => {
  it("wraps the release so it cannot fail an already saved scan", () => {
    assert.match(
      analyzeSource,
      /try\s*\{\s*await\s*ctx\.runMutation\(\s*internal\.scans\.quota\.releaseSlot[\s\S]*?\}\s*catch\s*\{/,
      "the release can still reject a completed scan",
    );
  });

  it("releases exactly one slot, and that call is the wrapped one", () => {
    assert.equal(
      occurrences(analyzeSource, "internal.scans.quota.releaseSlot"),
      1,
      "a scan must still free its slot, and the wrap must be on the only call",
    );
  });

  it("still releases the slot, and still does it after saving the results", () => {
    assert.ok(
      analyzeSource.indexOf("internal.scans.quota.releaseSlot") >
        analyzeSource.indexOf("internal.scans.store.saveResults"),
      "the release must stay after saveResults so a queued scan can start",
    );
  });
});