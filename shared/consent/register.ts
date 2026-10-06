// The GDPR Article 30 register, generated as deterministic text.
//
// Art 30(1) names seven items for a controller and Art 30(2) names four for a
// processor. This product is a controller, so this file answers the seven, one
// entry per processing activity rather than per table, because Art 30 asks about
// a purpose and a purpose is not a column.
//
// Everything below is drawn from the code in this repository. A table named here
// exists in convex/schema.ts. A retention window named here is either bound to a
// purge in convex/ or is written as having none. That is enforced by
// tests/consent-standards-checks.mjs, which reads the schema and the purge calls
// rather than trusting this file.
//
// What this file does not do:
//
//   - It does not invent a legal entity. docs/PRIVACY.md section 1 says no
//     registered company name, address, or data protection officer is published,
//     so the controller block says exactly that.
//   - It does not assert a region. No host or provider has confirmed one.
//   - It does not claim a lawful basis is correct. Each basis below is the basis
//     the product operates on, cited by article, and each is marked as unreviewed
//     because no lawyer has reviewed it.
//
// Determinism: the text is a pure function of the ACTIVITIES below. No clock, no
// environment, no iteration order left to chance, so a committed register either
// matches the code or a test fails.

import { CONSENT_PURPOSES, CONTROLLER_PARTY, NOT_FILLED_FIELDS } from "./vocabulary.ts";
import type { ConsentPurpose } from "./vocabulary.ts";

/** The date this register was last reviewed against the code. A fact, not a clock read. */
export const REGISTER_LAST_REVIEWED = "2026-10-06";

/** The register shape version, so a copy kept for a year stays readable. */
export const REGISTER_SCHEMA_VERSION = "launchsense.art30-register/1.0";

/** A place personal data is held. A Convex table, or something outside this schema. */
export interface Store {
  /** A table name in convex/schema.ts, or a named file, or a host. */
  location: string;
  /** True when `location` is a table in convex/schema.ts. */
  is_table: boolean;
  note: string;
}

export interface Recipient {
  party: string;
  role: "processor" | "source_of_data" | "public_link";
  /** What it receives, in the words the code uses. */
  receives: string;
  /** A region, or the one word used when nobody confirmed one. */
  region: string;
  region_unknown: boolean;
}

export interface Transfer {
  destination: string;
  safeguard: string;
  known: boolean;
}

/**
 * How a window is enforced, which is a different question from whether one exists.
 *
 * `purge`       a real deletion path, named in `enforced_by`.
 * `read_window` the value stops being used after the window. Nothing is deleted, so
 *               calling this a purge would be a claim about code that does not exist.
 * `none`        nothing enforces it. The data is kept.
 */
export type Enforcement = "purge" | "read_window" | "none";

export interface RetentionLine {
  /** The data, named as a table field where that is where it lives. */
  data: string;
  /** The window in words, or the honest statement that there is none. */
  window: string;
  enforcement: Enforcement;
  /**
   * The purge, cron, or deletion path that enforces the window, named as
   * `file:identifier`. Null when nothing enforces it, which is a gap.
   */
  enforced_by: string | null;
}

export interface ProcessingActivity {
  id: string;
  purpose: string;
  lawful_basis: string;
  /** Whether anyone has checked that basis. Nobody has. */
  lawful_basis_reviewed: boolean;
  /** The consent purpose this activity belongs to, when it belongs to one. */
  consent_purpose: ConsentPurpose["id"] | null;
  data_subject_categories: string[];
  personal_data_categories: string[];
  /**
   * The columns, as `table.column`, that hold the personal data above.
   *
   * Prose categories are what a reader understands and columns are what a test can
   * check. Both are here: the prose for the register, the columns so a claim cannot
   * name a value this schema does not hold.
   */
  data_points: string[];
  storage: Store[];
  recipients: Recipient[];
  third_country_transfers: Transfer[];
  retention: RetentionLine[];
  security_measures: string;
  /** Art 22(1) and Art 13(2)(f). Stated for every activity, not only the AI one. */
  automated_decision_making: string;
  /** Where a person exercises the choice for this activity. */
  choice: string;
}

const UNKNOWN_REGION = { region: "unknown", region_unknown: true } as const;

/**
 * One Store per Convex table, because a reader has to be able to check each name
 * against convex/schema.ts and a comma-joined note would hide them.
 */
const tables = (...names: string[]): Store[] =>
  names.map((name) => ({
    location: name,
    is_table: true,
    note: "A table in convex/schema.ts. What it holds is named in this activity's personal data list.",
  }));

/** Somewhere personal data lands that is not a table in this schema. */
const outside = (location: string, note: string): Store => ({ location, is_table: false, note });

