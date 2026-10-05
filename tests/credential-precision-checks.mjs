import { test } from "node:test";
import assert from "node:assert/strict";
import { isHardcodedCredential, scanSecrets } from "../shared/analyzers/secrets.ts";
import { looksLikeSecretValue } from "../shared/analyzers/secretValue.ts";
import * as F from "./fixtures.mjs";

// Real lines from the 100-repo corpus. These must stay quiet: they are the
// dominant false positives (dotted package paths, dotted member chains, UI
// bindings, framework/XML attributes). Fixes: name-gate receiver guard
// (draft-3) and anchored JWT shape (draft-1).
const MUST_BE_QUIET = [
  "import org.springframework.stereotype.Controller",
  "import org.springframework.validation.BindingResult",
  "import com.example.myapplication.databinding.ActivityMainBinding",
  "viewBinding.tvSendCode.setOnClickListener { sendCode() }",
  "colorScheme.onSurfaceVariant",
  "model_name.underscore",
  "options.deep_merge(a, b)",
  '<autoresizingMask key="frame">',
  '<entry key="..\\:/BilalProject/x.xml" value="0.109" />',
  "django.middleware.clickjacking.XFrameOptionsMiddleware",
  "System.Management.Automation.CompletionResult",
  "--collector.filesystem.mount-points-exclude",
  "stack_item.element_data.matched_ids_mut",
  // An ALL_CAPS constant chain, not a JWT. Corpus wave-08 measured eight of these
  // as high `secret.credential-pattern` rows in one Python repo. The name carries no
  // lowercase letter at all, which is not a base64url run.
  "__C.TRAINING.OPTIMIZER.WEIGHT_DECAY = 0.0001",
  "__C.TRAINING.EARLY_STOPPING.PATIENCE = 10",
  "if cfg.TRAINING.OPTIMIZER.USE_WEIGHTS:",
];

// True positives and provider shapes must still fire. Recall is a hard gate.
const MUST_FIRE = [
  'aws_access_key_id = "AKIAIOSFODNN7EXAMPLE"',
  'password = "Str0ngSecret-Val-987654321"',
  'token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc123_-XYZdef456"',
  'apiKey := "live-$ecret-k3y-9a8b7c6d5e4f"',
];

test("corpus false-positive lines stay quiet", () => {
  for (const line of MUST_BE_QUIET) {
    assert.equal(isHardcodedCredential(line), false, `should be quiet: ${line}`);
  }
});

test("true positives and provider shapes still fire", () => {
  for (const line of MUST_FIRE) {
    assert.equal(isHardcodedCredential(line), true, `should fire: ${line}`);
  }
});

test("entitlement, type, optional-chain, and lockfile lines stay quiet", () => {
  const QUIET = [
    'export const FEATURE_KEYS = ["rendered_phone_check"] as const;',
    "type TokenBundle = { access_token?: string };",
    "const accessToken = tokens?.access_token;",
    '"auth": "dist/bin.cjs",',
  ];
  for (const line of QUIET) {
    assert.equal(isHardcodedCredential(line), false, `should be quiet: ${line}`);
  }
});

test("a quoted provider-shaped value assigned to FEATURE_KEYS still fires", () => {
  assert.equal(isHardcodedCredential(F.line("FEATURE_KEYS", F.FAKE_OPENAI)), true);
});

// WS-1. The dot-receiver gate reads a dotted name as a member access and skips it.
// In source code that is right (`viewBinding.tvSendCode`). In a config-style file the
// dot is a key namespace, so `jwt.secret=<value>` in a `.properties` file is a
// committed key, not an object field. Corpus wave-05 measured the miss: a real 64
// character JWT signing key at `application.properties:9` was reported zero times.
//
// The value below is assembled from parts in tests/fixtures.mjs, so this file never
// holds a contiguous key-shaped string.

const CONFIG_KEY_VALUE = F.FAKE_BASE64_SLASH;

function scanOne(path, line) {
  return scanSecrets([{ path, content: `${line}\n` }]);
}

