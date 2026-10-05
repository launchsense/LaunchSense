import { test } from "node:test";
import assert from "node:assert/strict";
import { isHardcodedCredential } from "../shared/analyzers/secrets.ts";
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
