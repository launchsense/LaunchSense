// One consent record and one consent receipt, in the shape ISO/IEC TS 27560:2023
// names.
//
// The record is held by the controller and documents the decision. The receipt is
// issued to the person and carries a reference to the record. Both exist here
// because both are cheap once the facts are in one place, and because the two
// answer different questions: the record answers "what did we record", the receipt
// answers "what did I agree to".
//
// Three rules this file does not bend:
//
//   1. One purpose per record. TS 27560 declines to say whether purposes may be
//      combined, then says that if a record holds several, the event applies to
//      all of them. One purpose per record removes that ambiguity entirely.
//
//   2. The notice is a reference plus a hash, never a stored copy. The control is
//      to keep the specific wording as it was presented, so the hash is taken over
//      the exact lines the person read. The wording itself appears in the receipt,
//      which is the copy the person keeps.
//
//   3. A field that cannot be honestly filled is named, not guessed. `not_filled`
//      is part of every record, and it lists what is absent and why. A record with
//      an empty string where a region belongs is worse than a record that says it
//      does not know the region.
//
// Determinate by construction: every value is derived from the ledger line, the
// notice wording, and the vocabulary. No clock, no random id, so running the
// generator twice over the same ledger gives the same record and the same
// receipt. That is what lets a person keep a receipt and check it later.

import { canonicalJson, derivedUuid, sha256Hex, sha256Prefixed } from "./digest.ts";
import {
  CONSENT_LEDGER_PATH,
  CONSENT_PURPOSES,
  CONSENT_RECORD_ID_METHOD,
  CONSENT_SCHEMA_VERSION,
  CONTROLLER_PARTY,
  NOT_FILLED_FIELDS,
  PRIVACY_NOTICE_URI,
  purposeById,
} from "./vocabulary.ts";
import type { ConsentPurpose, NotFilled } from "./vocabulary.ts";

/** The receipt shape version, so a receipt kept for a year stays readable. */
export const CONSENT_RECEIPT_VERSION = "launchsense.consent-receipt/1.0";

/** One line of the append-only ledger, as install.sh writes it. */
export interface LedgerDecision {
  noticeVersion: string;
  granted: boolean;
  /** ISO 8601 UTC, the moment the answer was given, not the moment it was rewritten. */
  decidedAt: string;
  /** How the answer was reached: prompt, a remembered answer, or a tier switch. */
  source: string;
  /**
   * Which question the line answers. One ledger holds every local question, so a
   * line without this field is an older line, and the only local question then was
   * usage, which is what it is read as.
   */
  purpose?: ConsentPurpose["id"];
  /** The exact ledger line, hashed as the record's own anchor. */
  line: string;
  /** Hash of the line before it, or null on the first line. */
  prevHash: string | null;
  /** True when no later line supersedes this one. */
  latest: boolean;
}

export type ConsentRecordStatus = "recorded" | "not_recorded" | "recorded_in_database";

/**
 * What `status` means, stated once so a reader of a record does not have to guess.
 *
 *   recorded             this record documents a decision, and it carries the time
 *                        and the derived id of that decision
 *   not_recorded         no code writes a decision for this purpose anywhere, so
 *                        there is nothing to turn into a record
 *   recorded_in_database a decision exists for this purpose in the Convex table
 *                        consentRecords, for a person who signed in. This offline
 *                        generator reads only the local install.sh ledger and
 *                        cannot read that table, so this record is the shape and
 *                        not the decision. The export path is the caller's own
 *                        query, convex/consent.ts:myConsentRecords.
 *
 * `recorded_in_database` is this product's own value. TS 27560 names a record and
 * does not name the case of a decision that exists in a system the publisher of
 * the record cannot read, and reusing `recorded` here would tell a reader this
 * file holds a decision it does not hold.
 */

export interface ConsentEvent {
  /**
   * `consent_given`, `consent_refused`, or null.
   *
   * `consent_refused` is this product's own value. TS 27560 names `consent_given`
   * and `consent_withdrawn`; it names no event for a refusal at the point of the
   * question, and a refusal is evidence too, so it is recorded rather than
   * dropped. The naming is listed in `not_filled`.
   */
  type: string | null;
  time: string | null;
  manner: string | null;
  location: string | null;
  mechanism: string | null;
  /** explicit, implied, or null. DPDP s6(1) requires a clear affirmative action. */
  consent_type: "explicit" | "implied" | null;
  locale: string | null;
}