/** Every activity shares these two security measures, stated once and referenced. */
const SECURITY = [
  "HTTPS in transit. No claim is made about a TLS version, because this repository does not configure one.",
  "Every snippet passes through redaction before it can reach storage, and raw secret values are never written.",
  "A signed-in read is authorised against the caller's own rows on every read, not only on write.",
];

const NO_ART22 =
  "No automated decision within Art 22(1). A fixed rule pack produces the findings and the severities, no profile of a person is built, and nothing here decides anything about a person.";

export const PROCESSING_ACTIVITIES: readonly ProcessingActivity[] = [
  {
    id: "acct-001",
    purpose: "Read one public repository the visitor named and return findings about it.",
    lawful_basis: "GDPR Art 6(1)(f) legitimate interests",
    lawful_basis_reviewed: false,
    consent_purpose: null,
    data_subject_categories: [
      "Anonymous visitors, who are not signed in and hold no account",
      "Coding tool operators, whose tool passes a public repository URL",
    ],
    personal_data_categories: [
      "Repository owner and name, and the repository URL",
      "Commit sha and tree sha",
      "File paths",
      "Finding records: rule id, path, line, severity, title, reason, fingerprint",
      "A redacted snippet per finding, capped at 200 characters",
      "Per file: path, size, and a content hash",
      "Live check results when an app URL is given: the URL, the final URL, the HTTP status, the redirect count",
      "Queue position rows, quota state, and rate limit counters",
      "Vulnerability answers from OSV, keyed by package name and version",
      "Share and passport artifacts, which are public links",
    ],
    data_points: [
      "scans.owner",
      "scans.repo",
      "scans.repoUrl",
      "scans.sha",
      "scans.commitSha",
      "scans.treeSha",
      "scans.liveUrl",
      "scans.status",
      "scans.errorKind",
      "scans.surface",
      "scans.channel",
      "repoTrees.sha",
      "repoTrees.treeSha",
      "repoTrees.entries",
      "repoTrees.fileCount",
      "fileContents.path",
      "fileContents.size",
      "fileContents.contentSha",
      "fileContents.fetchedAt",
      "evidenceItems.ruleId",
      "evidenceItems.path",
      "evidenceItems.line",
      "evidenceItems.severity",
      "evidenceItems.redactedSnippet",
      "evidenceItems.contentHash",
      "findings.ruleId",
      "findings.fingerprint",
      "findings.path",
      "findings.line",
      "findings.severity",
      "findings.title",
      "findings.why",
      "findings.bucket",
      "liveChecks.url",
      "liveChecks.finalUrl",
      "liveChecks.httpStatus",
      "liveChecks.hops",
      "scanQueue.startedAt",
      "scanQueue.queuedAt",
      "quotaState.remaining",
      "quotaState.resetAt",
      "rateLimits.key",
        "rateLimits.day",
        "rateLimits.count",
        "osvCache.name",
        "osvCache.version",
        "osvCache.vulns",
        "findingTransitions.state",
        "findingTransitions.cause",
        "shareArtifacts.shareId",
        "passportArtifacts.passportId",
      ],
      storage: [
        ...tables(
          "scans",
          "repoTrees",
          "fileContents",
          "evidenceItems",
          "findings",
          "liveChecks",
          "scanQueue",
          "quotaState",
          "rateLimits",
          "osvCache",
          "findingTransitions",
          "shareArtifacts",
          "passportArtifacts",
        ),
      outside(
        "Convex platform logs",
        "Every request address lands in the host's logs. They are not a table in this schema and this product cannot read or delete them.",
      ),
    ],
    recipients: [
      {
        party: "Convex",
        role: "processor",
        receives: "The database and the hosting, so the rows above exist",
        ...UNKNOWN_REGION,
      },
      {
        party: "GitHub",
        role: "source_of_data",
        receives: "Nothing is sent to GitHub. The repository data is read from GitHub.",
        ...UNKNOWN_REGION,
      },
    ],
    third_country_transfers: [
      {
        destination: "unknown",
        safeguard: "No region has been confirmed with the host, and no transfer safeguard is named because there is nothing to name against a known destination.",
        known: false,
      },
    ],
    retention: [
      {
        data: "fileContents: cached file metadata",
        window: "Deleted after 24 hours by a later scan of that repository.",
        enforcement: "purge",
        enforced_by: "CONTENT_CACHE_TTL_MS in convex/scans/analyze.ts, through convex/scans/store.ts:purgeStaleContents, bounded at 500 rows a run",
      },
      {
        data: "osvCache: vulnerability answers",
        window: "Reused for 7 days and then looked up again, which overwrites the row. Nothing deletes this table.",
        enforcement: "read_window",
        enforced_by:
          "OSV_CACHE_TTL_MS in convex/scans/analyze.ts. The row stops being read after the window and the answer is fetched again. That is not a deletion.",
      },
      {
        data: "findings and evidenceItems",
        window: "Kept so a re-scan can say what was fixed. No automatic deletion exists.",
        enforcement: "none",
        enforced_by: null,
      },
      {
        data: "rateLimits",
        window: "One row per key per day, never deleted. It holds no part of a network address.",
        enforcement: "none",
        enforced_by: null,
      },
      {
        data: "shareArtifacts and passportArtifacts",
        window: "Kept. A link that was published stays public, because a published link cannot be unpublished.",
        enforcement: "none",
        enforced_by: null,
      },
    ],
    security_measures: SECURITY.join(" "),
    automated_decision_making: NO_ART22,
    choice: "Do not paste a URL and nothing is collected. Share and passport links are created by the person who presses the button, and the row names the scan they belong to.",
  },
  {
    id: "acct-002",
    purpose: "Keep a GitHub token so a signed-in person is not asked to sign in again, and read one repository with it.",
    lawful_basis: "GDPR Art 6(1)(b) contract",
    lawful_basis_reviewed: false,
    consent_purpose: "token",
    data_subject_categories: ["Account holders who signed in with GitHub"],
    personal_data_categories: [
      "A GitHub OAuth access token, stored as a plaintext string at rest",
      "Account id, email address, and the account fields GitHub returns at sign-in",
      "Scans linked to that account id",
      "Saved projects, usage meters, and feature entitlements",
      "The sign-in decisions themselves: which of the four purposes, whether each was granted, the wording version, the click time, and the time the row was written",
    ],
    data_points: [
      "githubScanTokens.accessToken",
      "githubScanTokens.userId",
      "githubScanTokens.updatedAt",
      "scans.userId",
      "scans.signedIn",
      "projects.userId",
      "projects.owner",
      "projects.repo",
      "usageMeters.userId",
      "usageMeters.kind",
      "usageMeters.day",
      "featureEntitlements.featureKey",
      "featureEntitlements.enabled",
      "connectedInstallations.userId",
      "connectedInstallations.installationId",
      "connectedInstallations.account",
      "connectedInstallations.repoSelection",
      "connectedInstallations.installationTargetId",
      "consentRecords.userId",
      "consentRecords.purposeId",
      "consentRecords.granted",
      "consentRecords.noticeVersion",
      "consentRecords.decidedAt",
      "consentRecords.recordedAt",
      "consentRecords.source",
    ],
    storage: [
      ...tables("githubScanTokens", "projects", "usageMeters", "featureEntitlements", "connectedInstallations", "consentRecords"),
      outside(
        "users and the auth tables from @convex-dev/auth",
        "The account row, the email address, and the fields GitHub returns at sign-in. They are authTables spread into the schema rather than a table this file names, so they are listed here instead of being claimed as a schema table.",
      ),
    ],
    recipients: [
      {
        party: "Convex",
        role: "processor",
        receives: "The database, including the token in the clear",
        ...UNKNOWN_REGION,
      },
      {
        party: "GitHub",
        role: "source_of_data",
        receives: "The sign-in request and the repository read. The token is the person's own.",
        ...UNKNOWN_REGION,
      },
    ],
    third_country_transfers: [
      {
        destination: "unknown",
        safeguard: "No region has been confirmed with the host or with GitHub.",
        known: false,
      },
    ],
    retention: [
      {
        data: "githubScanTokens: the token",
        window: "Until the person signs out from the menu. A session that expires on its own does not delete it.",
        enforcement: "none",
        enforced_by: null,
      },
      {
        data: "projects, usageMeters, featureEntitlements",
        window: "Kept while the account exists. No automatic deletion exists.",
        enforcement: "none",
        enforced_by: null,
      },
      {
        data: "consentRecords: the sign-in decisions",
        window: "Kept while the account exists. Nothing in this repository deletes the table, so a stored decision cannot be taken back from the product today.",
        enforcement: "none",
        enforced_by: null,
      },
    ],
    security_measures: [
      "The token is readable only by server-side internal functions. The functions a signed-in caller can invoke return a boolean or nothing.",
      "Signing out deletes the token row in the same action that ends the session.",
      "The token is stored as a plaintext string. That is a stated fact of this build, not an oversight being described as a control.",
      "A consent record is written under the account id in the session, never under one supplied by the caller, and the export query returns only the caller's own rows.",
    ].join(" "),
    automated_decision_making: NO_ART22,
    choice: "Sign out from the menu and the token is deleted straight away. There is no account deletion button, and this one says so rather than implying one exists.",
  },
  {
    id: "acct-003",
    purpose: "Rewrite one finding in plainer language, on a button press, through an AI provider.",
    lawful_basis: "GDPR Art 6(1)(a) consent",
    lawful_basis_reviewed: false,
    consent_purpose: "explain",
    data_subject_categories: ["Anyone who presses Explain in plain words"],
    personal_data_categories: [
      "A finding fingerprint, which is a hash the report already shows",
      "The severity, the title, and the reason",
      "The provider call row: day, source, model, latency, a hash of the prompt, and token counts",
      "The sign-in decision for this purpose, and the same columns the other three purposes carry",
    ],
    data_points: [
      "providerCalls.scanId",
      "providerCalls.source",
      "providerCalls.model",
      "providerCalls.latencyMs",
      "providerCalls.promptHash",
      "providerCalls.inputTokens",
      "providerCalls.outputTokens",
      "providerCalls.totalTokens",
      "providerCalls.ok",
      "providerCalls.day",
      "consentRecords.purposeId",
      "consentRecords.granted",
      "consentRecords.noticeVersion",
      "consentRecords.decidedAt",
    ],
    storage: [...tables("providerCalls", "consentRecords")],
    recipients: [
      {
        party: "Google Gemini",
        role: "processor",
        receives: "The fingerprint, the severity, the title, and the reason",
        ...UNKNOWN_REGION,
      },
      {
        party: "Ollama Cloud",
        role: "processor",
        receives: "The same four values, only if Gemini does not answer first",
        ...UNKNOWN_REGION,
      },
    ],
    third_country_transfers: [
      {
        destination: "unknown",
        safeguard: "Neither provider has confirmed a region or a retention period to this product, so neither is asserted. Writing a plausible region here is the failure this field exists to prevent.",
        known: false,
      },
    ],
    retention: [
      {
        data: "The request and the reply at the provider",
        window: "Not confirmed with either provider, so no window is stated.",
        enforcement: "none",
        enforced_by: null,
      },
      {
        data: "providerCalls",
        window: "Kept. Nothing in this repository deletes it.",
        enforcement: "none",
        enforced_by: null,
      },
      {
        data: "consentRecords: the decision for this purpose",
        window: "Kept while the account exists. Nothing in this repository deletes the table, so the decision cannot be taken back from the product today.",
        enforcement: "none",
        enforced_by: null,
      },
    ],
    security_measures: [
      "The request carries no file path and no file contents.",
      "Output is rejected when it references an unknown finding, drops an actionable finding, or claims a check that did not run. Rejected output falls back to fixed wording.",
      "If neither provider answers, no provider is asked and fixed wording is shown.",
      "The decision that allows this purpose is stored as granted true or false against the account in the session, and no model asks it, records it, or reads it.",
    ].join(" "),
    automated_decision_making:
      "A model rewrites the wording of a finding that a fixed rule already produced. It cannot add, drop, re-rank, or re-score a finding. The plain-words button does nothing at all without a press, which is what puts it on consent rather than contract.",
    choice: "Do not press Explain in plain words and no provider is asked. A scan never asks a provider by itself.",
  },
  {
    id: "acct-004",
    purpose: "Count which harness calls the hosted coding tool address, which tool, how often, and whether it worked.",
    lawful_basis: "GDPR Art 6(1)(f) legitimate interests",
    lawful_basis_reviewed: false,
    consent_purpose: "usage",
    data_subject_categories: ["Coding tool operators, who are not identified by the call"],
    personal_data_categories: [
      "A protocol action count per day: initialize, tools/list, tools/call",
      "An allowlisted harness name, at most eight values, and an optional client version",
      "The protocol version, the method name, the tool name, and the outcome",
      "A one-way hash of a repository name scoped to the day, when a call read a repository",
      "The daily rolled-up counts",
    ],
    data_points: [
      "usageEvents.day",
      "usageEvents.kind",
      "usageEvents.clientName",
      "usageEvents.clientVersion",
      "usageEvents.protocolVersion",
      "usageEvents.mcpMethodName",
      "usageEvents.toolName",
      "usageEvents.outcome",
      "usageEvents.errorType",
      "usageEvents.rpcResponseStatusCode",
      "usageEvents.durationMs",
      "usageEvents.repoKey",
      "dailyMetrics.day",
      "dailyMetrics.metric",
      "dailyMetrics.dims",
      "dailyMetrics.count",
    ],
    storage: [...tables("usageEvents", "dailyMetrics")],
    recipients: [
      {
        party: "Convex",
        role: "processor",
        receives: "The database",
        ...UNKNOWN_REGION,
      },
    ],
    third_country_transfers: [
      {
        destination: "unknown",
        safeguard: "No region has been confirmed with the host.",
        known: false,
      },
    ],
    retention: [
      {
        data: "usageEvents",
        window: "Deleted after 30 days by a nightly job, bounded at 500 rows a run.",
        enforcement: "purge",
        enforced_by:
          "USAGE_EVENT_TTL_MS in convex/analytics/retention.ts, called by the purge expired usage events cron in convex/crons.ts at 03:40 UTC",
      },
      {
        data: "dailyMetrics",
        window: "Kept. Nothing deletes it. It holds counts and low-cardinality labels, and no repository name.",
        enforcement: "none",
        enforced_by: null,
      },
    ],
    security_measures: [
      "The caller's network address is not read on these routes and never reaches an event row.",
      "The repository URL is never recorded, even though the OpenTelemetry specification would allow it as an opt-in attribute. The attribute carries a warning about sensitive content, and here it would be a list of whose code was read.",
      "A harness name goes through a fixed eight-value allowlist before it lands, so one caller cannot mint a new dimension per request.",
    ].join(" "),
    automated_decision_making: NO_ART22,
    choice: "Send no credential and the calls are counted in the shared bucket with no account attached. Send a credential and they are counted against that credential's own bucket.",
  },
  {
    id: "acct-005",
    purpose: "Receive usage counts from the local review, after the person answers one question and says yes.",
    lawful_basis: "GDPR Art 6(1)(a) consent",
    lawful_basis_reviewed: false,
    consent_purpose: "usage",
    data_subject_categories: ["People who installed the local review and answered yes, and people who signed in and ticked the usage box"],
    personal_data_categories: [
      "Rule id counts, the harness label, the tool version, the run duration, and which order source ran",
      "The decision itself, with its time, on the person's own machine",
      "For a signed-in person, the same decision as one row in consentRecords under their account id",
    ],
    data_points: [
      "usageDiagnostics.day",
      "usageDiagnostics.stage",
      "usageDiagnostics.tier",
      "usageDiagnostics.harness",
      "usageDiagnostics.version",
      "usageDiagnostics.durationMs",
      "usageDiagnostics.orderSource",
      "usageDiagnostics.ruleCounts",
      "consentRecords.purposeId",
      "consentRecords.granted",
      "consentRecords.decidedAt",
    ],
    storage: [
      outside(
        "~/.config/launchsense/consent.jsonl",
        "On the person's own machine. Append-only, one line per decision, never uploaded because nothing reads it.",
      ),
      ...tables("usageDiagnostics", "consentRecords"),
    ],
    recipients: [
      {
        party: "Convex",
        role: "processor",
        receives: "The counts, over the hosted usage route",
        ...UNKNOWN_REGION,
      },
    ],
    third_country_transfers: [
      {
        destination: "unknown",
        safeguard: "No region has been confirmed with the host.",
        known: false,
      },
    ],
    retention: [
      {
        data: "usageDiagnostics",
        window: "Kept. Nothing in this repository deletes this table, and this is a gap rather than a window.",
        enforcement: "none",
        enforced_by: null,
      },
      {
        data: "The ledger on the person's machine",
        window: "Kept by the person. This product deletes nothing and reads nothing.",
        enforcement: "none",
        enforced_by: null,
      },
      {
        data: "consentRecords: the usage decision for a signed-in person",
        window: "Kept while the account exists. Nothing in this repository deletes the table, and the local question is still the one that decides whether counts are sent.",
        enforcement: "none",
        enforced_by: null,
      },
    ],
    security_measures: [
      "The route refuses a payload containing path, content, snippet, or title keys, and refuses a counts string over 4000 characters.",
      "An enterprise tier record is refused and stores nothing.",
      "The question defaults to no, and a run that only repeats an answer already on record writes no line.",
    ].join(" "),
    automated_decision_making: NO_ART22,
    choice: "Answer no, or set LAUNCHSENSE_DIAGNOSTICS=off, or use the enterprise tier. Usage counts then stay on the person's machine and nothing is sent.",
  },
  {
    id: "acct-006",
    purpose: "Hold a server-minted credential so a coding tool can be given its own quota, attribution, and revocation.",
    lawful_basis: "GDPR Art 6(1)(b) contract",
    lawful_basis_reviewed: false,
    consent_purpose: null,
    data_subject_categories: ["Whoever the credential was minted for, which may be no account at all"],
    personal_data_categories: [
      "A lookup prefix in the clear, and a SHA-256 hash of the full token",
      "The token itself is never stored",
      "A harness label recorded by an operator at issuance",
      "The account the credential was bound to, when one exists",
      "Last used time and revocation time",
    ],
    data_points: [
      "credentials.publicId",
      "credentials.tokenHash",
      "credentials.userId",
      "credentials.declaredHarness",
      "credentials.verifiedBinding",
      "credentials.audience",
      "credentials.revoked",
      "credentials.revokedAt",
      "credentials.lastUsedAt",
    ],
    storage: [...tables("credentials")],
    recipients: [
      {
        party: "Convex",
        role: "processor",
        receives: "The database",
        ...UNKNOWN_REGION,
      },
    ],
    third_country_transfers: [
      {
        destination: "unknown",
        safeguard: "No region has been confirmed with the host.",
        known: false,
      },
    ],
    retention: [
      {
        data: "credentials",
        window: "Kept after revocation. Nothing in this repository deletes the row, so a revoked credential is refused forever and still stored.",
        enforcement: "none",
        enforced_by: null,
      },
    ],
    security_measures: [
      "The stored value is a SHA-256 of a 256-bit server-generated secret, so a database read cannot be replayed against the server.",
      "Revocation is read on every request, so it takes effect on the next request rather than at an expiry.",
      "The harness label is never a policy input: it enters no rate limit key, no ownership check, and no access decision.",
    ].join(" "),
    automated_decision_making: NO_ART22,
    choice: "There is no public mint route and no UI, so a person cannot obtain or revoke a credential from the product today.",
  },
  {
    id: "acct-007",
    purpose: "Count visits, shares, and the actions taken on a public link, to know whether the product is used.",
    lawful_basis: "GDPR Art 6(1)(f) legitimate interests",
    lawful_basis_reviewed: false,
    consent_purpose: null,
    data_subject_categories: ["Visitors, including anyone holding a published link"],
    personal_data_categories: [
      "An event kind per day, at most ten kinds, bounded by kind and day",
      "A share id, and the scan the link belongs to",
    ],
    data_points: [
      "analyticsEvents.day",
      "analyticsEvents.kind",
      "analyticsEvents.scanId",
      "analyticsEvents.shareId",
      "analyticsEvents.refShareId",
      "analyticsEvents.createdAt",
    ],
    storage: [...tables("analyticsEvents")],
    recipients: [
      {
        party: "Convex",
        role: "processor",
        receives: "The database",
        ...UNKNOWN_REGION,
      },
    ],
    third_country_transfers: [
      {
        destination: "unknown",
        safeguard: "No region has been confirmed with the host.",
        known: false,
      },
    ],
    retention: [
      {
        data: "analyticsEvents",
        window: "Kept. Nothing in this repository deletes this table.",
        enforcement: "none",
        enforced_by: null,
      },
    ],
    security_measures: [
      "Writes are bounded by event kind and day, so the public endpoint cannot write an unbounded stream of rows.",
      "No free text, no repository name, and no network address reach this table.",
    ].join(" "),
    automated_decision_making: NO_ART22,
    choice: "Do not open the product and nothing is counted. There is no analytics script, no chat widget, and no advertising tag on the page.",
  },
  {
    id: "acct-008",
    purpose: "Receive the request address the browser and the font service expose without asking.",
    lawful_basis: "GDPR Art 6(1)(f) legitimate interests",
    lawful_basis_reviewed: false,
    consent_purpose: null,
    data_subject_categories: ["Every visitor, including one who never scans anything"],
    personal_data_categories: ["The browser's network address, seen by the font service and by the host's request logs"],
    data_points: [
    ],
    storage: [
      outside(
        "Google Fonts, in the visitor's browser",
        "Two font families are loaded from Google, so the browser contacts Google with the visitor's address before the page draws. This product receives nothing back and stores nothing.",
      ),
      outside(
        "Convex platform logs",
        "The address stays in the host's logs. This product does not read, keep, or delete them.",
      ),
    ],
    recipients: [
      {
        party: "Google Fonts",
        role: "processor",
        receives: "The visitor's address, from the visitor's own browser",
        ...UNKNOWN_REGION,
      },
    ],
    third_country_transfers: [
      {
        destination: "unknown",
        safeguard: "This activity happens before any page control exists, so no consent covers it and no safeguard is named.",
        known: false,
      },
    ],
    retention: [
      {
        data: "Font service and host request logs",
        window: "Not known to this product. The retention is the two services', not ours, and no window is asserted.",
        enforcement: "none",
        enforced_by: null,
      },
    ],
    security_measures:
      "There is nothing to control here: the contact happens in the visitor's browser before this product is asked for anything. Not loading the fonts would remove it, and that trade has not been made.",
    automated_decision_making:
      "No automated decision. No row is written and nothing is stored by this product.",
    choice: "A visitor can block the font request in their browser. Nothing else on the page asks.",
  },
  {
    id: "acct-009",
    purpose:
      "Read the person's own checkout, including agent instruction files, so the local review can report on it. Nothing is uploaded.",
    lawful_basis: "GDPR Art 6(1)(b) performance of a contract",
    lawful_basis_reviewed: false,
      consent_purpose: "files",
    data_subject_categories: ["The person who installed the local review and is running it on their own machine"],
    personal_data_categories: [
      "File paths in the person's checkout",
      "File contents, read on the person's own machine",
      "Agent instruction files, such as AGENTS.md or CLAUDE.md",
      "The acknowledgement decision itself, with its time, on the person's own machine",
    ],
    data_points: [
    ],
    storage: [
      outside(
        "~/.config/launchsense/consent.jsonl",
        "On the person's own machine. The acknowledgement is one line. The files themselves are never written anywhere.",
      ),
    ],
    recipients: [],
    third_country_transfers: [],
    retention: [
      {
        data: "The files a review reads",
        window: "Kept only for the run. Nothing is uploaded, so there is no server copy to delete.",
        enforcement: "none",
        enforced_by: null,
      },
      {
        data: "The acknowledgement line on the person's machine",
        window: "Kept by the person. This product deletes nothing and reads nothing beyond the run.",
        enforcement: "none",
        enforced_by: null,
      },
    ],
    security_measures:
      "The read happens on the person's own machine and nothing is uploaded, so there is no network copy to protect. The question is an acknowledgement rather than consent: the default is yes, and a pre-answered question is not a freely given agreement, which is why the lawful basis is stated as contract and not as consent.",
    automated_decision_making:
      "No automated decision. Nothing is stored off the machine.",
    choice: "Type no at the question and the expanded read does not happen. The acknowledgement line records the answer either way.",
  },
];