test("a dotted key in a config-style file fires: the real key the receiver gate missed", () => {
  const hits = scanOne("config/application.properties", `jwt.secret=${CONFIG_KEY_VALUE}`);
  assert.ok(
    hits.some((m) => m.ruleId === "secret.credential-pattern"),
    `a jwt.secret assignment in a .properties file must fire, got ${JSON.stringify(hits.map((m) => m.ruleId))}`,
  );
});

test("every config-style extension is config-style", () => {
  // `.env` is deliberately absent. A tracked env file is routed to its own
  // `secret.tracked-env` rule before `isHardcodedCredential` is ever called, so the
  // per-line path cannot be the thing that fires there. `isHardcodedCredential`
  // itself treats `.env` as config-style, and
  // "a dotted name is a member access in source, an assignment in config" covers it.
  for (const path of [
    "config/application.properties",
    "config/application.ini",
    "config/settings.cfg",
    "nginx.conf",
    "config/app.toml",
  ]) {
    const hits = scanOne(path, `jwt.secret=${CONFIG_KEY_VALUE}`);
    assert.ok(
      hits.some((m) => m.ruleId === "secret.credential-pattern"),
      `expected a hit in ${path}, got ${JSON.stringify(hits.map((m) => m.ruleId))}`,
    );
  }
});

test("a tracked env file still goes to its own rule, not the per-line rule", () => {
  // Naming what this does NOT do, so a future change to the routing is visible here
  // rather than silent. The dotted-key case inside a tracked `.env` is a separate gap
  // in `trackedEnvHasLiveValue`, which takes the whole `jwt.secret` as one name.
  const hits = scanOne("config/.env", "JWT_SECRET=" + CONFIG_KEY_VALUE);
  assert.deepEqual(hits.map((m) => m.ruleId), ["secret.tracked-env"]);
});

test("a dotted key in a source file stays a member access, with or without a path", () => {
  const line = `jwt.secret=${CONFIG_KEY_VALUE}`;
  assert.deepEqual(scanOne("src/config.ts", line), []);
  assert.deepEqual(scanOne("app.py", line), []);
  assert.deepEqual(scanOne("index.html", line), []);
  // No path at all is the conservative default: treat it as source.
  assert.deepEqual(isHardcodedCredential(line), false);
  assert.deepEqual(isHardcodedCredential(line, "src/config.ts"), false);
});

test("an empty, placeholder, or substituted value in a config file is still quiet", () => {
  for (const line of [
    "jwt.secret=",
    "jwt.secret=changeme",
    'jwt.secret="your_key_here"',
    "jwt.secret=${JWT_SECRET}",
    "jwt.secret=${env.JWT_SECRET}",
    "jwt.secret = os.getenv(\"JWT_SECRET\")",
  ]) {
    assert.deepEqual(
      scanOne("config/application.properties", line),
      [],
      `should be quiet in a config file: ${line}`,
    );
  }
});

test("a UI binding stays quiet", () => {
  assert.deepEqual(
    scanOne("app.kt", "viewBinding.tvSendCode.setOnClickListener { sendCode() }"),
    [],
  );
  assert.deepEqual(scanOne("app.kt", "viewBinding.password.toString()"), []);
  assert.deepEqual(scanOne("src/ui.ts", "viewBinding.tvSendCode.text = title;"), []);
});

// W3-FIX, audit case 11. The value gate accepted any string of 20 characters with 10
// distinct ones, so a lowercase hyphenated HTTP header LABEL fired
// `secret.credential-pattern` high at convex/mcpLimit.ts:13, where the real secret is
// read from the environment behind that header name. The line is quiet now.
const USAGE_HEADER_LINE = 'export const USAGE_KEY_HEADER = "x-launchsense-usage-key";';
/** The value on that line, kept apart so the value-gate tests read as shape tests. */
const SLUG_LABEL = "x-launchsense-usage-key";

/** Scan one line as a whole file, at a real path, and return the rule ids only. */
function scanLines(path, line) {
  return scanSecrets([{ path, content: `${line}\n` }]).map((m) => m.ruleId);
}

