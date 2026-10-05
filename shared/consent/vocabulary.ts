// The consent vocabulary. One entry per purpose this product asks a person
// about, in the field names ISO/IEC TS 27560:2023 uses.
//
// The standard supplies the structure. Every value below is this product's, and
// every value is either read from the code or named as a gap. Nothing here is
// filled in because a privacy notice would look tidier with it.
//
// What this file is NOT: it is not a record. `record.ts` builds a record from a
// decision, `register.ts` states the same facts as an Art 30 register. This file
// is the single place a purpose is described, so those three cannot disagree
// about what a purpose is.
//
// Two inputs, both real:
//
//   usage     install.sh, one question, answered once, remembered in
//             ~/.config/launchsense/consent.jsonl. This is a consent record.
//   token     src/features/auth/AuthPanel.tsx, four unticked boxes. The boxes
//   read     are client-side React state and nothing writes them down anywhere.
//   explain   So for these three the honest status is asked and not recorded, and
//             `recorded: false` says so on the record rather than implying a row
//             exists. That gap is the most important thing in this file.
//
// Cited vocabulary:
//   ISO/IEC TS 27560:2023, first edition 2023-08. Table 1 (record header) and
//   Table 2 (PII processing) name the fields. Annex A gives JSON and JSON-LD
//   example records; this file follows the field list, not a transcription.
//   W3C Data Privacy Vocabulary v2, CG-Final 2024-08-01. A Community Group
//   Final Specification, so it is cited as a vocabulary and not as a standard.

/** The shape version, pinned so a record written before a change stays readable. */
export const CONSENT_SCHEMA_VERSION = "launchsense.consent/1.0";

/** The record id derivation. Content-addressed, so a receipt can be re-checked. */
export const CONSENT_RECORD_ID_METHOD = "content-derived-uuid-v8-of-purpose-notice-time";

/**
 * The wording the installer shows, as the exact lines install.sh prints.
 *
 * Change one line here and the receipt stops matching what the person read, which
 * is the point: the wording is part of what was agreed to. A test compares this
 * array against install.sh so the two cannot drift silently.
 */
export const DIAGNOSTICS_NOTICE_WORDING: readonly string[] = [
  "Send anonymous usage counts to LaunchSense?",
  "This sends rule id counts, the harness name, the version, how long the",
  "review took, and which order source ran.",
  "It does not send code, file paths, finding titles, or function names.",
  "The review reads files on this machine. It does not upload them.",
  "Type yes to send. Type no to keep it on this machine. Default is no.",
];

/**
 * The notice version. This is the SAME string install.sh sets, and it is the
 * answer key to "which wording was in force when the person answered". The
 * installer re-asks when this string changes, so a record for old text cannot
 * supply the time for new text.
 */
export const DIAGNOSTICS_NOTICE_VERSION = "2026-10-05";

/** Where the append-only ledger lives, relative to the person's home directory. */
export const CONSENT_LEDGER_PATH = ".config/launchsense/consent.jsonl";

/** Where the privacy notice is published. The record cites it rather than copying it. */
export const PRIVACY_NOTICE_URI = "https://harmless-chihuahua-667.convex.site/privacy";

/** The repository copy of the same notice. */
export const PRIVACY_NOTICE_REPO_PATH = "docs/PRIVACY.md";

/**
 * The controller identity, as far as it honestly goes.
 *
 * `registered_name` is null because there is none to state. docs/PRIVACY.md
 * section 1 says no registered company name, registered address, or named data
 * protection officer is published. Inventing one here would make the register
 * read better and the record false, so the field is null and `notFilled` names it.
 */
export interface Party {
  party_id: string;
  role: "controller" | "processor_or_independent_controller";
  /** A published name, or null when none is published. */
  registered_name: string | null;
  /** How a person reaches us. The only channel the product has. */
  contact: string;
  /** True when no registered legal entity exists for this party. */
  registration_unknown: boolean;
}

export const CONTROLLER_PARTY: Party = {
  party_id: "launchsense",
  role: "controller",
  registered_name: null,
  contact: "www.withkeshav.com",
  registration_unknown: true,
};

/** A PII category named the way a notice has to name it: what the value is. */
export interface PiiCategory {
  type: string;
  sensitive: boolean;
  /** Where the value comes from, for the Art 13 collection line. */
  source: string;
}

export interface StorageLocation {
  system: string;
  /** A region, or the one word this product will use when it does not know. */
  region: string;
  /** True when nobody confirmed the region, so nothing asserts it. */
  region_unknown: boolean;
  note: string;
}

/** Retention, split into the window and the code that enforces it. */
export interface Retention {
  /** The window in words a person can read. */
  window: string;
  /**
   * The purge, cron, or deletion path that enforces it, named as
   * `file:identifier`. Null when nothing enforces it, which is a gap and not a
   * shorter window.
   */
  enforced_by: string | null;
}

