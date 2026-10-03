import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateLiveUrl } from "../shared/ssrf.ts";
import { toShareCard } from "../shared/reports/shareCard.ts";
import { nextHopUrl } from "../convex/adapters/live.ts";
import { isPublicIdShape, newPublicId } from "../convex/adapters/share.ts";
import { buildTopPrompt, liveActionItems } from "../shared/reports/topPrompt.ts";

describe("validateLiveUrl", () => {
  it("blocks local, private, and disguised addresses", () => {
    for (const url of [
      "http://localhost:3000/",
      "http://127.0.0.1/",
      "http://0x7f.0.0.1/",
      "http://2130706433/",
      "http://10.0.0.5/",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://0.0.0.0/",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "ftp://example.com/x",
      "https://user:pass@example.com/",
      "http://intranet/",
      "http://example.local/",
    ]) {
      assert.equal(validateLiveUrl(url).ok, false, url);
    }
  });

  it("allows plain public sites", () => {
    for (const url of ["https://example.com/", "http://example.com:8080/path?q=1"]) {
      const result = validateLiveUrl(url);
      assert.equal(result.ok, true, url);
    }
  });
});

describe("nextHopUrl", () => {
  it("refuses redirects into metadata and local targets", () => {
    assert.equal(nextHopUrl("https://example.com/a", "http://169.254.169.254/x"), null);
    assert.equal(nextHopUrl("https://example.com/a", "http://127.0.0.1:3000/"), null);
    assert.equal(nextHopUrl("https://example.com/a", null), null);
    const ok = nextHopUrl("https://example.com/a", "/b");
    assert.equal(ok, "https://example.com/b");
  });
});

describe("toShareCard", () => {
  it("exposes counts and titles but no paths or snippets", () => {
    const card = toShareCard([
      { ruleId: "secret.tracked-env", path: ".env", severity: "high", title: "Env tracked" },
      { ruleId: "hygiene.no-readme", path: "(repo)", severity: "info", title: "No readme" },
    ]);
    assert.equal(card.counts.high, 1);
    assert.equal(card.counts.info, 1);
    assert.equal(card.steps.length, 1);
    const text = JSON.stringify(card);
    for (const key of ['"path"', '"line"', '"snippet"', '"fingerprint"']) {
      assert.ok(!text.includes(key), key);
    }
  });
});

describe("newPublicId", () => {
  it("makes shaped, unique IDs", () => {
    const ids = new Set();
    for (let i = 0; i < 200; i++) {
      const id = newPublicId();
      assert.ok(isPublicIdShape(id), id);
      ids.add(id);
    }
    assert.equal(ids.size, 200);
    assert.equal(isPublicIdShape("short"), false);
  });
});

describe("buildTopPrompt", () => {
  it("uses the stored priority order to break ties inside one severity band", () => {
    // Two medium findings. Without an order, the rule rank decides. With the stored
    // order, the lane's ordering decides, because both are the same severity.
    const findings = [
      { ruleId: "secret.debug-leftover", fingerprint: "m1", path: "a.ts", line: 1, severity: "medium", title: "Debug", why: "x" },
      { ruleId: "deps.duplicate", fingerprint: "m2", path: "b.ts", line: 1, severity: "medium", title: "Dup", why: "y" },
      { ruleId: "hygiene.no-readme", fingerprint: "m3", path: "c.ts", line: 1, severity: "medium", title: "Readme", why: "z" },
    ];
    const ranked = buildTopPrompt(findings, [], [], 3, ["m3", "m1", "m2"]);
    assert.equal(ranked.topRuleIds[0], "hygiene.no-readme", "the stored order should lead");
  });

  it("the lane can never lift a medium above a high, order or not", () => {
    const findings = [
      { ruleId: "deps.duplicate", fingerprint: "high1", path: "a.ts", line: 1, severity: "high", title: "High", why: "x" },
      { ruleId: "hygiene.no-readme", fingerprint: "med1", path: "b.ts", line: 1, severity: "medium", title: "Med", why: "y" },
    ];
    // The order puts the medium first. Severity must still win.
    const ranked = buildTopPrompt(findings, [], [], 3, ["med1", "high1"]);
    assert.equal(ranked.topRuleIds[0], "deps.duplicate", "high must stay above medium");
  });

  it("is unchanged when no order is supplied", () => {
    const findings = [
      { ruleId: "secret.tracked-env", fingerprint: "a", path: ".env", line: 1, severity: "high", title: "Env", why: "x" },
    ];
    const without = buildTopPrompt(findings, [], [], 3);
    const withEmpty = buildTopPrompt(findings, [], [], 3, []);
    assert.deepEqual(without.topRuleIds, withEmpty.topRuleIds);
  });

  it("ranks live items with repo findings and caps at 3", () => {
    const findings = [
      { ruleId: "secret.debug-leftover", path: "a.ts", line: 1, severity: "medium", title: "Debug" },
      { ruleId: "secret.tracked-env", path: ".env", line: 1, severity: "high", title: "Env" },
      { ruleId: "deps.duplicate", path: "(repo)", line: 0, severity: "low", title: "Dup" },
      { ruleId: "hygiene.no-readme", path: "(repo)", line: 0, severity: "info", title: "Readme" },
    ];
    const live = liveActionItems(
      { reaches: false, https: true, url: "https://example.com/" },
      null,
    );
    const top = buildTopPrompt(findings, [], live);
    assert.equal(top.topCount, 3);
    assert.equal(top.restCount, 1);
    assert.ok(top.prompt.includes("Before you share this"));
    assert.ok(top.prompt.split("\n").filter((l) => /^[0-9]\. /.test(l)).length === 3);
  });

  it("gives one slot per rule so three findings of a kind cannot fill the top 3", () => {
    const many = ["a.ts", "b.ts", "c.ts", "d.ts"].map((p) => ({
      ruleId: "secret.debug-leftover",
      path: p,
      line: 1,
      severity: "medium",
      title: "Debug leftover",
      why: "Leaks internals.",
    }));
    many.push({
      ruleId: "deps.vulnerability",
      path: "package.json",
      line: 7,
      severity: "high",
      title: "GHSA-x affects leftpad@1.0.0",
      why: "Known vulnerable version.",
    });
    const top = buildTopPrompt(many, [], []);
    const ruleIds = top.topRuleIds;
    assert.equal(new Set(ruleIds).size, ruleIds.length, "top 3 must be three different rules");
    assert.ok(top.topCount < 3 || ruleIds.includes("deps.vulnerability"));
    assert.ok(top.prompt.includes("places"));
  });

  it("ranks a bare tracked env file below a real vulnerability", () => {
    const top = buildTopPrompt(
      [
        { ruleId: "secret.tracked-env", path: ".env", line: 1, severity: "high", title: "Env tracked", why: "Readable." },
        { ruleId: "deps.vulnerability", path: "package.json", line: 3, severity: "high", title: "CVE affects x@1", why: "Known." },
      ],
      [],
      [],
    );
    assert.equal(top.topRuleIds[0], "deps.vulnerability");
  });

  it("names live problems plainly", () => {
    const items = liveActionItems(
      { reaches: true, https: false, nonBlank: true, viewportMeta: false, url: "https://example.com/" },
      "Visitors sign up",
    );
    const titles = items.map((i) => i.title);
    assert.ok(titles.includes("Live site does not use HTTPS"));
    assert.ok(titles.includes("No phone viewport tag"));
  });
});
