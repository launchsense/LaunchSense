// Labelled fixture for the AI evidence harness.
//
// SYNTHETIC. Nothing here is taken from a real repository, a real scan, a real
// customer's project, or a private folder. Every finding title, every why line,
// every file path, and every fingerprint was written for this fixture. The npm
// package names are public registry coordinates, chosen because their licence
// is widely published and independently checkable, and because the licence
// lookup prompt carries a package name and version and nothing else. No
// repository content, no scan output, and no private data is in this file.
//
// Labelled in three buckets per track, and the label is what the PRODUCT should
// do, not what the model should say:
//
//   licence   known       a correct SPDX id exists and this product reads it
//             nonexistent no such package; a name with no registry answer
//             dual        published under an OR expression; no single id
//             nonproduct  a real SPDX id this product deliberately does not read
//   assist    anchors     the plain nouns a rewrite must keep to stay true
//   reorder   label       1 = fix before sharing, 0 = real but not before sharing
//
// Every label carries a confidence field. The report is not allowed to quote a
// number without quoting the confidence beside it.

/** Buckets for the licence-unknown lookup track. */
export const LICENSE_KNOWN = [
  { name: "debug", version: "4.3.4", id: "MIT", confidence: "high" },
  { name: "ms", version: "2.1.3", id: "MIT", confidence: "high" },
  { name: "semver", version: "7.5.4", id: "ISC", confidence: "high" },
  { name: "minimist", version: "1.2.8", id: "MIT", confidence: "high" },
  { name: "wrappy", version: "1.0.2", id: "ISC", confidence: "high" },
  { name: "inherits", version: "2.0.4", id: "ISC", confidence: "high" },
  { name: "escape-string-regexp", version: "4.0.0", id: "MIT", confidence: "high" },
  { name: "is-number", version: "7.0.0", id: "MIT", confidence: "high" },
  { name: "chalk", version: "4.1.2", id: "MIT", confidence: "high" },
  { name: "supports-color", version: "7.2.0", id: "MIT", confidence: "high" },
  { name: "has-flag", version: "4.0.0", id: "MIT", confidence: "high" },
  { name: "color-convert", version: "2.0.1", id: "MIT", confidence: "high" },
];

/**
 * Names that are not packages. A correct lane answers Unknown or refuses; an
 * invented id here is the failure this product exists to prevent, so the label
 * is null and a non-null suggestion is counted as a false id, not a near miss.
 */
export const LICENSE_NONEXISTENT = [
  { name: "launchsense-fixture-not-a-package", version: "0.0.1", id: null, confidence: "high" },
  { name: "nonexistent-pkg-for-eval-7f3a", version: "1.2.3", id: null, confidence: "high" },
  { name: "definitely-not-on-npm-4b21c9", version: "9.9.9", id: null, confidence: "high" },
  { name: "totally-fake-package-abc123xyz", version: "0.0.0", id: null, confidence: "high" },
  { name: "no-such-registry-entry-q1w2e3", version: "2.0.0", id: null, confidence: "high" },
];

/**
 * Published under an OR expression. There is no single correct bare id, so the
 * label is null and any id is a false id. This is the case the bare-id prompt
 * cannot express, which is the finding, not a defect of the fixture.
 */
export const LICENSE_DUAL = [
  { name: "node-forge", version: "1.3.1", id: null, expression: "BSD-3-Clause OR GPL-2.0", confidence: "high" },
  { name: "jszip", version: "3.10.1", id: null, expression: "MIT OR GPL-3.0", confidence: "medium" },
];

/**
 * Real licences this product deliberately does not read. The lane may know
 * them, and may even be right about the registry, and the answer must still be
 * refused because the id is not in the list this product names obligations
 * against. Label null, bucket "nonproduct", and the refusal is the pass.
 */
export const LICENSE_NONPRODUCT = [
  { name: "tr46", version: "0.0.3", id: null, registryId: "Unicode-DFS-2016", confidence: "high" },
];

/** One synthetic DependencyLicense row that reads as Unknown. */
function unknownComponent({ name, version, declared = null }) {
  return {
    name,
    version,
    depth: "direct",
    dev: false,
    declared,
    // The product reads these three off the string it actually read. Declared is
    // null on purpose: the lockfile carried no licence field, which is the only
    // state the guarded hook is allowed to ask about.
    spdx: "Unknown",
    unknownReason: declared === null ? "nothing was declared" : "the declaration could not be read",
    deprecated: false,
    operator: "single",
    exceptions: [],
    source: "none",
  };
}

/** The full licence fixture as DependencyLicense rows, plus the label index. */
export function licenseFixture() {
  const rows = [];
  const labels = new Map();
  const push = (bucket, entries) => {
    for (const entry of entries) {
      rows.push(unknownComponent(entry));
      labels.set(`${entry.name}@${entry.version}`, {
        bucket,
        id: entry.id,
        confidence: entry.confidence,
        registryId: entry.registryId ?? null,
        expression: entry.expression ?? null,
      });
    }
  };
  push("known", LICENSE_KNOWN);
  push("nonexistent", LICENSE_NONEXISTENT);
  push("dual", LICENSE_DUAL);
  push("nonproduct", LICENSE_NONPRODUCT);
  return { components: rows, labels };
}