export interface ConsentRecord {
  schema_version: string;
  /** Content-derived, so the same decision always yields the same id. */
  record_id: string | null;
  record_id_method: string;
  /** Scoped to this record. The ledger holds no person identifier. */
  pii_principal_id: string | null;

  privacy_notice: {
    uri: string;
    version: string;
    wording_sha256: string | null;
  };
  language: string;
  /** One entry, because one purpose per record. */
  purposes: string[];
  purpose: {
    id: string;
    type: string;
    lawful_basis: string;
    lawful_basis_citation: string;
    description: string;
  };
  collection_method: string;
  processing_method: string;
  pii_information: Array<{ type: string; sensitive: boolean; source: string }>;
  pii_controllers: Array<{
    party_id: string;
    role: string;
    registered_name: string | null;
    contact: string;
    registration_unknown: boolean;
  }>;
  storage_locations: Array<{
    system: string;
    region: string;
    region_unknown: boolean;
    note: string;
  }>;
  retention_period: {
    window: string;
    /** The code that enforces it, or null. A null here is a gap, not a shorter window. */
    enforced_by: string | null;
    basis: string;
  };
  event: ConsentEvent;
  /** Whether a decision exists at all, and where it is kept. */
  status: ConsentRecordStatus;
  ledger: string | null;
  integrity: {
    algorithm: string;
    chain: string | null;
    prev_hash: string | null;
    record_hash: string | null;
  };
  extension: Record<string, string | string[] | null>;
  /** Every field this record cannot honestly fill, and why. */
  not_filled: NotFilled[];
}

export interface ConsentReceipt {
  receipt_version: string;
  /** The decision time, never the time this file was written. */
  issued_at: string | null;
  record_reference: {
    record_id: string | null;
    controller: string;
    controller_contact: string;
    dpo_contact: null;
    /** No route serves a record, so there is no lookup URL. */
    lookup: null;
    lookup_note: string;
  };
  what_you_agreed_to: {
    purpose: string;
    description: string;
    lawful_basis: string;
    lawful_basis_citation: string;
    notice_version: string;
    notice_wording_sha256: string | null;
  };
  /**
   * The exact lines that were on screen, or null when this build does not carry
   * the wording the decision names. The record keeps a hash; this keeps the text.
   */
  notice_wording: readonly string[] | null;
  /** Why the wording is not reproduced, when it is null. */
  notice_wording_note: string | null;
  categories_involved: string[];
  where_it_goes: Array<{ party: string; role: string; region: string; region_unknown: boolean }>;
  how_long: {
    consent_record: string;
    underlying_data: string;
    enforced_by: string | null;
  };
  your_rights_here: {
    /** No self-service withdrawal exists, so there is no URL. */
    withdraw: null;
    withdraw_note: string;
    ask_for_a_copy: string;
    ask_for_erasure: string;
    complain_to: string[];
  };
  status: ConsentRecordStatus;
  integrity: { algorithm: string; receipt_hash: string | null };
}

const BASIS = "GDPR Art 7(1) and Art 5(1)(e): the controller must be able to demonstrate the consent, and keep it no longer than needed.";

const PURPOSE_TYPE: Record<ConsentPurpose["id"], string> = {
  token: "account_authentication",
  read: "service_delivery_via_authenticated_third_party_api",
  explain: "service_delivery_via_third_party_ai",
  usage: "product_analytics_via_opt_in",
  files: "local_review_of_the_person's_own_checkout",
};

/** Manner, location, and mechanism, taken from how the code actually asks. */
const EVENT_DETAIL: Record<
  ConsentPurpose["id"],
  { manner: string; location: string; mechanism: string; consent_type: "explicit" | "implied" }
> = {
  token: {
    manner: "clickwrap",
    location: "the sign-in panel, the first purpose box",
    mechanism: "web_form",
    consent_type: "explicit",
  },
  read: {
    manner: "clickwrap",
    location: "the sign-in panel, the second purpose box",
    mechanism: "web_form",
    consent_type: "explicit",
  },
  explain: {
    manner: "clickwrap",
    location: "the sign-in panel, the third purpose box, and the Explain in plain words button",
    mechanism: "web_form",
    consent_type: "explicit",
  },
  usage: {
    manner: "clickwrap",
    location: "the local review installer, one question at the end of the run",
    mechanism: "terminal_prompt",
    consent_type: "explicit",
  },
  files: {
    manner: "notice_with_a_default",
    location: "the local review installer, before the expanded read",
    mechanism: "terminal_prompt",
    consent_type: "implied",
  },
};