export interface ConsentPurpose {
  /** The id used by AuthPanel, so a copy change and a record change are one change. */
  id: "token" | "read" | "explain" | "usage";
  /** The label the person actually reads on the box. */
  label: string;
  description: string;
  /** DPV lawful basis term, and the article it stands for. */
  lawful_basis: string;
  lawful_basis_citation: string;
  /** True only where a decision is written down somewhere this product controls. */
  recorded: boolean;
  /** Why a purpose is not recorded, when it is not. */
  not_recorded_reason: string | null;
  /** Where the decision lands. Null where nothing stores it. */
  ledger: string | null;
  collection_method: string;
  processing_method: string;
  pii_information: PiiCategory[];
  pii_controllers: Party[];
  storage_locations: StorageLocation[];
  retention: Retention;
  /** The C2PA humanOversightLevel term for what a model writes here, if anything. */
  human_oversight_level: "prompt_guided" | "fully_autonomous" | "human_validated" | null;
}

const UNKNOWN_REGION = {
  region: "unknown",
  region_unknown: true,
  note: "No provider or host has confirmed a region to this product, and none is asserted here.",
};

const CONVEX_LOCATION: StorageLocation = {
  system: "Convex database, deployment harmless-chihuahua-667",
  ...UNKNOWN_REGION,
};

const LOCAL_LEDGER: StorageLocation = {
  system: "The person's own machine, ~/.config/launchsense/consent.jsonl",
  ...UNKNOWN_REGION,
  note: "This file never leaves the machine. Nothing uploads it, because nothing reads it.",
};

/**
 * The four purposes, in the order the sign-in panel lists them.
 *
 * The order matters: it is the order the person reads, and a record set that
 * reordered itself would be a record nobody can compare with the box they ticked.
 */
export const CONSENT_PURPOSES: readonly ConsentPurpose[] = [
  {
    id: "token",
    label: "Store my GitHub token so I do not sign in again",
    description: "Keep the GitHub access token for one account so the person is not asked to sign in again.",
    lawful_basis: "dpv:Contract",
    lawful_basis_citation: "GDPR Art 6(1)(b). Sign-in is what the person asked for, so it is not a consent case.",
    recorded: false,
    not_recorded_reason:
      "The four boxes in AuthPanel are client-side React state. No code writes a decision, a time, or a wording version for them, so there is nothing to turn into a record.",
    ledger: null,
    collection_method: "just_in_time_notice_at_sign_in",
    processing_method: "stored_on_our_server_and_read_by_our_server_only",
    pii_information: [
      { type: "github_oauth_access_token", sensitive: true, source: "the person, through GitHub sign-in" },
      { type: "account_id", sensitive: false, source: "our own account record" },
    ],
    pii_controllers: [CONTROLLER_PARTY],
    storage_locations: [CONVEX_LOCATION],
    retention: {
      window: "Until the person signs out from the menu. A session that expires on its own does not delete it.",
      enforced_by: null,
    },
    human_oversight_level: null,
  },
  {
    id: "read",
    label: "Read one repository on my token",
    description: "Use that token once, on our server, to download one repository archive.",
    lawful_basis: "dpv:Contract",
    lawful_basis_citation: "GDPR Art 6(1)(b). The read is the service that was asked for.",
    recorded: false,
    not_recorded_reason:
      "The four sign-in boxes are client-side React state and no code writes them down. The scan rows are recorded, but the decision to allow this read is not.",
    ledger: null,
    collection_method: "just_in_time_notice_at_sign_in",
    processing_method: "read_in_memory_and_discarded",
    pii_information: [
      { type: "repository_owner_and_name", sensitive: false, source: "the person, in the field they typed" },
      { type: "commit_sha", sensitive: false, source: "GitHub, about the person's repository" },
      { type: "file_paths", sensitive: false, source: "GitHub, about the person's repository" },
      { type: "github_oauth_access_token", sensitive: true, source: "the person, through GitHub sign-in" },
    ],
    pii_controllers: [CONTROLLER_PARTY],
    storage_locations: [CONVEX_LOCATION],
    retention: {
      window: "File contents: read in memory and never written. Cached file metadata: deleted after 24 hours.",
      enforced_by:
        "CONTENT_CACHE_TTL_MS in convex/scans/analyze.ts, called through convex/scans/store.ts:purgeStaleContents, bounded at 500 rows a run",
    },
    human_oversight_level: null,
  },
  {
    id: "explain",
    label: "Explain findings in plain words with an AI provider",
    description: "Send one finding's fingerprint, severity, title, and reason to an AI provider, on a button press.",
    lawful_basis: "dpv:Consent",
    lawful_basis_citation: "GDPR Art 6(1)(a). The scan works without it, so consent is the right basis here and not contract.",
    recorded: false,
    not_recorded_reason:
      "The four sign-in boxes are client-side React state and no code writes them down. The provider call itself is recorded in providerCalls, but the decision that allowed it is not.",
    ledger: null,
    collection_method: "just_in_time_notice_at_sign_in_and_again_at_the_button",
    processing_method: "transmitted_to_a_processor_over_tls",
    pii_information: [
      { type: "finding_fingerprint", sensitive: false, source: "our own analysis of the person's code" },
      { type: "finding_severity", sensitive: false, source: "our own analysis" },
      { type: "finding_title", sensitive: false, source: "our own rule pack" },
      { type: "finding_reason", sensitive: false, source: "our own rule pack" },
    ],
    pii_controllers: [
      CONTROLLER_PARTY,
      {
        party_id: "google_gemini",
        role: "processor_or_independent_controller",
        registered_name: "Google LLC",
        contact: "policies.google.com/privacy",
        registration_unknown: false,
      },
      {
        party_id: "ollama_cloud",
        role: "processor_or_independent_controller",
        registered_name: null,
        contact: "ollama.com/privacy",
        registration_unknown: true,
      },
    ],
    storage_locations: [
      CONVEX_LOCATION,
      {
        system: "Google Gemini, then Ollama Cloud if Gemini does not answer",
        ...UNKNOWN_REGION,
        note: "Which provider receives a given request depends on which one answers first.",
      },
    ],
    retention: {
      window:
        "No provider retention is confirmed with either provider, so none is stated. Locally we keep a providerCalls row: the day, the source, the model, the latency, a hash of the prompt, and token counts.",
      enforced_by: null,
    },
    human_oversight_level: "prompt_guided",
  },
  {
    id: "usage",
    label: "Send anonymous usage counts from the coding tool connection",
    description: "Send rule id counts, the harness name, the version, the run duration, and the order source.",
    lawful_basis: "dpv:Consent",
    lawful_basis_citation: "GDPR Art 6(1)(a). The counts are optional and default to off.",
    recorded: true,
    not_recorded_reason: null,
    ledger: LOCAL_LEDGER.system,
    collection_method: "one_question_before_anything_is_recorded_default_is_no",
    processing_method: "transmitted_over_tls_to_our_own_server",
    pii_information: [
      { type: "rule_id_counts", sensitive: false, source: "the local review, counted on the person's machine" },
      { type: "harness_label", sensitive: false, source: "the person's own configuration, so a claim" },
      { type: "tool_version", sensitive: false, source: "the local review" },
      { type: "run_duration", sensitive: false, source: "the local review" },
      { type: "order_source", sensitive: false, source: "the local review" },
    ],
    pii_controllers: [CONTROLLER_PARTY],
    storage_locations: [
      LOCAL_LEDGER,
      {
        system: "Convex database, table usageDiagnostics",
        ...UNKNOWN_REGION,
        note: "Written only after the person answers yes. Nothing deletes these rows today.",
      },
    ],
    retention: {
      window: "The ledger on the person's machine is never deleted by us. The row we store has no deletion window.",
      enforced_by: null,
    },
    human_oversight_level: null,
  },
];

