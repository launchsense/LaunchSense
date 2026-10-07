// The analytics data rule, written down as data so a test can hold the schema to it.
//
// The operator's rule, in one line: analytics must never carry PII. The only
// identifier analytics is allowed to keep is the repository identifier, and only
// for three technical purposes: running the scan, linking a rescan, and counting
// the funnel. No name, no email address, no network address, no account
// identifier, and no free text.
//
// Why this is a file and not a paragraph in docs/PRIVACY.md: a paragraph cannot
// fail. Every field of every analytics table is listed below with the class it
// holds and the bound that keeps it out of PII, and
// tests/analytics-pii-checks.mjs parses convex/schema.ts and compares it against
// this list field by field. A new column that nobody classified fails the suite,
// which is the only moment the rule can actually catch somebody.
//
// Legal basis. The rule is written to the two definitions that apply:
//   GDPR Article 4(1): personal data is any information relating to an identified
//     or identifiable natural person, and a person is identifiable by reference
//     to an identifier. Recital 26: the principles do not apply to anonymous
//     information. https://gdpr-info.eu/art-4-gdpr/ and
//     https://gdpr-info.eu/recitals/no-26/
//   India DPDP Act 2023, s2(4)(t): personal data is any data about an individual
//     who is identifiable by or in relation to such data.
//     https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf
// A public repository name alone is generally not personal data under either,
// because a name is not data about an identifiable person. A private repository
// name tied to one person can be, so the analytics stream never stores the
// literal: usageEvents carries only the day-scoped HMAC repoKey.
//
// The four classes:
//   pii           a name, an email address, a network address, or free text.
//                 The rule forbids these, so this list must never contain one.
//   pseudonymous  an opaque server row id. It points at a person or a credential
//                 without naming either, and it cannot be turned back into one
//                 without the database.
//   repoId        the repository identifier. The only identifier allowed here,
//                 and only for the three technical purposes above.
//   technical     a count, a code, a time, a duration, or a closed enum.
//
// "Bounded by" is what separates a technical string column from free text. A
// column that is declared v.string() and given no bound is free text by another
// name, so the test refuses one. Every string column below names the check that
// keeps it short and closed.

// A field as the inventory records it.
export type FieldClass = "pii" | "pseudonymous" | "repoId" | "technical";

export type InventoryField = {
  /** The column name, exactly as convex/schema.ts spells it. */
  field: string;
  klass: FieldClass;
  /** Why this column is not PII. One line, plain words. */
  why: string;
  /** Required on every string column: the check that keeps it out of free text. */
  boundedBy?: string;
};

export type InventoryTable = {
  table: string;
  /** What the table is for, in one line. */
  role: string;
  fields: InventoryField[];
};

/**
 * The tables the analytics lane owns. Everything here is read by a dashboard, a
 * rollup, or a quota decision. The field list is the schema's, in the schema's
 * order, and the test compares them exactly.
 */
