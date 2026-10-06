import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The limit offers the free local path. Three defects, one file of tests.
//
// 1. The hosted read is a shared budget. When it is spent, the honest answer is
//    "run it free on your own machine", not a dead end and not a sign-in wall.
// 2. A paused state must never print a fake number, a countdown, or a queue.
// 3. The local check reads the user's own checkout and sends nothing, so it is
//    the better default, and the copy must say so.
//
// No network, no database, and no clock. Files are read as text.

const guest = readFileSync(new URL("../src/features/scan/GuestScan.tsx", import.meta.url), "utf8");
const localPath = readFileSync(new URL("../src/features/scan/LocalPath.tsx", import.meta.url), "utf8");
const skill = readFileSync(new URL("../skills/launchsense/SKILL.md", import.meta.url), "utf8");
const llms = readFileSync(new URL("../llms.txt", import.meta.url), "utf8");

describe("the limit always offers the free local path", () => {
  it("tells a rate-limited visitor that hosted reads are paused, not to sign in", () => {
    assert.match(guest, /Hosted reads are paused until the hour resets/);
  });

  it("renders the local path in the cap dialog for a limit, and only for a limit", () => {
    assert.match(guest, /capReason !== "repoMiss" && <LocalPath \/>/);
  });

  it("separates a repository miss from a spent budget", () => {
    assert.match(guest, /rateLimited = quotaExhausted \|\| scan\?\.errorKind === "rate_limited"/);
    assert.match(guest, /capReason === "rateLimited"/);
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
      assert.doesNotMatch(guest, character);
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
});
