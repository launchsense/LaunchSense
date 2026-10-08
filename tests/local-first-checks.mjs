import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// One lane. The hosted read is gone, so there is no limit to offer.
// The home page is the local path with one setup prompt to copy.
// No network, no database, and no clock. Files are read as text.

import { existsSync } from "node:fs";

const localPath = readFileSync(new URL("../src/features/scan/LocalPath.tsx", import.meta.url), "utf8");
const skill = readFileSync(new URL("../skills/launchsense/SKILL.md", import.meta.url), "utf8");
const llms = readFileSync(new URL("../llms.txt", import.meta.url), "utf8");

describe("the hosted sample is gone", () => {
  it("GuestScan file is deleted and Home names no hosted read", () => {
    assert.equal(existsSync(new URL("../src/features/scan/GuestScan.tsx", import.meta.url)), false);
    const home = readFileSync(new URL("../src/pages/Home.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(home, /GuestScan/);
    assert.doesNotMatch(home, /Hosted reads are paused/);
  });
});

describe("the local path says what it is", () => {
  // Prose is reflowed by the formatter, so sentence checks run against a
  // whitespace-flattened copy.
  const flat = (text) => text.replace(/\s+/g, " ");

  it("names the free, unlimited, private local check", () => {
    assert.match(flat(localPath), /free and unlimited/);
    assert.match(flat(localPath), /Nothing is sent to us/);
    assert.match(flat(localPath), /working tree/);
  });

  it("shows a real install, not a placeholder that cannot run", () => {
    assert.match(localPath, /github\.com\/launchsense\/LaunchSense/);
    assert.match(localPath, /install\.sh/);
  });

  it("uses no countdown, no fake number, and no em dash", () => {
    for (const word of ["countdown", "hurry", "expires in", "spots left"]) {
      assert.doesNotMatch(localPath.toLowerCase(), new RegExp(word));
    }
    for (const character of [/\u2014/, /\u2013/, /\u2026/, /\u00b7/]) {
      assert.doesNotMatch(localPath, character);
    }
  });
});

describe("the home page offers one lane", () => {
  const home = readFileSync(new URL("../src/pages/Home.tsx", import.meta.url), "utf8");

  it("has no hosted sample and no second door", () => {
    assert.doesNotMatch(home, /GuestScan/);
    assert.doesNotMatch(home, /Taste it on a public repo/);
    assert.doesNotMatch(home, /Both connections|two lanes|both doors/i);
  });

  it("shows the free local check on the front page, not only behind a limit", () => {
    assert.match(home, /One way\. Your machine\. No limit/);
    assert.match(home, /<LocalPath \/>/);
  });

  it("hands the setup prompt over on Start, linked from the front page", () => {
    assert.match(home, /href="\/start"/);
    const start = readFileSync(new URL("../src/pages/Start.tsx", import.meta.url), "utf8");
    assert.match(start, /SETUP_PROMPT/);
  });

  it("does not hide the local check or fake a limit on the front page", () => {
    assert.doesNotMatch(home, /countdown|hurry|expires in|spots left/i);
    for (const character of [/\u2014/, /\u2013/, /\u2026/, /\u00b7/]) {
      assert.doesNotMatch(home, character);
    }
  });
});

describe("the docs call the local check the better default", () => {
  it("the skill says it reviews your checkout, not only LaunchSense", () => {
    assert.match(skill, /your\*\* checkout|your checkout/);
    assert.doesNotMatch(skill, /This skill is for a checkout of LaunchSense/);
  });

  it("the skill and llms.txt say the local check has no hourly limit", () => {
    assert.match(skill, /no hourly limit/);
    assert.match(llms, /no hourly limit/);
  });

  it("the local check sends nothing to us, on both surfaces", () => {
    assert.match(skill, /sends nothing to us/);
    assert.match(llms, /sends nothing to us/);
  });

  it("describes one system, the check on your machine, and no second door", () => {
    // The product is one system: the local check. The skill must not offer a
    // second door or route a public URL anywhere.
    assert.doesNotMatch(skill, /Two doors/, "the skill must not describe two doors");
    assert.doesNotMatch(skill, /hosted/i, "the skill must not mention a hosted read");
    assert.doesNotMatch(
      skill,
      /The public connection is the hosted MCP URL/,
      "the skill description must not name a hosted connection",
    );
    assert.match(skill, /node mcp\/server\.ts/, "the skill must name how to start the local server");
    assert.match(skill, /\.ls\/policy\.yaml/, "the skill must cover the policy file");
    assert.match(skill, /\.ls\/reports\//, "the skill must cover the report files");
  });

  it("says the not-checked list goes back line for line, never summarised", () => {
    // A summarised not-checked list reads as a complete one. A harness given the
    // review output once returned "19 skips" as a summary instead of the entries.
    assert.match(skill, /The not-checked list goes back as it is, line for line/);
    assert.match(skill, /Do not summarise it/);
  });
});