/** The one purpose with a decision on record. Everything else names its own gap. */
export function purposeById(id: ConsentPurpose["id"]): ConsentPurpose {
  const found = CONSENT_PURPOSES.find((purpose) => purpose.id === id);
  if (found === undefined) throw new Error(`no consent purpose with id ${id}`);
  return found;
}

/**
 * Every field TS 27560 names that this product cannot honestly fill, with the
 * reason. The record carries this list so a reader is told what is missing
 * instead of finding a blank and guessing.
 *
 * A field that later becomes fillable is deleted from here, not reworded.
 */
export interface NotFilled {
  /** Dotted path into the record, so a reader can find the gap. */
  field: string;
  /** Why it is absent, in one line. */
  why: string;
}

export const NOT_FILLED_FIELDS: readonly NotFilled[] = [
  {
    field: "pii_controllers[].registered_name",
    why: "No registered legal entity is published. docs/PRIVACY.md section 1 says so. Inventing one would make the record false.",
  },
  {
    field: "pii_principal_id",
    why: "The ledger holds no person identifier. install.sh records a decision about wording, not about who answered, so the id is scoped to this record and links to nobody.",
  },
  {
    field: "storage_locations[].region",
    why: "No host or provider has confirmed a region. Every region reads unknown rather than a plausible guess.",
  },
  {
    field: "event.type=consent_withdrawn",
    why: "No withdrawal path is built. install.sh can be re-run with LAUNCHSENSE_DIAGNOSTICS=off, which writes a refusal, and that refusal is the closest thing to a withdrawal this product has.",
  },
  {
    field: "integrity.record_hash (as written by the installer)",
    why: "The installer writes no hash. The chain is derived by the reader from the append-only file, so tampering is detectable only against that file and not against a stored copy.",
  },
  {
    field: "pii_controllers[].data_protection_officer",
    why: "No data protection officer is named or appointed. There is no contact role to fill this with.",
  },
];