export interface ProcessingRegister {
  schema_version: string;
  last_reviewed: string;
  controller: {
    /** Null, because no registered name is published. */
    registered_name: string | null;
    party_id: string;
    contact: string;
    dpo: null;
    note: string;
  };
  activities: ProcessingActivity[];
  /** Art 30(2) is the processor's list. It is named here so its absence is deliberate. */
  processor_register: {
    applies: false;
    why: string;
  };
  /** The exemption analysis, with its conclusion and its evidence. */
  exemption: {
    article: string;
    available: boolean;
    why: string;
  };
  not_filled: typeof NOT_FILLED_FIELDS;
  source_of_truth: string;
}

export function buildProcessingRegister(): ProcessingRegister {
  return {
    schema_version: REGISTER_SCHEMA_VERSION,
    last_reviewed: REGISTER_LAST_REVIEWED,
    controller: {
      registered_name: CONTROLLER_PARTY.registered_name,
      party_id: CONTROLLER_PARTY.party_id,
      contact: CONTROLLER_PARTY.contact,
      dpo: null,
      note: "No registered company name, registered address, or data protection officer is published. docs/PRIVACY.md section 1 says the same thing to a reader. This register does not fill the gap with a guess.",
    },
    activities: [...PROCESSING_ACTIVITIES],
    processor_register: {
      applies: false,
      why: "This product acts as a controller for the activities above. The Art 30(2) items belong to a processor's register, and the processors named here are Convex, GitHub, Google Gemini, Ollama Cloud, and the font service. Each of those keeps its own register, which this repository neither holds nor may write.",
    },
    exemption: {
      article: "GDPR Art 30(5)",
      available: false,
      why: "The small-organisation exemption is disapplied unless the processing is occasional and carries no risk to data subjects and touches no special category. A code scanner clears all three tests: it reads source code, which routinely contains credentials and personal data, and it does so on every scan rather than occasionally. So the exemption is unavailable and this register is required. That reading is this product's own and no lawyer has reviewed it.",
    },
    not_filled: NOT_FILLED_FIELDS,
    source_of_truth: "shared/consent/register.ts",
  };
}