/**
 * Plain-word assist fixture.
 *
 * `title` and `why` are written in the jargon register the shipped deterministic
 * plan produces, because that is the baseline the AI answer is measured
 * against. `anchors` are the plain nouns a rewrite must keep: without one of
 * them the sentence has stopped saying what the finding said. This is the
 * fixture's own acceptance rule for "still true", and it is checked against the
 * rewrite, never against the model's own opinion of itself.
 */
export const ASSIST_FIXTURE = [
  {
    fingerprint: "code.weak-crypto:3:src/crypto/deriveKey.ts:0f3a91c2",
    severity: "high",
    title: "Weak hash algorithm for a password check",
    why: "A password comparison path uses MD5, which is not a password hashing function and is not safe for this.",
    anchors: ["password"],
  },
  {
    fingerprint: "secret.hardcoded-credential:2:src/db/connect.ts:77b1e4d0",
    severity: "high",
    title: "A credential appears in a committed file",
    why: "A database password literal is written into a tracked source file and would ship to anyone who clones the repository.",
    anchors: ["password"],
  },
  {
    fingerprint: "code.sql-injection:3:src/api/search.ts:5c9d22e1",
    severity: "high",
    title: "A database query is assembled by string concatenation",
    why: "A request parameter is concatenated into a SQL statement instead of being bound, so the query shape is caller controlled.",
    anchors: ["query"],
  },
  {
    fingerprint: "cfg.http-only-missing:1:src/server/session.ts:11a2bc3d",
    severity: "high",
    title: "Session cookie is served without the HttpOnly attribute",
    why: "The session cookie is set without HttpOnly, so script running in the page can read the session token.",
    anchors: ["cookie", "session"],
  },
  {
    fingerprint: "dep.vulnerable:lodash:1:package-lock.json:aa11bb22",
    severity: "medium",
    title: "A dependency has a known fix available",
    why: "The locked lodash version is inside the range affected by a published prototype pollution advisory with a patched release.",
    anchors: ["dependency"],
  },
  {
    fingerprint: "dep.vulnerable:minimist:1:package-lock.json:cc33dd44",
    severity: "medium",
    title: "A dependency has a known fix available",
    why: "The locked minimist version is inside the range affected by a published prototype pollution advisory with a patched release.",
    anchors: ["dependency"],
  },
  {
    fingerprint: "sec.headers.csp:1:src/index.html:9f8e7d6c",
    severity: "medium",
    title: "No Content Security Policy is served",
    why: "No CSP response header is set, so there is no declared restriction on which script sources the page may load.",
    anchors: ["page"],
  },
  {
    fingerprint: "sec.headers.hsts:1:src/server/tls.ts:5b4a3c2d",
    severity: "medium",
    title: "No HSTS header is served",
    why: "Strict-Transport-Security is not set, so a first request can still be made over plain HTTP.",
    anchors: ["request"],
  },
  {
    fingerprint: "code.tls-version:2:src/net/client.ts:2e1d0c9b",
    severity: "low",
    title: "A legacy TLS version is offered",
    why: "The TLS client configuration still offers TLS 1.0 and TLS 1.1, which are deprecated protocol versions.",
    anchors: ["protocol"],
  },
  {
    fingerprint: "code.eval-use:2:src/jobs/render.ts:8a7b6c5d",
    severity: "low",
    title: "Dynamic evaluation of a computed string",
    why: "A computed string reaches an eval equivalent, so the expression text is data rather than a fixed literal.",
    anchors: ["expression"],
  },
  {
    fingerprint: "code.debug-logger:1:src/log/trace.ts:4d3e2f1a",
    severity: "low",
    title: "A debug logger is enabled in a shipped path",
    why: "A verbose logger is enabled on a non-debug path, so request detail is written to the application log.",
    anchors: ["log"],
  },
  {
    fingerprint: "info.readme-badge:0:README.md:1234abcd",
    severity: "info",
    title: "A status badge links to a build page",
    why: "The README shows a build status badge that points at a hosted CI page.",
    anchors: ["readme"],
  },
];

/**
 * Reorder fixture. Two severity bands plus info, because info is the row set the
 * lane must never see and the report must show it stayed out.
 *
 * `label` is the ground truth the decision lane is measured against, and it is
 * the thing `decisionMonitoring.notMeasured` says is not stored anywhere. It was
 * authored here, by rule, so the numbers below are not the model marking its
 * own work:
 *
 *   1 = a stranger can be harmed or embarrassed if this ships as it is
 *       (a live credential, a caller-shaped query, a session token readable by
 *        page script, a known-bad dependency version)
 *   0 = real, and worth fixing, but not before sharing
 */