/** Extra gap lines that only apply to some purposes or to some decisions. */
function purposeGaps(purpose: ConsentPurpose, decision: LedgerDecision | null): NotFilled[] {
  const gaps: NotFilled[] = [];
  if (decision === null) {
    // Two cases, two reasons, and the difference matters to whoever reads this.
    const inDatabase = purpose.recorded_in === "convex_database";
    gaps.push({
      field: "event.time",
      why: inDatabase
        ? `A decision about ${purpose.id} is recorded in the Convex table consentRecords for a person who signed in, together with the click time and the time this server wrote the row. This offline generator reads only ${CONSENT_LEDGER_PATH} and cannot read that table, so no decision time appears in this file. Read your own rows with the myConsentRecords query in convex/consent.ts.`
        : (purpose.not_recorded_reason ?? "no code writes this decision down"),
    });
    gaps.push({
      field: "record_id",
      why: inDatabase
        ? "A record id identifies a record. The record for this purpose is a row in consentRecords, which this file cannot read, so no id is minted here rather than one that identifies nothing."
        : "A record id identifies a record. No record exists for this purpose, so no id is minted.",
    });
    if (inDatabase) {
      gaps.push({
        field: "status",
        why: "The status reads recorded_in_database, which is this product's own value. TS 27560 names no status for a decision that exists in a system the publisher of this record cannot read, so the value is declared here rather than borrowed.",
      });
    }
    if (purpose.notice_wording_in_this_build === null) {
      gaps.push({
        field: "privacy_notice.wording_sha256",
        why: `The wording for notice version ${purpose.notice_version} is not carried by this build as text that can be hashed: the installer's lines live in this repository and the sign-in boxes live in a component. Nothing is hashed here rather than the installer's wording under the sign-in version.`,
      });
    }
  }
  if (purpose.retention.enforced_by === null) {
    gaps.push({
      field: "retention_period.enforced_by",
      why: `Nothing in this repository deletes or expires this data. The window reads: ${purpose.retention.window}`,
    });
  }
  if (decision !== null && !decision.granted) {
    gaps.push({
      field: "event.type",
      why: "TS 27560 names consent_given and consent_withdrawn. It names no event for a refusal at the point of the question, so this record uses this product's own value consent_refused rather than borrow one that means something else.",
    });
    gaps.push({
      field: "extension['dpv:consentStatus']",
      why: "The DPV v2 consent status term for a refusal was not verified in this lane, so none is written. Guessing a term that exists but means something else would be worse than writing none.",
    });
  }
  return gaps;
}

/** The DPV extension block, so a third party can read the record without us. */
function extensionFor(
  purpose: ConsentPurpose,
  decision: LedgerDecision | null,
): Record<string, string | string[] | null> {
  const given = decision?.granted === true;
  const withdrawn = decision?.granted === false;
  return {
    "dpv:purpose": "dpv:Purpose",
    "dpv:lawfulBasis": purpose.lawful_basis.startsWith("dpv:") ? purpose.lawful_basis : `dpv:${purpose.lawful_basis}`,
    // Only Given is asserted, and only for a granted answer. The other two states
    // stay null because no term for them was verified here.
    "dpv:consentStatus": given ? ["dpv:ConsentStatus:Given"] : null,
    "dpv:subject": "dpv:DataSubject",
    "dpv:controller": "dpv:DataController",
    "dpv:consentWithdrawn": withdrawn ? "yes, recorded as consent_refused" : null,
    "launchsense:noticeVersion": decision?.noticeVersion ?? purpose.notice_version,
    // Where a third party can read the decision when this file cannot show it.
    "launchsense:recordLocation": purpose.recorded_in ?? "nothing stores a decision for this purpose",
  };
}

/**
 * Whether this file can show the decision, and if not, why not.
 *
 * The status is a fact about this artefact rather than about the product. A
 * decision that exists only in the database is not `recorded` in a file that
 * cannot read it, and it is not `not_recorded` either, because it is recorded.
 */
function recordStatus(
  purpose: ConsentPurpose,
  decision: LedgerDecision | null,
): ConsentRecordStatus {
  if (decision !== null) return "recorded";
  if (purpose.recorded_in === "convex_database") return "recorded_in_database";
  return "not_recorded";
}