test("a constant-style header name holding a slug label is quiet", () => {
  assert.equal(
    isHardcodedCredential(USAGE_HEADER_LINE),
    false,
    `the name of an HTTP header is not a secret: ${USAGE_HEADER_LINE}`,
  );
  // Multiply scoped: the same line through the whole file scan at its real path, and
  // the unquoted form a config file would carry.
  assert.deepEqual(scanLines("convex/mcpLimit.ts", USAGE_HEADER_LINE), []);
  assert.deepEqual(
    scanLines("config/app.properties", "USAGE_KEY_HEADER=x-launchsense-usage-key"),
    [],
  );
});

test("a hyphenated passphrase under password still fires", () => {
  // The slug shape alone must not be enough. The name decides, so a real passphrase
  // under a real credential name is still a finding.
  assert.equal(isHardcodedCredential('password = "correct-horse-battery-stapler"'), true);
  assert.equal(isHardcodedCredential('client_secret = "correct-horse-battery-stapler"'), true);
  // A value that is not slug-shaped at all, or a mixed-case one, fires under a
  // constant-style name too. That is the documented edge of the rule.
  assert.equal(isHardcodedCredential('CLIENT_SECRET = "Str0ng-Secret-Val-987654321"'), true);
});

test("a provider shape is checked before the slug rejection, not after", () => {
  // An OpenRouter key IS a lowercase hyphenated slug. If the slug rejection ran first it
  // would swallow a real key, so the ordering is asserted at the value gate itself and
  // again through the line gate.
  assert.equal(looksLikeSecretValue(F.FAKE_OPENROUTER, true, "OPENROUTER_API_KEY"), true);
  assert.equal(isHardcodedCredential(F.line("OPENROUTER_API_KEY", F.FAKE_OPENROUTER)), true);
  assert.equal(isHardcodedCredential(F.line("USAGE_KEY_HEADER", F.FAKE_OPENROUTER)), true);
});

test("the slug rule is scoped to a constant-style name", () => {
  // All caps: the measured shape, quiet.
  assert.equal(looksLikeSecretValue(SLUG_LABEL, true, "USAGE_KEY_HEADER"), false);
  // A HEADER, NAME, or LABEL tail exempts a lower-case name too.
  assert.equal(looksLikeSecretValue(SLUG_LABEL, true, "usage_key_header"), false);
  // A plain lower-case credential name gets no exemption. The value still stands on
  // its own shape, which is the tradeoff the rule makes deliberately.
  assert.equal(looksLikeSecretValue(SLUG_LABEL, true, "usage_key"), true);
  assert.equal(looksLikeSecretValue(SLUG_LABEL, true, "password"), true);
  // No name at all is the conservative default: the value stands on its own.
  assert.equal(looksLikeSecretValue(SLUG_LABEL, true), true);
});

test("a slug carrying a digit is never exempt, even under a constant-style name", () => {
  // An OpenAI-shaped value that is one character short of the provider format. A looser
  // slug rule exempted it and lost the finding; tests/secret-false-positive-checks.mjs
  // pins the same line from the other direction. Assembled from parts so this file
  // never holds a contiguous key-shaped string.
  const SHORT_SK = ["sk-", "abcd", "1234", "efgh", "5678"].join("");
  assert.equal(looksLikeSecretValue(SHORT_SK, true, "API_KEY"), true);
  assert.equal(isHardcodedCredential(`API_KEY = "${SHORT_SK}"`), true);
});

test("a tracked env file uses the same rule, and still catches a real key", () => {
  // The same false positive through the other code path: a header label in a tracked
  // `.env` is a label there too.
  assert.deepEqual(scanLines("config/.env", "USAGE_KEY_HEADER=x-launchsense-usage-key"), []);
  // Provider shapes bypass the rule here too, so the tracked-env rule still fires on a
  // real key under a constant-style name.
  assert.deepEqual(
    scanLines("config/.env", `OPENROUTER_API_KEY=${F.FAKE_OPENROUTER}`),
    ["secret.tracked-env"],
  );
});