/** The register as text. Deterministic, so a committed copy either matches or fails. */
export function renderProcessingRegister(): string {
  const register = buildProcessingRegister();
  const lines: string[] = [];
  lines.push("# Processing activities register");
  lines.push("");
  lines.push(
    `Generated from \`${register.source_of_truth}\` by \`scripts/processing-register.mjs\`. Do not edit this file by hand.`,
  );
  lines.push("");
  lines.push(`Register version: ${register.schema_version}. Last reviewed against the code: ${register.last_reviewed}.`);
  lines.push("");
  lines.push(
    "This is the record GDPR Article 30(1) asks a controller to keep, in writing and in electronic form. " +
      "It is generated from the schema, the retention constants, and the purge calls in this repository, so a " +
      "change to the data model changes this document. Every table and column it names is checked against " +
      "convex/schema.ts, and every retention line either names the purge that enforces it or says that nothing does.",
  );
  lines.push("");
  lines.push("It is not legal advice, and no lawyer has reviewed it.");
  lines.push("");
  lines.push("## Controller");
  lines.push("");
  lines.push(`- Name: ${register.controller.registered_name ?? "not published"}`);
  lines.push(`- Party id used in this repository: ${register.controller.party_id}`);
  lines.push(`- Contact: ${register.controller.contact}`);
  lines.push(`- Data protection officer: ${register.controller.dpo ?? "none appointed"}`);
  lines.push(`- ${register.controller.note}`);
  lines.push("");
  lines.push("## Why the small-organisation exemption does not apply");
  lines.push("");
  lines.push(`- Article: ${register.exemption.article}`);
  lines.push(`- Exemption available: ${register.exemption.available ? "yes" : "no"}`);
  lines.push(`- ${register.exemption.why}`);
  lines.push("");
  lines.push("## Processor register");
  lines.push("");
  lines.push(
    `- Art 30(2) names four items for a processor. ${register.processor_register.why}`,
  );
  lines.push("");
  lines.push("## Activities");
  lines.push("");
  for (const activity of register.activities) {
    lines.push(`### ${activity.id}: ${activity.purpose}`);
    lines.push("");
    lines.push(`- Lawful basis: ${activity.lawful_basis}. Reviewed by a lawyer: ${activity.lawful_basis_reviewed ? "yes" : "no"}.`);
    if (activity.consent_purpose !== null) {
      const purpose = CONSENT_PURPOSES.find((item) => item.id === activity.consent_purpose);
      // "Recorded" and "readable by this generator" are different facts, and the
      // sentence has to say which one it means. The Art 30 register is about what
      // the controller holds, so the database row is the fact that belongs here.
      const where =
        purpose?.recorded_in === "local_ledger"
          ? ", and a decision is on record in the ledger on the person's own machine"
          : purpose?.recorded_in === "convex_database"
            ? ", and a decision is on record in the Convex table consentRecords for a person who signed in"
            : ", and no decision is on record for it anywhere";
      lines.push(`- Consent purpose: ${activity.consent_purpose}${where}.`);
    }
    lines.push(`- Data subjects: ${activity.data_subject_categories.join("; ")}.`);
    lines.push(`- Personal data: ${activity.personal_data_categories.join("; ")}.`);
    lines.push(
      activity.data_points.length === 0
        ? "- Columns holding it: none in this schema. Nothing is written for this activity."
        : `- Columns holding it: ${activity.data_points.join(", ")}.`,
    );
    lines.push("- Storage:");
    for (const store of activity.storage) {
      lines.push(`  - ${store.is_table ? "Table" : "Not a table"}: ${store.location}. ${store.note}`);
    }
    lines.push("- Recipients:");
    for (const recipient of activity.recipients) {
      const region = recipient.region_unknown ? "region unknown, not confirmed" : recipient.region;
      lines.push(`  - ${recipient.party} (${recipient.role}, ${region}): ${recipient.receives}`);
    }
    lines.push("- Third country transfers:");
    for (const transfer of activity.third_country_transfers) {
      lines.push(`  - ${transfer.destination} (${transfer.known ? "known" : "not known"}): ${transfer.safeguard}`);
    }
    lines.push("- Retention:");
    for (const line of activity.retention) {
      lines.push(`  - ${line.data}: ${line.window}`);
      lines.push(`    Enforced: ${line.enforcement}.`);
      lines.push(
        `    By: ${line.enforced_by ?? "nothing in this repository enforces this. It is a gap."}`,
      );
    }
    lines.push(`- Security measures: ${activity.security_measures}`);
    lines.push(`- Automated decision making: ${activity.automated_decision_making}`);
    lines.push(`- How a person chooses: ${activity.choice}`);
    lines.push("");
  }
  lines.push("## Fields this register cannot fill");
  lines.push("");
  for (const gap of register.not_filled) {
    lines.push(`- \`${gap.field}\`: ${gap.why}`);
  }
  lines.push("");
  lines.push(
    "A field listed here is absent because nothing in this repository can state it honestly. " +
      "It is not absent because nobody filled it in.",
  );
  lines.push("");
  return lines.join("\n");
}