/** The shared shape both entry points use. */
function baseRecord(purpose: ConsentPurpose, decision: LedgerDecision | null): ConsentRecord {
  const detail = EVENT_DETAIL[purpose.id];
  return {
    schema_version: CONSENT_SCHEMA_VERSION,
    record_id: null,
    record_id_method: CONSENT_RECORD_ID_METHOD,
    pii_principal_id: null,
    privacy_notice: {
      uri: PRIVACY_NOTICE_URI,
      version: decision?.noticeVersion ?? purpose.notice_version,
      wording_sha256: null,
    },
    language: "en",
    purposes: [purpose.id],
    purpose: {
      id: purpose.id,
      type: PURPOSE_TYPE[purpose.id],
      lawful_basis: purpose.lawful_basis,
      lawful_basis_citation: purpose.lawful_basis_citation,
      description: purpose.description,
    },
    collection_method: purpose.collection_method,
    processing_method: purpose.processing_method,
    pii_information: purpose.pii_information.map((item) => ({
      type: item.type,
      sensitive: item.sensitive,
      source: item.source,
    })),
    pii_controllers: purpose.pii_controllers.map((party) => ({
      party_id: party.party_id,
      role: party.role,
      registered_name: party.registered_name,
      contact: party.contact,
      registration_unknown: party.registration_unknown,
    })),
    storage_locations: purpose.storage_locations.map((location) => ({ ...location })),
    retention_period: {
      window: purpose.retention.window,
      enforced_by: purpose.retention.enforced_by,
      basis: BASIS,
    },
    event: {
      type: decision === null ? null : decision.granted ? "consent_given" : "consent_refused",
      time: decision?.decidedAt ?? null,
      manner: detail.manner,
      location: detail.location,
      mechanism: detail.mechanism,
      consent_type: detail.consent_type,
      locale: "en-GB",
    },
    status: recordStatus(purpose, decision),
    ledger: purpose.ledger,
    integrity: {
      algorithm: "sha256",
      chain: "prev_line_hash",
      prev_hash: decision?.prevHash ?? null,
      record_hash: null,
    },
    extension: extensionFor(purpose, decision),
    not_filled: [],
  };
}

// The vocabulary gaps that apply to every record this product writes. All three
// fields are on every record, so none of these is listed against a field the record
// does not have, and the list stays checkable.
function globalGaps(): NotFilled[] {
  const carried = new Set<string>([
    "pii_controllers[].registered_name",
    "storage_locations[].region",
    "pii_principal_id",
  ]);
  return NOT_FILLED_FIELDS.filter((gap) => carried.has(gap.field));
}

/**
 * Build the record for a decision that exists on the ledger.
 *
 * Requires a purpose whose `recorded` is true, because a record for a purpose no
 * code writes down would be a record of a decision nobody made. The ledger this
 * generator reads holds the installer's question only, so today the caller is
 * always the usage purpose; the other three are read from the database instead,
 * through the caller's own query.
 */
export async function buildConsentRecord(
  decision: LedgerDecision,
  purposeId: ConsentPurpose["id"] = "usage",
): Promise<ConsentRecord> {
  const purpose = purposeById(purposeId);
  if (!purpose.recorded) {
    throw new Error(`purpose ${purposeId} has no decision on record, so it has no record`);
  }
  const record = baseRecord(purpose, decision);
  // The hash is taken only over the text this build actually carries, and only
  // when the ledger line names that same version. Hashing the current text under
  // an older version would tell a reader they agreed to words they never saw.
  const wording = purpose.notice_wording_in_this_build;
  const wordingMatchesVersion =
    wording !== null && decision.noticeVersion === purpose.notice_version;
  if (wordingMatchesVersion) {
    record.privacy_notice.wording_sha256 = await sha256Prefixed(wording.join("\n"));
  }
  record.integrity.record_hash = await sha256Prefixed(decision.line);
  record.record_id = await derivedUuid(purpose.id, decision.noticeVersion, decision.decidedAt);
  record.integrity.prev_hash = decision.prevHash;
  record.not_filled = [...globalGaps(), ...purposeGaps(purpose, decision)];
  if (!wordingMatchesVersion) {
    record.not_filled.push({
      field: "privacy_notice.wording_sha256",
      why:
        wording === null
          ? `This build carries no wording for notice version ${purpose.notice_version} as text that can be hashed, so no hash is written here.`
          : `The ledger line records wording version ${decision.noticeVersion}, and this build carries the text of ${purpose.notice_version} only. The hash is left empty rather than taken over words the person did not read.`,
    });
  }
  if (!decision.latest) {
    record.not_filled.push({
      field: "supersedes",
      why: "A later line in the ledger records a different answer to the same question. This line is kept as evidence and is not the current answer.",
    });
  }
  return record;
}

