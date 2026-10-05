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
  CONSENT_PURPOSES,
  CONSENT_RECORD_ID_METHOD,
  CONSENT_SCHEMA_VERSION,
  CONTROLLER_PARTY,
  DIAGNOSTICS_NOTICE_VERSION,
  DIAGNOSTICS_NOTICE_WORDING,
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
  /** The exact ledger line, hashed as the record's own anchor. */
  line: string;
  /** Hash of the line before it, or null on the first line. */
  prevHash: string | null;
  /** True when no later line supersedes this one. */
  latest: boolean;
}

export type ConsentRecordStatus = "recorded" | "not_recorded";

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
};

/** Extra gap lines that only apply to some purposes or to some decisions. */
function purposeGaps(purpose: ConsentPurpose, decision: LedgerDecision | null): NotFilled[] {
  const gaps: NotFilled[] = [];
  if (!purpose.recorded) {
    gaps.push({
      field: "event.time",
      why: purpose.not_recorded_reason ?? "no code writes this decision down",
    });
    gaps.push({
      field: "record_id",
      why: "A record id identifies a record. No record exists for this purpose, so no id is minted.",
    });
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
    "launchsense:noticeVersion": decision?.noticeVersion ?? DIAGNOSTICS_NOTICE_VERSION,
  };
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
      version: decision?.noticeVersion ?? DIAGNOSTICS_NOTICE_VERSION,
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
    status: purpose.recorded && decision !== null ? "recorded" : "not_recorded",
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
 * code writes down would be a record of a decision nobody made.
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
  const wordingMatchesVersion = decision.noticeVersion === DIAGNOSTICS_NOTICE_VERSION;
  if (wordingMatchesVersion) {
    record.privacy_notice.wording_sha256 = await sha256Prefixed(DIAGNOSTICS_NOTICE_WORDING.join("\n"));
  }
  record.integrity.record_hash = await sha256Prefixed(decision.line);
  record.record_id = await derivedUuid(purpose.id, decision.noticeVersion, decision.decidedAt);
  record.integrity.prev_hash = decision.prevHash;
  record.not_filled = [...globalGaps(), ...purposeGaps(purpose, decision)];
  if (!wordingMatchesVersion) {
    record.not_filled.push({
      field: "privacy_notice.wording_sha256",
      why: `The ledger line records wording version ${decision.noticeVersion}, and this build carries the text of ${DIAGNOSTICS_NOTICE_VERSION} only. The hash is left empty rather than taken over words the person did not read.`,
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
 * Build the record shape for a purpose that is asked about and written down
 * nowhere.
 *
 * This is the honest half of the lane. The sign-in panel asks four questions and
 * keeps none of the answers, so a record for those purposes has no id, no time,
 * and a `status` of not_recorded. Publishing the shape is more useful than
 * publishing nothing, because a reader can see exactly which fields a built
 * system would have to add.
 */
export async function buildConsentRecordTemplate(
  purposeId: ConsentPurpose["id"],
): Promise<ConsentRecord> {
  const purpose = purposeById(purposeId);
  const record = baseRecord(purpose, null);
  record.privacy_notice.wording_sha256 = await sha256Prefixed(DIAGNOSTICS_NOTICE_WORDING.join("\n"));
  record.not_filled = [...globalGaps(), ...purposeGaps(purpose, null)];
  if (purpose.recorded) {
    record.not_filled.push({
      field: "event.time",
      why: "This purpose is recorded, but no ledger line was passed to the builder. A record needs the decision it documents.",
    });
  }
  return record;
}

/** Every record this product can produce, for a set of ledger decisions. */
export async function buildConsentRecords(
  decisions: LedgerDecision[],
): Promise<ConsentRecord[]> {
  const records: ConsentRecord[] = [];
  for (const decision of decisions) records.push(await buildConsentRecord(decision));
  for (const purpose of CONSENT_PURPOSES) {
    if (!purpose.recorded) records.push(await buildConsentRecordTemplate(purpose.id));
  }
  return records;
}

/** The receipt for one record. The copy the person keeps. */
export async function buildConsentReceipt(record: ConsentRecord): Promise<ConsentReceipt> {
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
        "No route serves a consent record. The ledger is a file on your own machine and this repository publishes no lookup URL, so the record is checked by hash against the ledger instead.",
    },
    what_you_agreed_to: {
      purpose: record.purpose.id,
      description: record.purpose.description,
      lawful_basis: record.purpose.lawful_basis,
      lawful_basis_citation: record.purpose.lawful_basis_citation,
      notice_version: record.privacy_notice.version,
      notice_wording_sha256: record.privacy_notice.wording_sha256,
    },
    notice_wording: record.privacy_notice.wording_sha256 === null ? null : DIAGNOSTICS_NOTICE_WORDING,
    notice_wording_note:
      record.privacy_notice.wording_sha256 === null
        ? `This build carries the text of ${DIAGNOSTICS_NOTICE_VERSION}, and this decision names ${record.privacy_notice.version}. The wording the person read is not reproduced here rather than showing them text they did not agree to.`
        : null,
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
 * wording that was on screen rather than pointing at a hash, because a hash
 * proves two texts are the same and does not tell a reader what they agreed to.
 */
export function renderConsentReceipt(receipt: ConsentReceipt): string {
  const lines: string[] = [];
  lines.push("LaunchSense consent receipt");
  lines.push(`Receipt version: ${receipt.receipt_version}`);
  lines.push(`Issued at: ${receipt.issued_at ?? "no decision is on record"}`);
  lines.push(`Record id: ${receipt.record_reference.record_id ?? "none, no record exists"}`);
  lines.push(`Status: ${receipt.status}`);
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