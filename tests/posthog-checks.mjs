// POSTHOG. The website visitor counter, pinned to what the privacy notice says
// about it.
//
// The notice promises four things: the site loads PostHog, it runs cookieless
// (no cookie, no browser storage), identity is a hash PostHog computes on its own
// servers, and session replay, click capture, surveys, and person profiles are
// off. Each of those is a line in src/analytics.ts, and these tests read the line
// rather than the promise. A missing key disables the counter, and the repository
// holds no key at all.
//
// The MCP surface is not part of this. It loads no browser script, and these
// tests assert that the counter is wired from the website entry point only.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (...parts) => readFileSync(join(ROOT, ...parts), "utf8");

const analytics = read("src", "analytics.ts");
const main = read("src", "main.tsx");
const privacyDoc = read("docs", "PRIVACY.md");
const privacyPage = read("src", "pages", "Privacy.tsx");
const metrics = read("docs", "METRICS.md");
const llms = read("llms.txt");
const pkg = JSON.parse(read("package.json"));

describe("the PostHog counter is cookieless and collects no identities", () => {
  it("turns cookieless mode on, so no cookie and no browser storage is used", () => {
    assert.match(
      analytics,
      /cookieless_mode:\s*"always"/,
      "the notice says no cookie and no browser storage, so cookieless_mode must be always",
    );
    assert.match(
      analytics,
      /persistence:\s*"memory"/,
      "memory persistence is the second half of the no storage claim",
    );
  });

  it("turns off every collector that is not a page view", () => {
    for (const [pattern, why] of [
      [/person_profiles:\s*"never"/, "person profiles would build a profile of a person"],
      [/autocapture:\s*false/, "autocapture could record a click on anything"],
      [/disable_session_recording:\s*true/, "a session replay is a recording of a person"],
      [/disable_surveys:\s*true/, "a survey collects typed words"],
      [/capture_performance:\s*false/, "performance capture is not needed to count a visit"],
      [/capture_dead_clicks:\s*false/, "dead-click capture is not needed to count a visit"],
      [/capture_exceptions:\s*false/, "exception capture is not needed to count a visit"],
    ]) {
      assert.match(analytics, pattern, why);
    }
  });

  it("never identifies a user", () => {
    assert.doesNotMatch(analytics, /\.identify\(/, "identify would attach an identity to a person");
    assert.doesNotMatch(analytics, /\$set\b|posthog\.people/, "nothing may set person properties");
  });

  it("lets only a page view and a page leave out of the browser", () => {
    assert.match(
      analytics,
      /ALLOWED_EVENTS\s*=\s*new Set\(\["\$pageview",\s*"\$pageleave"\]\)/,
      "the allowlist must hold exactly a page view and a page leave",
    );
    assert.match(analytics, /before_send:/, "and it must be enforced with before_send");
  });

  it("points at a PostHog ingest host by default", () => {
    assert.match(
      analytics,
      /https:\/\/(us|eu)\.i\.posthog\.com/,
      "the default host must be a PostHog ingest host, not a guessed URL",
    );
  });
});

describe("the counter is off unless a key is present", () => {
  it("reads the key from the build environment and gates on its shape", () => {
    assert.match(analytics, /import\.meta\.env\.VITE_POSTHOG_KEY/, "the key must come from the build, not the source");
    assert.match(analytics, /startsWith\("phc_"\)/, "only a PostHog public client key enables the counter");
    assert.match(
      analytics,
      /if \(started \|\| !analyticsEnabled\(\)\)\s*\{\s*return;/,
      "startAnalytics must do nothing at all without a key",
    );
  });

  it("keeps no PostHog key in the repository", () => {
    const files = [
      ["src", "analytics.ts"],
      ["src", "main.tsx"],
      ["index.html"],
      ["llms.txt"],
      ["docs", "PRIVACY.md"],
      ["docs", "METRICS.md"],
    ];
    for (const parts of files) {
      const path = join(ROOT, ...parts);
      if (!existsSync(path)) continue;
      assert.doesNotMatch(
        readFileSync(path, "utf8"),
        /phc_[A-Za-z0-9]{12,}/,
        `${parts.join("/")} must not hold a PostHog key; the key lives in the build environment`,
      );
    }
  });

  it("is started from the website entry point", () => {
    assert.match(main, /from "\.\/analytics"/, "main.tsx must import the analytics module");
    assert.match(main, /startAnalytics\(\)/, "main.tsx must start the counter");
  });

  it("declares posthog-js as a dependency", () => {
    const deps = { ...pkg.dependencies };
    assert.ok(deps["posthog-js"], "posthog-js must be a declared dependency, not an implicit import");
  });

  it("names the two build variables, with no value, in the env example", () => {
    const example = read(".env.example");
    assert.match(example, /^VITE_POSTHOG_KEY=$/m, ".env.example must name the key variable and leave it empty");
    assert.match(example, /VITE_POSTHOG_HOST=/, ".env.example must name the host variable");
    assert.doesNotMatch(example, /phc_[A-Za-z0-9]{12,}/, ".env.example must never carry a real key");
  });
});

describe("the notice and the docs match the counter", () => {
  it("discloses PostHog on both privacy copies", () => {
    for (const [name, text] of [
      ["docs/PRIVACY.md", privacyDoc],
      ["src/pages/Privacy.tsx", privacyPage],
    ]) {
      assert.match(text, /PostHog/, `${name} must name the analytics script`);
      assert.match(text, /cookieless/i, `${name} must say the counter is cookieless`);
      assert.match(text, /no cookie/i, `${name} must say no cookie is set`);
      assert.match(
        text,
        /privacy hash/i,
        `${name} must say identity is a hash PostHog computes, not one we hold`,
      );
      assert.doesNotMatch(
        text,
        /We load no analytics script/,
        `${name} still claims no analytics script is loaded, which is no longer true of the website`,
      );
    }
  });

  it("says the website is wired and the MCP surface is not", () => {
    assert.match(metrics, /wired to PostHog/, "METRICS.md must record that the website counter is wired");
    assert.doesNotMatch(
      metrics,
      /Today none of the four is wired/,
      "METRICS.md still says no counter is wired",
    );
    assert.match(
      llms,
      /MCP surface loads no browser script/,
      "llms.txt must keep the MCP surface script-free and separate from the website counter",
    );
    assert.match(llms, /PostHog/, "llms.txt must name the website visitor counter");
  });
});