export const ANALYTICS_TABLES: readonly InventoryTable[] = [
  {
    table: "usageEvents",
    role: "One row per MCP protocol action on the hosted address. Purged after 30 days.",
    fields: [
      {
        field: "day",
        klass: "technical",
        why: "The UTC date the fold groups by, derived from now inside the mutation.",
        boundedBy: "An ISO date, ten characters, never caller input.",
      },
      {
        field: "kind",
        klass: "technical",
        why: "Which protocol action happened. A closed union of three values.",
        boundedBy: "v.union of three literals.",
      },
      {
        field: "surface",
        klass: "technical",
        why: "Which surface the row came from. This table only serves one surface.",
        boundedBy: "v.literal, one value.",
      },
      {
        field: "clientName",
        klass: "technical",
        why: "Which coding tool called, not a person's name. Mapped through a fixed allowlist of eight values, and anything outside it becomes other.",
        boundedBy: "allowlistedClientName, eight values, and an empty result refuses the row.",
      },
      {
        field: "clientVersion",
        klass: "technical",
        why: "The tool's own version string. Declared by the caller, so it is shape checked rather than trusted.",
        boundedBy: "/^[A-Za-z0-9.+_-]{1,32}$/ at the write path, refused otherwise.",
      },
      {
        field: "protocolVersion",
        klass: "technical",
        why: "The MCP protocol version, one of the versions the parser accepts.",
        boundedBy: "The negotiated value from the parser, never a free argument.",
      },
      {
        field: "mcpMethodName",
        klass: "technical",
        why: "The JSON-RPC method name, which is one of three the surface answers.",
        boundedBy: "A literal set by the call site: initialize, tools/list, tools/call.",
      },
      {
        field: "toolName",
        klass: "technical",
        why: "Which tool was called, one of two known names. An unrecognised name emits a row with no toolName rather than the name the caller sent.",
        boundedBy: "Written only after the tool matched, so only the two known names can land.",
      },
      {
        field: "outcome",
        klass: "technical",
        why: "How the call ended. A closed union, checked at the argument validator.",
        boundedBy: "v.union of four literals.",
      },
      {
        field: "errorType",
        klass: "technical",
        why: "The OpenTelemetry low-cardinality error type. Never the error text itself.",
        boundedBy: "A named enum set by the call site, never the caught message.",
      },
      {
        field: "rpcResponseStatusCode",
        klass: "technical",
        why: "The JSON-RPC numeric status, so a protocol error code stays countable.",
        boundedBy: "A number.",
      },
      {
        field: "durationMs",
        klass: "technical",
        why: "How long the action took.",
        boundedBy: "A number.",
      },
      {
        field: "scanId",
        klass: "pseudonymous",
        why: "An opaque Convex row id, so an event can be correlated to a scan without naming the repository. No writer sets it today, which is stated rather than hidden.",
      },
      {
        field: "repoKey",
        klass: "repoId",
        why: "One of two identifiers analytics may keep, the other being the anonymous visitor id. It is a day-scoped HMAC of owner/repo, and the literal repository name never reaches this column.",
        boundedBy: "/^[0-9a-f]{64}$/ at the write path, refused otherwise, so a raw owner/repo cannot be stored even by mistake.",
      },
      {
        field: "createdAt",
        klass: "technical",
        why: "When the row was written.",
        boundedBy: "A number, milliseconds.",
      },
    ],
  },
  {
    table: "dailyMetrics",
    role: "The nightly rollup. The only table a reader touches, and it is counts.",
    fields: [
      {
        field: "day",
        klass: "technical",
        why: "The UTC day being replaced, computed before the fold reads anything.",
        boundedBy: "An ISO date derived from the cron's now.",
      },
      {
        field: "metric",
        klass: "technical",
        why: "Which number the row is. A closed vocabulary, so the table cannot grow a metric nobody declared.",
        boundedBy: "The METRIC_NAMES list in convex/analytics/rollup.ts.",
      },
      {
        field: "dims",
        klass: "technical",
        why: "A small set of labels for the count: client, tool, outcome, surface, status, reason, cause, useful. Never a repository, a path, a title, a visitor id, or any free text.",
        boundedBy: "Every dimension bag passes forbiddenPropertiesIn before it becomes a row, and the JSON is capped at 400 characters.",
      },
      {
        field: "count",
        klass: "technical",
        why: "How many.",
        boundedBy: "A number.",
      },
      {
        field: "ratio",
        klass: "technical",
        why: "The share for a guardrail, where the metric has one.",
        boundedBy: "A number between 0 and 1.",
      },
      {
        field: "createdAt",
        klass: "technical",
        why: "When the fold wrote the day.",
        boundedBy: "A number, milliseconds.",
      },
    ],
  },
  {
    table: "analyticsEvents",
    role: "One row per product event from the website, capped per kind per day.",
    fields: [
      {
        field: "day",
        klass: "technical",
        why: "The UTC day the cap is counted over.",
        boundedBy: "An ISO date derived from now inside the mutation.",
      },
      {
        field: "kind",
        klass: "technical",
        why: "Which product event happened. A closed union of thirteen values.",
        boundedBy: "v.union of thirteen literals.",
      },
      {
        field: "scanId",
        klass: "pseudonymous",
        why: "An opaque Convex row id for the scan the event belongs to. It is not a repository name.",
      },
      {
        field: "shareId",
        klass: "pseudonymous",
        why: "A server-minted share link id, 128 bits of randomness. A value that is not that shape is dropped rather than stored, so no caller-supplied text can reach this column.",
        boundedBy: "publicIdOrNull, 32 lower-case hex characters, checked at the write path.",
      },
      {
        field: "refShareId",
        klass: "pseudonymous",
        why: "The share link a visitor arrived from, read out of the URL by the browser. Same rule as shareId: the browser may send any string, so only the minted shape is kept.",
        boundedBy: "publicIdOrNull, 32 lower-case hex characters, checked at the write path.",
      },
      {
        field: "visitorId",
        klass: "pseudonymous",
        why: "A random id the server minted for one browser, so visits can be counted as distinct without naming a person, a device, or an address. Only the minted UUID shape is kept; anything else is dropped while the event is still recorded.",
        boundedBy: "visitorIdOrNull, UUID shape, checked at the write path.",
      },
      {
        field: "feedbackUseful",
        klass: "technical",
        why: "Whether the visitor said the report was useful. A boolean, so no words can arrive.",
        boundedBy: "v.boolean, present only on report_feedback rows.",
      },
      {
        field: "feedbackReason",
        klass: "technical",
        why: "Why the visitor said so, in their pick from six fixed labels. There is no text box on the feedback path, so no typed words can reach this column.",
        boundedBy: "v.union of six literals, present only on report_feedback rows.",
      },
      {
        field: "createdAt",
        klass: "technical",
        why: "When the event happened.",
        boundedBy: "A number, milliseconds.",
      },
    ],
  },
  {
    table: "visitorDays",
    role: "First-seen rows for anonymous visitors. The rollup counts them and the raw ids expire after 30 days.",
    fields: [
      {
        field: "day",
        klass: "technical",
        why: "The UTC day of first sight, derived from now inside the mutation.",
        boundedBy: "An ISO date, ten characters, never caller input.",
      },
      {
        field: "visitorId",
        klass: "pseudonymous",
        why: "A random id the server minted. It names no person, device, or address, and it is the only visitor key the product keeps.",
        boundedBy: "crypto.randomUUID at the write path, lower-cased, UUID shape.",
      },
      {
        field: "firstSeenAt",
        klass: "technical",
        why: "When the id was minted.",
        boundedBy: "A number, milliseconds.",
      },
    ],
  },
  {
    table: "rateLimits",
    role: "Quota and abuse counters. Keyed on identity, never on a network address.",
    fields: [
      {
        field: "key",
        klass: "pseudonymous",
        why: "The bucket name, assembled inside the mutation from a fixed template plus an hour, a day, a scan row id, or an account row id. The last is the only caller-derived part and it is an opaque id. No part of a caller's network address is in it.",
        boundedBy: "Composed by the code from named parts, never taken from a request argument.",
      },
      {
        field: "day",
        klass: "technical",
        why: "The UTC day the counter belongs to.",
        boundedBy: "An ISO date derived from now inside the mutation.",
      },
      {
        field: "count",
        klass: "technical",
        why: "How many calls the bucket has spent.",
        boundedBy: "A number.",
      },
      {
        field: "updatedAt",
        klass: "technical",
        why: "When the counter last moved.",
        boundedBy: "A number, milliseconds.",
      },
    ],
  },
  {
    table: "usageDiagnostics",
    role: "What the local installer reports, and only after the person answered yes.",
    fields: [
      {
        field: "day",
        klass: "technical",
        why: "The UTC day the report belongs to.",
        boundedBy: "An ISO date derived from now inside the mutation.",
      },
      {
        field: "stage",
        klass: "technical",
        why: "Which stage of the product the install is at.",
        boundedBy: "Closed set: only alpha. Anything else is normalized to other.",
      },
      {
        field: "tier",
        klass: "technical",
        why: "Which tier the install declares. Enterprise reports are dropped at the write path.",
        boundedBy: "Closed set: alpha or pro. Anything else is normalized to other.",
      },
      {
        field: "harness",
        klass: "technical",
        why: "The harness label the installer declares. It is a claim about a tool, not a person's name, and it is matched against the hosted client-name set plus local.",
        boundedBy: "Closed set: local, cursor, claude_code, claude_desktop, codex, vscode, windsurf, other, unknown. Anything else is normalized to other.",
      },
      {
        field: "version",
        klass: "technical",
        why: "The installer's own version.",
        boundedBy: "alpha, or a plain version matching /^\\d{1,4}\\.\\d{1,4}(\\.\\d{1,4})?$/ (at most 14 characters). A pre-release suffix is refused, so a name cannot ride in one. Anything else is normalized to other.",
      },
      {
        field: "durationMs",
        klass: "technical",
        why: "How long the local review took.",
        boundedBy: "A number.",
      },
      {
        field: "orderSource",
        klass: "technical",
        why: "Which rung produced the finding order.",
        boundedBy: "Closed set: local, jev, perplexity, table, unspecified. Anything else is normalized to unspecified.",
      },
      {
        field: "orderMoved",
        klass: "technical",
        why: "How many positions the decision lane moved inside a severity band. A count, never an item, a title, or a path.",
        boundedBy: "A number.",
      },
      {
        field: "laneAnswered",
        klass: "technical",
        why: "Whether a rung other than the table named the order. A boolean.",
        boundedBy: "A boolean.",
      },
      {
        field: "suggestionSource",
        klass: "technical",
        why: "Which rung produced the licence suggestion. A closed label, never a licence name or a reason.",
        boundedBy: "Closed set: local, jev, perplexity, table, none. Anything else is normalized to none.",
      },
      {
        field: "ruleCounts",
        klass: "technical",
        why: "How many times each rule id fired. Counts and rule ids, never code, a path, a title, or a snippet.",
        boundedBy: "Capped at 4000 characters and refused outright if it contains a path, content, snippet, or title key.",
      },
      {
        field: "govDetected",
        klass: "technical",
        why: "Whether a governance file was present. A boolean, so no path or reason can land.",
        boundedBy: "A boolean.",
      },
      {
        field: "govRefused",
        klass: "technical",
        why: "Why a governance file was refused, as a closed reason enum. Never free text, never a path.",
        boundedBy: "Closed set: none, unreadable, sandbag, and the sixteen parse reasons. Anything else is normalized to none.",
      },
      {
        field: "govStale",
        klass: "technical",
        why: "Whether the file names an old notice version. A boolean, so no version text is stored.",
        boundedBy: "A boolean.",
      },
      {
        field: "govSuppressedFingerprint",
        klass: "technical",
        why: "How many findings one fingerprint acceptance hid. A count, never a fingerprint.",
        boundedBy: "A number.",
      },
      {
        field: "govSuppressedRulePath",
        klass: "technical",
        why: "How many findings one rule plus path acceptance hid. A count, never a rule or a path.",
        boundedBy: "A number.",
      },
      {
        field: "govSuppressedRule",
        klass: "technical",
        why: "How many findings one rule acceptance hid. A count, never a rule.",
        boundedBy: "A number.",
      },
      {
        field: "govIgnored",
        klass: "technical",
        why: "How many ignore entries the file holds. A count, never a path.",
        boundedBy: "A number.",
      },
      {
        field: "govSandbag",
        klass: "technical",
        why: "Whether the file would silence too much and was refused whole. A boolean.",
        boundedBy: "A boolean.",
      },
      {
        field: "createdAt",
        klass: "technical",
        why: "When the report landed.",
        boundedBy: "A number, milliseconds.",
      },
    ],
  },
  {
    table: "providerCalls",
    role: "One row per Explain in plain words call, so token use and latency can be counted.",
    fields: [
      {
        field: "scanId",
        klass: "pseudonymous",
        why: "An opaque Convex row id for the scan the explanation belongs to.",
      },
      {
        field: "kind",
        klass: "technical",
        why: "Which lane asked for a provider.",
        boundedBy: "v.union of two literals.",
      },
      {
        field: "source",
        klass: "technical",
        why: "Which provider answered. A closed union, so a surprise provider cannot appear.",
        boundedBy: "v.union of seven literals.",
      },
      {
        field: "model",
        klass: "technical",
        why: "Which model that provider returned. A model name is not a person, and this is not a person.",
        boundedBy: "Written by the AI adapter from its own configuration for one of the seven sources above, never from a request argument.",
      },
      {
        field: "latencyMs",
        klass: "technical",
        why: "How long the provider took.",
        boundedBy: "A number.",
      },
      {
        field: "promptHash",
        klass: "technical",
        why: "A hash of the prompt, so two identical prompts can be counted once. The prompt itself is never stored here.",
        boundedBy: "A hash written by the caller of this mutation.",
      },
      {
        field: "inputTokens",
        klass: "technical",
        why: "Tokens sent.",
        boundedBy: "A number reported by the provider.",
      },
      {
        field: "outputTokens",
        klass: "technical",
        why: "Tokens received.",
        boundedBy: "A number reported by the provider.",
      },
      {
        field: "totalTokens",
        klass: "technical",
        why: "The provider's own total, so a disagreement with the sum is visible.",
        boundedBy: "A number reported by the provider.",
      },
      {
        field: "ok",
        klass: "technical",
        why: "Whether the call answered.",
        boundedBy: "A boolean.",
      },
      {
        field: "errorKind",
        klass: "technical",
        why: "Why it did not answer. A closed set, never the provider's error text.",
        boundedBy: "One of no_provider, validation_rejected, or absent.",
      },
      {
        field: "day",
        klass: "technical",
        why: "The UTC day the call belongs to.",
        boundedBy: "An ISO date derived from the mutation's now.",
      },
      {
        field: "createdAt",
        klass: "technical",
        why: "When the row was written.",
        boundedBy: "A number, milliseconds.",
      },
    ],
  },
  {
    table: "findingTransitions",
    role: "What changed between two scans of the same repository. The funnel is inferred from here.",
    fields: [
      {
        field: "fromScanId",
        klass: "pseudonymous",
        why: "An opaque Convex row id for the earlier scan.",
      },
      {
        field: "toScanId",
        klass: "pseudonymous",
        why: "An opaque Convex row id for the later scan. Every join in the fold goes through these two ids and never through the event stream.",
      },
      {
        field: "oldFingerprint",
        klass: "technical",
        why: "The finding fingerprint the rule matched on the earlier scan. It is a hash of a rule and a location in code, not a person.",
        boundedBy: "A fingerprint written by the analyzer, one per finding.",
      },
      {
        field: "newFingerprint",
        klass: "technical",
        why: "The fingerprint the rule matched on the later scan.",
        boundedBy: "A fingerprint written by the analyzer, one per finding.",
      },
      {
        field: "ruleId",
        klass: "technical",
        why: "Which rule fired. The product's own rule names.",
        boundedBy: "A rule id from the analyzer's own rule table.",
      },
      {
        field: "state",
        klass: "technical",
        why: "What happened to the finding between the two scans.",
        boundedBy: "v.union of five literals.",
      },
      {
        field: "cause",
        klass: "technical",
        why: "Why it changed, split so a developer's edit is never mixed with this product shipping a rule pack.",
        boundedBy: "v.union of four literals.",
      },
      {
        field: "createdAt",
        klass: "technical",
        why: "When the comparison was recorded.",
        boundedBy: "A number, milliseconds.",
      },
    ],
  },
];