export const REORDER_FIXTURE = [
  { fingerprint: "dep.vulnerable:lodash:1:package-lock.json:aa11bb22", severity: "high", ruleId: "dep:vulnerable", title: "lodash has a known prototype pollution fix", label: 1 },
  { fingerprint: "dep.vulnerable:minimist:1:package-lock.json:cc33dd44", severity: "high", ruleId: "dep:vulnerable", title: "minimist has a known prototype pollution fix", label: 1 },
  { fingerprint: "secret.hardcoded-credential:2:src/db/connect.ts:77b1e4d0", severity: "high", ruleId: "secret:hardcoded-credential", title: "A database password appears in a committed file", label: 1 },
  { fingerprint: "secret.api-key:2:src/client/pay.ts:1f2e3d4c", severity: "high", ruleId: "secret:api-key", title: "A payment API key appears in a committed file", label: 1 },
  { fingerprint: "cfg.tls-verify-disabled:3:src/net/client.ts:9a8b7c6d", severity: "high", ruleId: "cfg:tls-verify", title: "TLS certificate verification can be skipped", label: 1 },
  { fingerprint: "code.weak-crypto:3:src/crypto/deriveKey.ts:0f3a91c2", severity: "high", ruleId: "code:weak-crypto", title: "A password check uses a weak hash", label: 0 },
  { fingerprint: "sec.headers.csp:1:src/index.html:9f8e7d6c", severity: "high", ruleId: "sec:headers", title: "No Content Security Policy is served", label: 0 },
  { fingerprint: "code.redirect-open:3:src/http/redirect.ts:5e4d3c2b", severity: "high", ruleId: "code:redirect", title: "A redirect target is taken from a request header", label: 0 },
  { fingerprint: "code.sql-injection:3:src/api/search.ts:5c9d22e1", severity: "medium", ruleId: "code:sql-injection", title: "A search query is concatenated from a parameter", label: 1 },
  { fingerprint: "cfg.http-only-missing:1:src/server/session.ts:11a2bc3d", severity: "medium", ruleId: "cfg:http-only", title: "Session cookie is served without HttpOnly", label: 1 },
  { fingerprint: "dep.pinned-missing:1:package-lock.json:ffee0011", severity: "medium", ruleId: "deps:unpinned", title: "A dependency range is not pinned to a version", label: 0 },
  { fingerprint: "code.child-process:3:src/tools/convert.ts:6b7a8c9d", severity: "medium", ruleId: "code:child-process", title: "A command is built from a file name a caller supplies", label: 0 },
  { fingerprint: "sec.headers.hsts:1:src/server/tls.ts:5b4a3c2d", severity: "medium", ruleId: "sec:headers", title: "No HSTS header is served", label: 0 },
  { fingerprint: "code.log-secret:2:src/log/audit.ts:3c4d5e6f", severity: "medium", ruleId: "code:log-secret", title: "A request header is written to the log verbatim", label: 0 },
  { fingerprint: "info.readme-badge:0:README.md:1234abcd", severity: "info", ruleId: "info:badge", title: "A status badge links to a build page", label: 0 },
  { fingerprint: "info.license-file:0:LICENSE.txt:aabbccdd", severity: "info", ruleId: "info:license", title: "A licence file is present at the repository root", label: 0 },
];

/**
 * Fixed strings for the deterministic guard probes on the lookup hook.
 *
 * These measure the GUARD, not the model, so no lane is asked and no number
 * here is a statement about what a model knows. Each is a real shape of wrong
 * answer the guard exists to refuse, named for the shape rather than quoted
 * back from any run.
 */
export const GUARD_PROBES = [
  { id: "deprecated_id", answer: "GPL-2.0", expectRefusal: false, why: "a deprecated SPDX id normalizes and is kept with the deprecated flag set" },
  // Measured, not assumed. `normalizeSpdxId` documents the plus form as
  // normalizing to GPL-2.0-or-later, and it does, but `classifyLookupAnswer`
  // runs the `isKnownSpdxId` whitelist on the raw answer FIRST, and "gpl-2.0+"
  // is not a key in that map. So the lookup path refuses the plus form even
  // though the normalizer would have accepted it. Fail-closed, so not a safety
  // defect; recorded because it is a real disagreement between two modules and
  // the report should not hide it.
  { id: "deprecated_plus", answer: "GPL-2.0+", expectRefusal: true, why: "the whitelist runs before the normalizer, so the plus form never reaches the normalization that would accept it" },
  { id: "unknown_id", answer: "NotALicence-9.9", expectRefusal: true, why: "not an id on the list this product reads" },
  { id: "not_product_id", answer: "Unicode-DFS-2016", expectRefusal: true, why: "a real SPDX id that is outside this product's list" },
  { id: "prose", answer: "The package is published under the MIT licence.", expectRefusal: true, why: "more than one word" },
  { id: "two_ids", answer: "MIT OR Apache-2.0", expectRefusal: true, why: "more than one word, and an expression is not a bare id" },
  { id: "severity_word", answer: "critical", expectRefusal: true, why: "not an id, and a severity must never come from this lane" },
  { id: "empty", answer: "", expectRefusal: true, why: "an empty answer is not a licence" },
  { id: "null", answer: null, expectRefusal: true, why: "no answer at all" },
  { id: "over_length", answer: "X".repeat(41), expectRefusal: true, why: "longer than one licence id" },
];