/**
 * Build the record shape for a purpose whose decision this file cannot read.
 *
 * Two reasons land here and they are not the same thing:
 *
 *   - the decision is in the Convex table consentRecords, for a person who signed
 *     in. This generator reads only the local ledger, so the shape is published
 *     with `status: recorded_in_database`, no id, and no event time, and the
 *     not_filled list says where the decision is and how to read it.
 *   - nothing writes a decision for the purpose at all, which is `not_recorded`.
 *
 * Publishing the shape either way is more useful than publishing nothing, because
 * a reader can see which fields a record built from the decision would carry.
 */
export async function buildConsentRecordTemplate(
  purposeId: ConsentPurpose["id"],
): Promise<ConsentRecord> {
  const purpose = purposeById(purposeId);
  const record = baseRecord(purpose, null);
  const wording = purpose.notice_wording_in_this_build;
  if (wording !== null) {
    record.privacy_notice.wording_sha256 = await sha256Prefixed(wording.join("\n"));
  }
  record.not_filled = [...globalGaps(), ...purposeGaps(purpose, null)];
  return record;
}

/** Every record this product can produce, for a set of ledger decisions. */
export async function buildConsentRecords(
  decisions: LedgerDecision[],
): Promise<ConsentRecord[]> {
  const records: ConsentRecord[] = [];
  for (const decision of decisions) records.push(await buildConsentRecord(decision, decision.purpose ?? "usage"));
  // A shape for every purpose the local ledger does not answer. Dropping those
  // shapes because a decision exists in the database would leave a reader of this
  // file with no mention of three of the four purposes.
  for (const purpose of CONSENT_PURPOSES) {
    if (purpose.recorded_in !== "local_ledger") records.push(await buildConsentRecordTemplate(purpose.id));
  }
  return records;
}

/** The receipt for one record. The copy the person keeps. */
export async function buildConsentReceipt(record: ConsentRecord): Promise<ConsentReceipt> {
  // The wording is reproduced only when this build carries the wording the record
  // names. The sign-in panel's text lives in a component, so a sign-in receipt
  // states the version and leaves the words out rather than printing the
  // installer's lines under a sign-in notice version.
  const purpose = purposeById(record.purpose.id as ConsentPurpose["id"]);
  const carried = purpose.notice_wording_in_this_build;
  const showsWording = carried !== null && record.privacy_notice.version === purpose.notice_version;
  const body: Omit<ConsentReceipt, "integrity"> = {
    receipt_version: CONSENT_RECEIPT_VERSION,
    issued_at: record.event.time,
    record_reference: {
      record_id: record.record_id,
      controller: CONTROLLER_PARTY.party_id,
      controller_contact: CONTROLLER_PARTY.contact,
      dpo_contact: null,
      lookup: null,
      lookup_note:
        "No route serves a consent record to anybody but the person it belongs to. The ledger is a file on your own machine, and the sign-in decisions are rows in the Convex table consentRecords that the myConsentRecords query returns to their owner only, so there is no lookup URL and a record id would tell a third party nothing.",
    },
    what_you_agreed_to: {
      purpose: record.purpose.id,
      description: record.purpose.description,
      lawful_basis: record.purpose.lawful_basis,
      lawful_basis_citation: record.purpose.lawful_basis_citation,
      notice_version: record.privacy_notice.version,
      notice_wording_sha256: record.privacy_notice.wording_sha256,
    },
    notice_wording: showsWording ? carried : null,
    notice_wording_note: showsWording
      ? null
      : carried === null
        ? `This build does not carry the wording for notice version ${record.privacy_notice.version} as text. The sign-in wording lives in shared/copy/signIn.ts and in the four purpose boxes in src/features/auth/AuthPanel.tsx, so no lines are reproduced here rather than showing you text this file does not hold.`
        : `This build carries the text of ${purpose.notice_version}, and this decision names ${record.privacy_notice.version}. The wording the person read is not reproduced here rather than showing them text they did not agree to.`,
    categories_involved: record.pii_information.map((item) => item.type),
    where_it_goes: record.pii_controllers.map((party) => ({
      party: party.party_id,
      role: party.role,
      region: "unknown",
      region_unknown: true,
    })),
    how_long: {
      consent_record: record.retention_period.window,
      underlying_data: record.retention_period.window,
      enforced_by: record.retention_period.enforced_by,
    },
    your_rights_here: {
      withdraw: null,
      withdraw_note:
        "There is no withdrawal button. Run LAUNCHSENSE_DIAGNOSTICS=off with install.sh, or set granted to false in ~/.config/launchsense/config.json. Both write a new line to the ledger rather than editing the old one.",
      ask_for_a_copy: "This receipt is the copy. www.withkeshav.com answers questions about it.",
      ask_for_erasure: "www.withkeshav.com",
      complain_to: [
        "In India, the Data Protection Board of India.",
        "In the European Union, the data protection authority where you live.",
      ],
    },
    status: record.status,
  };
  const hash = await sha256Hex(canonicalJson(body));
  return { ...body, integrity: { algorithm: "sha256", receipt_hash: hash === null ? null : `sha256:${hash}` } };
}

