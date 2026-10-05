import { test } from "node:test";
import assert from "node:assert/strict";
import { isHardcodedCredential, scanSecrets } from "../shared/analyzers/secrets.ts";
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
