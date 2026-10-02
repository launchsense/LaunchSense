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
    assert.ok(top.prompt.includes("Before your repo goes public"));
    assert.ok(top.prompt.split("\n").filter((l) => /^[0-9]\. /.test(l)).length === 3);
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