/**
 * The receipt as text a person can keep.
 *
 * Plain lines, no formatting to depend on, every number stated. It repeats the
 * wording that was on screen when this build carries it, and says so when it does
 * not, rather than pointing at a hash, because a hash proves two texts are the
 * same and does not tell a reader what they agreed to.
 */
export function renderConsentReceipt(receipt: ConsentReceipt): string {
  const lines: string[] = [];
  lines.push("LaunchSense consent receipt");
  lines.push(`Receipt version: ${receipt.receipt_version}`);
  lines.push(`Issued at: ${receipt.issued_at ?? "no decision is on record"}`);
  lines.push(`Record id: ${receipt.record_reference.record_id ?? "none, no record exists"}`);
  lines.push(`Status: ${receipt.status}`);
  if (receipt.status === "recorded_in_database") {
    lines.push(
      "  This file does not hold the decision. It is a row in the Convex table",
    );
    lines.push("  consentRecords, and the myConsentRecords query in convex/consent.ts");
    lines.push("  returns your own rows and nobody else's.");
  }
  lines.push("");
  lines.push("What you agreed to");
  lines.push(`  Purpose: ${receipt.what_you_agreed_to.purpose}`);
  lines.push(`  ${receipt.what_you_agreed_to.description}`);
  lines.push(`  Lawful basis: ${receipt.what_you_agreed_to.lawful_basis} (${receipt.what_you_agreed_to.lawful_basis_citation})`);
  lines.push(`  Notice version: ${receipt.what_you_agreed_to.notice_version}`);
  lines.push(`  Notice wording hash: ${receipt.what_you_agreed_to.notice_wording_sha256 ?? "not carried for this notice version"}`);
  lines.push("");
  lines.push("The wording you were shown");
  if (receipt.notice_wording === null) {
    lines.push(`  Not reproduced. ${receipt.notice_wording_note ?? ""}`);
  } else {
    for (const line of receipt.notice_wording) lines.push(`  ${line}`);
  }
  lines.push("");
  lines.push("Categories involved");
  for (const category of receipt.categories_involved) lines.push(`  ${category}`);
  lines.push("");
  lines.push("Where it goes");
  for (const party of receipt.where_it_goes) {
    lines.push(`  ${party.party}: ${party.role}, region ${party.region}`);
  }
  lines.push("");
  lines.push("How long");
  lines.push(`  ${receipt.how_long.consent_record}`);
  lines.push(`  Enforced by: ${receipt.how_long.enforced_by ?? "nothing in this repository enforces it"}`);
  lines.push("");
  lines.push("Your rights here");
  lines.push(`  Withdraw: ${receipt.your_rights_here.withdraw_note}`);
  lines.push(`  Ask for a copy: ${receipt.your_rights_here.ask_for_a_copy}`);
  lines.push(`  Ask for erasure: ${receipt.your_rights_here.ask_for_erasure}`);
  for (const authority of receipt.your_rights_here.complain_to) lines.push(`  Complain to: ${authority}`);
  lines.push("");
  lines.push(`Receipt hash: ${receipt.integrity.receipt_hash ?? "not computed on this runtime"}`);
  return lines.join("\n");
}