// A column of a table the analytics lane reads without owning it.
export type SourceField = {
  /** The column name as convex/schema.ts spells it. */
  field: string;
  klass: FieldClass;
  /** What the analytics lane does with it. Read, used, or dropped. */
  fate: string;
};

export type AnalyticsSource = {
  table: string;
  role: string;
  fields: SourceField[];
};

/**
 * The product table the analytics fold reads. It is not an analytics table and
 * the rule above does not govern it: a scan has to carry the literal repository
 * name to run the scan at all, and that is product data a person can see.
 *
 * What matters is what leaves it. Every field the fold reads is listed, and the
 * repository name is read to link two scans and then dropped, so no folded day can
 * be joined back to a repository by anyone holding the rollup table.
 */
export const ANALYTICS_SOURCES: readonly AnalyticsSource[] = [
  {
    table: "scans",
    role: "Read by the nightly fold to count submitted, analyzed, partial, and rescanned work. The only repository name it holds is the product's own, and none of it is written to dailyMetrics.",
    fields: [
      {
        field: "_id",
        klass: "pseudonymous",
        fate: "Used. The only join key in the fold. Never written to a metric row.",
      },
      {
        field: "status",
        klass: "technical",
        fate: "Used as a metric dimension: completed, partial, or failed.",
      },
      {
        field: "owner",
        klass: "repoId",
        fate: "Read to build the in-memory distinct-repo count and then dropped. Never written to dailyMetrics.",
      },
      {
        field: "repo",
        klass: "repoId",
        fate: "Read to build the in-memory distinct-repo count and then dropped. Never written to dailyMetrics.",
      },
      {
        field: "createdAt",
        klass: "technical",
        fate: "Used. Attributes a submitted scan to the day it was submitted.",
      },
      {
        field: "analyzedAt",
        klass: "technical",
        fate: "Used. Attributes an analyzed scan to the day it produced a result.",
      },
      {
        field: "sha",
        klass: "technical",
        fate: "Declared on the fold's read projection but no metric reads it today. The commit hash stays on the product row.",
      },
      {
        field: "rescanOf",
        klass: "pseudonymous",
        fate: "Used. Its presence is what makes a submitted scan count as a rescan request.",
      },
      {
        field: "surface",
        klass: "technical",
        fate: "Used as a metric dimension: web or mcp_hosted.",
      },
      {
        field: "truncated",
        klass: "technical",
        fate: "Used as a partial-coverage reason.",
      },
      {
        field: "treeTruncated",
        klass: "technical",
        fate: "Used as a partial-coverage reason.",
      },
      {
        field: "errorKind",
        klass: "technical",
        fate: "Used as a partial-coverage reason. The closed union, never the scans.errorMessage beside it.",
      },
    ],
  },
];

/**
 * The fields the fold's read projection declares, as a flat list.
 *
 * The test compares this against the FoldScan type in convex/analytics/rollup.ts,
 * so a scan column added to the projection without a line here fails the suite.
 */
export const FOLD_SCAN_FIELDS: readonly string[] = ANALYTICS_SOURCES[0].fields.map(
  (field) => field.field,
);

/**
 * The three technical purposes the repository identifier is allowed to serve.
 *
 * Kept as data rather than a comment so the notice copy and this file cannot
 * drift apart, and so a reader can check the copy against one list.
 */
export const REPO_ID_PURPOSES: readonly string[] = [
  "running the scan",
  "linking a rescan",
  "counting the funnel",
];