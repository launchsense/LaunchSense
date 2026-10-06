import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, derivedUuid, sha256Hex } from "../shared/consent/digest.ts";
import {
  buildConsentRecord,
  buildConsentRecordTemplate,
  buildConsentReceipt,
  buildConsentRecords,
  renderConsentReceipt,
} from "../shared/consent/record.ts";
import {
  CONSENT_PURPOSES,
  DIAGNOSTICS_NOTICE_VERSION,
  DIAGNOSTICS_NOTICE_WORDING,
  NOT_FILLED_FIELDS,
  SIGN_IN_PURPOSE_IDS,
} from "../shared/consent/vocabulary.ts";
import { PROCESSING_ACTIVITIES, renderProcessingRegister } from "../shared/consent/register.ts";
import {
  AI_ASSISTED_TASKS,
  AI_DISCLOSURE_CITATION,
  AI_DISCLOSURE_SHORT,
  AI_DISCLOSURE_WITH_LEVEL,
  AI_NEVER_DECIDES,
  HUMAN_OVERSIGHT_LEVELS,
  anyFullyAutonomousPath,
  oversightLevelFor,
} from "../shared/copy/aiDisclosure.ts";

// Wave 8, the consent and standards lane.
//
// The claim being tested is narrow and worth stating: a document that another
// person's tooling reads is only worth emitting if it says what the code does.
// So every rule below points at a file in this repository. A field with nothing
// behind it is either removed or named in a not_filled list, and a name that
// does not exist fails here rather than in a compliance review.
//
// The fixtures are written out in full, so a rule cannot pass by matching
// nothing: a real ledger with a granted decision and a later refusal, and a real
// lockfile with every licence shape the inventory can produce.

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

function read(...parts) {
  const full = join(repo, ...parts);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
}

/** Prose is reflowed by the formatter, so sentence checks read a flattened copy. */
function flat(source) {
  return source.replace(/\s+/g, " ");
}

const installScript = read("install.sh");
const authPanel = read("src", "features", "auth", "AuthPanel.tsx");
const privacyDoc = read("docs", "PRIVACY.md");
const privacyPage = read("src", "pages", "Privacy.tsx");
const connectPage = read("src", "pages", "Connect.tsx");
const limitsDoc = read("docs", "LIMITS.md");
const howItWorks = read("docs", "HOW-IT-WORKS.md");
const readYourReport = read("docs", "READ-YOUR-REPORT.md");
const skill = read("skills", "launchsense", "SKILL.md");
const llms = read("llms.txt");
const schema = read("convex", "schema.ts");

/** A ledger with the two shapes a real one has: a grant, then a later refusal. */
const LEDGER_LINES = [
  {
    noticeVersion: DIAGNOSTICS_NOTICE_VERSION,
    granted: true,
    decidedAt: "2026-10-06T09:14:02Z",
    source: "prompt",
    line: '{"noticeVersion":"2026-10-05","granted":true,"decidedAt":"2026-10-06T09:14:02Z","source":"prompt"}',
    prevHash: null,
    latest: false,
  },
  {
    noticeVersion: DIAGNOSTICS_NOTICE_VERSION,
    granted: false,
    decidedAt: "2026-10-06T11:02:44Z",
    source: "LAUNCHSENSE_DIAGNOSTICS=off",
    line:
      '{"noticeVersion":"2026-10-05","granted":false,"decidedAt":"2026-10-06T11:02:44Z","source":"LAUNCHSENSE_DIAGNOSTICS=off"}',
    prevHash: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    latest: true,
  },
];

const granted = LEDGER_LINES[0];
const refused = LEDGER_LINES[1];

/** The schema block for one table, so a column claim can be checked against it. */
function tableBlock(name) {
  const start = schema.search(new RegExp(`^  ${name}: defineTable\\(\\{`, "m"));
  if (start < 0) return null;
  const end = schema.indexOf("\n  })", start);
  return end < 0 ? null : schema.slice(start, end);
}

/** Every export named by a file:identifier string, checked against the disk. */
function fileExists(reference) {
  const file = reference.split(":")[0];
  return existsSync(join(repo, file));
}

describe("a consent record carries the fields ISO/IEC TS 27560:2023 names", () => {
  it("carries every Table 1 and Table 2 field the code can honestly fill", async () => {
    const record = await buildConsentRecord(granted);
    // Table 1, record header. All three are Required in the standard.
    for (const field of ["schema_version", "record_id", "pii_principal_id"]) {
      assert.ok(field in record, `Table 1 requires ${field}`);
    }
    // Table 2, PII processing. The four Required there, plus the two Optional the
    // product has a value for.
    for (const field of [
      "privacy_notice",
      "language",
      "purposes",
      "purpose",
      "lawful_basis",
      "pii_information",
      "pii_controllers",
      "collection_method",
      "processing_method",
      "storage_locations",
      "retention_period",
    ]) {
      const present =
        field === "lawful_basis" ? "lawful_basis" in record.purpose : field in record;
      assert.ok(present, `Table 2 names ${field}`);
    }
    // The event, which the standard puts in its own section.
    for (const field of ["type", "time", "manner", "location", "mechanism", "consent_type"]) {
      assert.ok(field in record.event, `the event names ${field}`);
    }
    assert.ok("algorithm" in record.integrity, "Annex E integrity names an algorithm");
  });

  it("keeps one purpose per record, so the event cannot apply to two purposes", async () => {
    const record = await buildConsentRecord(granted);
    assert.deepEqual(record.purposes, ["usage"]);
    assert.equal(record.purposes.length, 1);
  });

  it("names the fields it cannot fill, and never lists a field as both filled and missing", async () => {
    const record = await buildConsentRecord(granted);
    assert.ok(record.not_filled.length > 0, "a record with gaps must say so");
    const fields = record.not_filled.map((gap) => gap.field);
    assert.equal(new Set(fields).size, fields.length, "no gap is listed twice");
    for (const gap of record.not_filled) {
      assert.ok(gap.why.length > 20, `${gap.field} must say why it is absent, not just that it is`);
    }
    // A field cannot be absent and present. These two are the ones a reader would
    // look for, and one is filled while the other is named.
    assert.ok(
      fields.includes("storage_locations[].region"),
      "every region is unknown, so the gap must be named",
    );
    for (const location of record.storage_locations) {
      assert.equal(location.region, "unknown", "a region is never invented");
      assert.equal(location.region_unknown, true, "and it says that it is unknown");
    }
  });

  it("carries a notice reference, a version, and the hash of the exact wording", async () => {
    const record = await buildConsentRecord(granted);
    assert.match(record.privacy_notice.uri, /^https:\/\//, "the notice is cited by reference");
    assert.equal(record.privacy_notice.version, DIAGNOSTICS_NOTICE_VERSION);
    const expected = `sha256:${createHash("sha256")
      .update(DIAGNOSTICS_NOTICE_WORDING.join("\n"))
      .digest("hex")}`;
    assert.equal(
      record.privacy_notice.wording_sha256,
      expected,
      "the hash must be SHA-256 over the lines the person actually read",
    );
  });

  it("holds the wording install.sh prints, so the two cannot drift apart", () => {
    // The notice text lives in the vocabulary and the installer prints it. A change
    // to one without the other would make the receipt describe wording nobody saw.
    const printed = [...installScript.matchAll(/printf '%s\\n' "([^"]+)"/g)].map((m) => m[1]);
    for (const line of DIAGNOSTICS_NOTICE_WORDING) {
      assert.ok(printed.includes(line), `install.sh no longer prints: ${line}`);
    }
    assert.match(installScript, new RegExp(`NOTICE_VERSION=${DIAGNOSTICS_NOTICE_VERSION}\\b`));
    assert.match(
      installScript,
      /CONSENT_LOG="\$CONFIG_DIR\/consent\.jsonl"/,
      "the ledger path the vocabulary names is the path the installer writes",
    );
  });

  it("records a refusal as evidence, and names consent_refused as this product's own value", async () => {
    const record = await buildConsentRecord(refused);
    assert.equal(record.event.type, "consent_refused");
    assert.equal(record.status, "recorded", "a refusal is still a record");
    assert.equal(record.event.time, refused.decidedAt, "the time the answer was given");
    const gaps = record.not_filled.map((gap) => gap.field);
    assert.ok(
      gaps.includes("event.type"),
      "TS 27560 names no event for a refusal, so the naming must be declared",
    );
    assert.ok(
      gaps.includes("extension['dpv:consentStatus']"),
      "no DPV term was verified for a refusal, so none may be written",
    );
    assert.equal(record.extension["dpv:consentStatus"], null, "and none is written");
  });

  it("writes a DPV consent status only for a granted answer", async () => {
    const given = await buildConsentRecord(granted);
    assert.deepEqual(given.extension["dpv:consentStatus"], ["dpv:ConsentStatus:Given"]);
    assert.equal(given.purpose.lawful_basis, "dpv:Consent");
    assert.match(given.purpose.lawful_basis_citation, /Art 6\(1\)\(a\)/);
  });

  it("keeps an earlier answer as evidence and says it is not the current one", async () => {
    const record = await buildConsentRecord(granted);
    assert.equal(record.latest, undefined);
    assert.ok(
      record.not_filled.some((gap) => gap.field === "supersedes"),
      "a superseded line is kept and marked as superseded",
    );
  });

  it("mints no record id for a purpose whose decision this file cannot read", async () => {
    // The explain decision exists, in the Convex table consentRecords. This
    // generator cannot read that table, so its record is a shape: no id, no event
    // time, and a status that says why rather than claiming nothing was recorded.
    const record = await buildConsentRecordTemplate("explain");
    assert.equal(record.record_id, null, "no id is minted from a decision this file does not have");
    assert.equal(record.event.time, null);
    assert.equal(record.status, "recorded_in_database");
    assert.ok(
      record.not_filled.some((gap) => gap.field === "record_id"),
      "and the missing id is named",
    );
    const named = record.not_filled.map((gap) => gap.why).join(" ");
    assert.match(named, /consentRecords/, "the gap must name the table the decision is in");
    assert.match(named, /myConsentRecords/, "and the query that returns it");
  });

  it("names the four purposes the sign-in panel asks about, with the same labels", () => {
    // The panel is the surface a person reads. If a purpose is renamed in one place
    // and not the other, the record describes a question nobody was asked. The
    // local file read is a fifth purpose but it is not asked on this panel.
    const panelIds = [...authPanel.matchAll(/^ {4}id: "([a-z]+)",$/gm)].map((m) => m[1]);
    assert.deepEqual(
      [...SIGN_IN_PURPOSE_IDS],
      panelIds,
      "the consent vocabulary and the sign-in boxes must ask about the same things in the same order",
    );
    for (const id of SIGN_IN_PURPOSE_IDS) {
      const purpose = CONSENT_PURPOSES.find((item) => item.id === id);
      assert.ok(purpose, `${id} must exist in the vocabulary`);
      assert.ok(
        authPanel.includes(purpose.label),
        `the sign-in panel no longer says: ${purpose.label}`,
      );
    }
  });

  it("says where each of the four purposes is recorded, in the ledger or the database", () => {
    // All four are recorded now: usage in the install.sh ledger, the other three in
    // the Convex table consentRecords. Which one is which has to be stated, because
    // the offline generator can only ever print the first kind.
    for (const purpose of CONSENT_PURPOSES) {
      assert.equal(purpose.recorded, true, `${purpose.id} has a decision on record somewhere`);
      assert.equal(purpose.not_recorded_reason, null, `${purpose.id} is recorded, so no gap is claimed`);
      assert.notEqual(purpose.ledger, null, `${purpose.id} must name where its decision lands`);
    }
    const inLedger = CONSENT_PURPOSES.filter((purpose) => purpose.recorded_in === "local_ledger");
    assert.deepEqual(
      inLedger.map((purpose) => purpose.id).sort(),
      ["files", "usage"],
      "the installer questions are the ones the offline generator can read",
    );
    const inDatabase = CONSENT_PURPOSES.filter((purpose) => purpose.recorded_in === "convex_database");
    assert.deepEqual(
      inDatabase.map((purpose) => purpose.id),
      ["token", "read", "explain"],
      "the three sign-in purposes are recorded in the database",
    );
    for (const purpose of inDatabase) {
      assert.match(purpose.ledger, /consentRecords/, `${purpose.id} must name the table it is in`);
    }
    // The shape of a not-recorded purpose is still possible and still checked, so a
    // fifth purpose added without a record would fail here rather than pass silently.
    for (const purpose of CONSENT_PURPOSES.filter((item) => !item.recorded)) {
      assert.ok(purpose.not_recorded_reason, `${purpose.id} must say why nothing records it`);
      assert.match(purpose.not_recorded_reason, /no code writes|recorded nowhere|nothing writes/i);
    }
  });

  it("gives every purpose a lawful basis with the article it stands for", () => {
    for (const purpose of CONSENT_PURPOSES) {
      assert.match(purpose.lawful_basis, /^dpv:/, `${purpose.id} needs a DPV term`);
      assert.match(purpose.lawful_basis_citation, /GDPR Art 6\(1\)\([a-f]\)/);
    }
    // Contract for what the person asked for, consent for what they can decline.
    assert.equal(CONSENT_PURPOSES.find((p) => p.id === "read").lawful_basis, "dpv:Contract");
    assert.equal(CONSENT_PURPOSES.find((p) => p.id === "explain").lawful_basis, "dpv:Consent");
  });

  it("records the principal as unidentified, because nothing identifies them", async () => {
    const record = await buildConsentRecord(granted);
    assert.equal(
      record.pii_principal_id,
      null,
      "the ledger holds no person identifier, so the field is empty rather than borrowed",
    );
    assert.ok(NOT_FILLED_FIELDS.some((gap) => gap.field === "pii_principal_id"));
  });

  it("computes a real SHA-256 and a well-formed content-derived UUID", async () => {
    const hex = await sha256Hex("launchsense");
    assert.equal(hex, createHash("sha256").update("launchsense").digest("hex"));
    const id = await derivedUuid("usage", "2026-10-05", "2026-10-06T09:14:02Z");
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal(id[14], "8", "version nibble 8 states a custom derivation, not a v4 or a v5");
    const again = await derivedUuid("usage", "2026-10-05", "2026-10-06T09:14:02Z");
    const other = await derivedUuid("usage", "2026-10-05", "2026-10-06T09:14:03Z");
    assert.equal(id, again, "the same decision gives the same id");
    assert.notEqual(id, other, "a different time gives a different id");
  });

  it("hashes the ledger line and walks the chain to the line before it", async () => {
    const first = await buildConsentRecord(granted);
    const second = await buildConsentRecord(refused);
    assert.equal(
      first.integrity.record_hash,
      `sha256:${createHash("sha256").update(granted.line).digest("hex")}`,
      "the record hash is the hash of the line the decision sits on",
    );
    assert.equal(first.integrity.prev_hash, null, "the first line has nothing before it");
    assert.equal(second.integrity.prev_hash, refused.prevHash, "and the next line points back at it");
    assert.equal(first.integrity.chain, "prev_line_hash");
  });

  it("hashes canonical JSON, so key order cannot move a digest", () => {
    assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
    assert.notEqual(canonicalJson({ a: 1 }), canonicalJson({ a: 2 }));
    assert.equal(canonicalJson({ a: 1, b: undefined }), '{"a":1}', "an absent field is absent");
    assert.equal(canonicalJson([{ b: 1, a: 2 }]), '[{"a":2,"b":1}]');
  });
});

describe("the receipt is a stable copy the person can keep", () => {
  it("is deterministic, so the same decision gives the same bytes", async () => {
    const record = await buildConsentRecord(granted);
    const first = await buildConsentReceipt(record);
    const second = await buildConsentReceipt(await buildConsentRecord(granted));
    assert.equal(renderConsentReceipt(first), renderConsentReceipt(second));
    assert.equal(JSON.stringify(first), JSON.stringify(second));
    assert.equal(first.integrity.receipt_hash, second.integrity.receipt_hash);
  });

  it("states the agreed wording version and the hash of that wording", async () => {
    const receipt = await buildConsentReceipt(await buildConsentRecord(granted));
    assert.equal(receipt.what_you_agreed_to.notice_version, DIAGNOSTICS_NOTICE_VERSION);
    assert.match(receipt.what_you_agreed_to.notice_wording_sha256, /^sha256:[0-9a-f]{64}$/);
    const text = renderConsentReceipt(receipt);
    assert.ok(text.includes(`Notice version: ${DIAGNOSTICS_NOTICE_VERSION}`));
    assert.ok(text.includes(`Notice wording hash: sha256:`));
  });

  it("prints the wording itself, because a hash does not tell a reader what they agreed to", async () => {
    const receipt = await buildConsentReceipt(await buildConsentRecord(granted));
    assert.deepEqual([...receipt.notice_wording], [...DIAGNOSTICS_NOTICE_WORDING]);
    const text = renderConsentReceipt(receipt);
    for (const line of DIAGNOSTICS_NOTICE_WORDING) {
      assert.ok(text.includes(line), `the receipt must repeat the line: ${line}`);
    }
  });

  it("uses the decision time, so re-running the generator does not move the receipt", async () => {
    const receipt = await buildConsentReceipt(await buildConsentRecord(granted));
    assert.equal(receipt.issued_at, granted.decidedAt);
    assert.ok(
      !flat(renderConsentReceipt(receipt)).includes(new Date().getUTCFullYear() + "-" + "placeholder"),
      "no sentinel year may leak into the receipt",
    );
  });

  it("names the rights, and says plainly that there is no withdrawal button", async () => {
    const receipt = await buildConsentReceipt(await buildConsentRecord(granted));
    assert.equal(receipt.your_rights_here.withdraw, null, "there is no route to point at");
    assert.match(receipt.your_rights_here.withdraw_note, /no withdrawal button/i);
    assert.match(receipt.your_rights_here.withdraw_note, /LAUNCHSENSE_DIAGNOSTICS=off/);
    assert.ok(receipt.your_rights_here.complain_to.length > 0);
    assert.equal(receipt.record_reference.dpo_contact, null, "no data protection officer exists");
    assert.equal(receipt.record_reference.lookup, null, "no route serves a consent record");
    assert.match(receipt.record_reference.lookup_note, /no route serves/i);
  });

  it("changes its hash when one fact changes, so the copy is checkable", async () => {
    const grantedReceipt = await buildConsentReceipt(await buildConsentRecord(granted));
    const refusedReceipt = await buildConsentReceipt(await buildConsentRecord(refused));
    assert.notEqual(
      grantedReceipt.integrity.receipt_hash,
      refusedReceipt.integrity.receipt_hash,
      "a different answer must produce a different receipt hash",
    );
  });

  it("builds the whole set: every ledger line, then a shape for every purpose the ledger cannot answer", async () => {
    const records = await buildConsentRecords([granted, refused]);
    const shapes = CONSENT_PURPOSES.filter((purpose) => purpose.recorded_in !== "local_ledger");
    assert.equal(records.length, 2 + shapes.length);
    assert.equal(records.filter((record) => record.status === "recorded").length, 2);
    // The sign-in purposes are not dropped from the file because their decision
    // lives in a database this generator cannot read.
    for (const purpose of shapes) {
      const record = records.find((item) => item.purpose.id === purpose.id);
      assert.ok(record, `${purpose.id} must appear in the generated set`);
      assert.equal(record.status, "recorded_in_database");
    }
  });
});

describe("the Article 30 register is generated from the data inventory in the repo", () => {
  it("is deterministic, so a committed copy either matches the code or shows a real change", () => {
    assert.equal(renderProcessingRegister(), renderProcessingRegister());
    assert.ok(renderProcessingRegister().length > 4000, "a register this short cannot hold eight activities");
  });

  it("is committed, and the committed copy is what the generator writes today", () => {
    // Without this the document rots silently, and a stale register is worse than
    // none: it is the artefact someone hands to a regulator.
    const committed = read("docs", "PROCESSING-REGISTER.md");
    assert.ok(committed.length > 4000, "docs/PROCESSING-REGISTER.md must be committed");
    assert.equal(
      committed,
      renderProcessingRegister(),
      "docs/PROCESSING-REGISTER.md has drifted. Run: npm run register -- --out docs/PROCESSING-REGISTER.md",
    );
  });

  it("names only tables that exist in convex/schema.ts", () => {
    for (const activity of PROCESSING_ACTIVITIES) {
      for (const store of activity.storage) {
        if (!store.is_table) continue;
        assert.ok(
          tableBlock(store.location) !== null,
          `${activity.id} names table ${store.location}, which is not in the schema`,
        );
      }
    }
  });

  it("names only columns that exist on those tables", () => {
    let checked = 0;
    for (const activity of PROCESSING_ACTIVITIES) {
      for (const point of activity.data_points) {
        const [table, ...rest] = point.split(".");
        const column = rest.join(".");
        const block = tableBlock(table);
        assert.ok(block !== null, `${activity.id} names ${point}, and table ${table} is not in the schema`);
        // A field is either `name:` or the shorthand `name,` when it reuses a validator.
        assert.match(
          block,
          new RegExp(`^\\s+${column}\\s*[:,]`, "m"),
          `${activity.id} claims column ${point}, which the schema does not declare`,
        );
        checked += 1;
      }
    }
    assert.ok(checked > 60, `only ${checked} columns were checked, which cannot cover the schema`);
  });

  it("ties every window that claims a purge to a purge that exists in the code", () => {
    const convexSource = read("convex", "scans", "store.ts") + read("convex", "analytics", "retention.ts");
    let purged = 0;
    for (const activity of PROCESSING_ACTIVITIES) {
      for (const line of activity.retention) {
        if (line.enforcement !== "purge") continue;
        purged += 1;
        // A claim of a purge has to name a deletion path or a TTL constant.
        assert.match(
          line.enforced_by,
          /delete|purge|sweep|TTL/i,
          `${activity.id} / ${line.data} claims a purge and names neither a delete nor a constant`,
        );
        // Every file:identifier reference in the line must exist on disk.
        for (const reference of line.enforced_by.split(/\s+/)) {
          const cleaned = reference.replace(/[.,)]/g, "");
          if (cleaned.includes("/") && cleaned.includes(".")) {
            assert.ok(
              fileExists(cleaned.split(":")[0]),
              `${activity.id} names a file that is not there: ${cleaned}`,
            );
          }
        }
      }
    }
    assert.equal(purged, 2, "two windows in this build delete rows, and no third one does");
    // The two windows the copy names as deleted really do delete.
    assert.match(convexSource, /db\.delete\("fileContents"/, "the 24 hour window needs a real delete");
    assert.match(convexSource, /db\.delete\("usageEvents"/, "the 30 day window needs a real delete");
  });

  it("separates a read window from a purge, because only one of them deletes", () => {
    const readWindows = PROCESSING_ACTIVITIES.flatMap((activity) => activity.retention).filter(
      (line) => line.enforcement === "read_window",
    );
    assert.equal(readWindows.length, 1, "one window stops being read rather than being deleted");
    for (const line of readWindows) {
      assert.match(
        line.enforced_by,
        /not a deletion/i,
        "a read window must say that it deletes nothing",
      );
      assert.match(line.data, /osvCache/);
    }
    // The OSV answer cache is never deleted, so no purge may be implied for it.
    assert.doesNotMatch(
      read("convex", "scans", "store.ts") + read("convex", "scans", "analyze.ts"),
      /delete\("osvCache"/,
      "nothing deletes the OSV cache, so the register may not imply one does",
    );
  });

  it("says a window has no purge when nothing in the code purges that data", () => {
    for (const activity of PROCESSING_ACTIVITIES) {
      for (const line of activity.retention) {
        if (line.enforcement !== "none") continue;
        assert.equal(
          line.enforced_by,
          null,
          `${activity.id} / ${line.data} has nothing behind it, so it must not name an enforcer`,
        );
        // A window with nothing enforcing it may still say what we do not know, but
        // it must not state a duration, because a duration reads as a promise.
        assert.doesNotMatch(
          line.window,
          /\b\d+\s*(hour|day|week|month|year)s?\b/i,
          `${activity.id} / ${line.data} states a duration with no purge behind it`,
        );
      }
    }
    assert.match(
      read("convex", "scans", "store.ts"),
      /"findings"|"evidenceItems"/,
      "the findings tables exist, so saying they are never purged is a real statement",
    );
  });

  it("invents no legal entity, and says so in the controller block", () => {
    const text = renderProcessingRegister();
    assert.match(text, /- Name: not published/);
    assert.match(text, /Data protection officer: none appointed/);
    for (const suffix of ["Ltd", "Limited", "Inc\\.", "GmbH", "LLP", "Pte"]) {
      assert.doesNotMatch(text, new RegExp(suffix), `the register names a legal entity: ${suffix}`);
    }
  });

  it("states the exemption analysis with its reason, and the processor register's absence", () => {
    const text = renderProcessingRegister();
    assert.match(text, /GDPR Art 30\(5\)/);
    assert.match(text, /- Exemption available: no/);
    assert.match(text, /Art 30\(2\) names four items for a processor/);
    assert.match(text, /no lawyer has reviewed it/i, "the reading must be marked unreviewed");
  });

  it("refuses to name a region nobody confirmed", () => {
    for (const activity of PROCESSING_ACTIVITIES) {
      for (const transfer of activity.third_country_transfers) {
        assert.equal(transfer.known, false);
        assert.equal(transfer.destination, "unknown");
        assert.ok(transfer.safeguard.length > 20, "an unknown destination still needs its reason");
      }
      for (const recipient of activity.recipients) {
        assert.equal(recipient.region, "unknown");
        assert.equal(recipient.region_unknown, true);
      }
    }
  });

  it("links every activity that has a consent purpose to a real one", () => {
    const ids = new Set(CONSENT_PURPOSES.map((purpose) => purpose.id));
    let linked = 0;
    for (const activity of PROCESSING_ACTIVITIES) {
      if (activity.consent_purpose === null) continue;
      assert.ok(ids.has(activity.consent_purpose), `${activity.id} names an unknown purpose`);
      linked += 1;
    }
    assert.ok(linked >= 4, `only ${linked} activities name a consent purpose`);
  });

  it("names a file for every AI task the register claims a model touched", () => {
    for (const activity of PROCESSING_ACTIVITIES) {
      if (!/\bAI\b|model/i.test(activity.purpose)) continue;
      assert.match(
        activity.automated_decision_making,
        /cannot add, drop, re-rank, or re-score/i,
        `${activity.id} must say what the model is not allowed to change`,
      );
    }
  });
});

describe("the AI disclosure states the C2PA human oversight level and what AI never decides", () => {
  it("uses the three values the C2PA specification names, verbatim", () => {
    assert.deepEqual(
      HUMAN_OVERSIGHT_LEVELS.map((level) => level.value),
      ["fully_autonomous", "prompt_guided", "human_validated"],
    );
    assert.match(
      HUMAN_OVERSIGHT_LEVELS[0].means,
      /No human review after model output/,
      "the C2PA definition of fully_autonomous",
    );
    assert.match(HUMAN_OVERSIGHT_LEVELS[2].means, /reviewed and approved/i);
  });

  it("says this product never reaches the highest-scrutiny value, and why", () => {
    assert.equal(anyFullyAutonomousPath(), false);
    const autonomous = HUMAN_OVERSIGHT_LEVELS.find((level) => level.value === "fully_autonomous");
    assert.ok(autonomous.why.length > 20, "an unused value still needs its reason");
    for (const task of AI_ASSISTED_TASKS) {
      assert.equal(task.oversight_level, "prompt_guided", `${task.id} is prompt guided`);
      assert.equal(oversightLevelFor(task.id), "prompt_guided");
      assert.ok(task.needs_configuration, `${task.id} cannot run with no provider configured`);
    }
  });

  it("names the six things no model decides, each with a file that proves it", () => {
    const items = AI_NEVER_DECIDES.map((entry) => entry.item);
    assert.deepEqual(items, [
      "Whether something is a finding",
      "How severe a finding is",
      "A licence fact",
      "Consent",
      "Who a caller is",
      "Whether a request is allowed",
    ]);
    for (const entry of AI_NEVER_DECIDES) {
      assert.ok(entry.why.length > 30, `${entry.item} needs a reason, not a refusal`);
      const files = [...entry.where, ...AI_ASSISTED_TASKS.flatMap((task) => task.where)];
      for (const file of files) {
        assert.ok(fileExists(file), `${entry.item} names a file that is not there: ${file}`);
      }
    }
  });

  it("says AI never decides the six things in the shared sentence", () => {
    for (const sentence of [
      "never decides a finding",
      "a severity",
      "a licence fact",
      "consent",
      "who a caller is",
      "whether a request is allowed",
    ]) {
      assert.ok(AI_DISCLOSURE_SHORT.includes(sentence), `the shared sentence lost: ${sentence}`);
    }
    assert.match(AI_DISCLOSURE_WITH_LEVEL, /prompt_guided/);
    assert.match(AI_DISCLOSURE_CITATION, /borrowed|borrow/i);
    assert.match(AI_DISCLOSURE_CITATION, /not a conformance claim/i);
    assert.match(AI_DISCLOSURE_CITATION, /C2PA Technical Specification 2\.4/);
  });

  it("carries the C2PA term on the surfaces that talk about the AI roles", () => {
    const surfaces = [
      ["docs/PRIVACY.md", privacyDoc],
      ["Connect", connectPage],
      ["docs/LIMITS.md", limitsDoc],
      ["docs/HOW-IT-WORKS.md", howItWorks],
      ["docs/READ-YOUR-REPORT.md", readYourReport],
      ["skills/launchsense/SKILL.md", skill],
      ["llms.txt", llms],
      ["README.md", read("README.md")],
      ["docs/PRODUCT.md", read("docs", "PRODUCT.md")],
    ];
    for (const [name, source] of surfaces) {
      assert.match(
        source,
        /humanOversightLevel/,
        `${name} talks about the AI roles and must carry the C2PA term`,
      );
      assert.match(
        source,
        /prompt_guided/,
        `${name} must state the level that applies, not leave the reader to infer it`,
      );
      assert.match(source, /never decides/i, `${name} must say the AI never decides`);
    }
    // The page renders the shared sentence rather than repeating it, so what the
    // reader sees is the constant this suite checks above. A page that stopped
    // importing it would lose the sentence, so the import is the assertion.
    assert.match(
      privacyPage,
      /AI_DISCLOSURE_SHORT/,
      "/privacy must render the shared sentence, not a copy of it",
    );
    assert.match(privacyPage, /humanOversightLevel/);
    assert.match(privacyPage, /prompt_guided/);
  });

  it("shows prompt_guided, and no other level, on the surfaces that name one", () => {
    for (const [name, source] of [
      ["docs/PRIVACY.md", privacyDoc],
      ["Connect", connectPage],
      ["docs/LIMITS.md", limitsDoc],
      ["docs/HOW-IT-WORKS.md", howItWorks],
      ["docs/READ-YOUR-REPORT.md", readYourReport],
      ["skills/launchsense/SKILL.md", skill],
      ["llms.txt", llms],
      ["README.md", read("README.md")],
      ["docs/PRODUCT.md", read("docs", "PRODUCT.md")],
    ]) {
      // A sentence may name a level to say we do not reach it, so a match whose
      // window carries a negation is a statement about absence, not a claim.
      const claims = [];
      for (const match of source.matchAll(
        /humanOversightLevel[\s\S]{0,140}?\b(fully_autonomous|prompt_guided|human_validated)\b/g,
      )) {
        const between = source.slice(match.index, match.index + match[0].length);
        if (/\b(no|not|never|none)\b/i.test(between)) continue;
        claims.push(match[1]);
      }
      assert.ok(claims.length > 0, `${name} names no level`);
      for (const level of claims) {
        assert.equal(level, "prompt_guided", `${name} says ${level}, and no path in the product reaches it`);
      }
      // The scan above is anchored to humanOversightLevel and binds to the first
      // level word, so a false level in ordinary prose further along would slip
      // past. A level the product never reaches may be named only in a sentence
      // that negates it, so "None is X" or "No path is X" passes and an
      // assertion like "the level is X" fails even if "no" appears elsewhere.
      for (const sentence of source.split(/(?<=[.\n])/)) {
        if (!/\b(fully_autonomous|human_validated)\b/.test(sentence)) continue;
        assert.ok(
          /\b(no path|none is|none of|is not|are not|never|neither|not a path|no model)\b/i.test(sentence),
          `${name} names a level the product does not reach without negating it: ${sentence.trim().slice(0, 120)}`,
        );
      }
    }
  });

  it("keeps the cross reference from the notice true", () => {
    // docs/PRIVACY.md tells a reader the three words are in docs/CONSENT-RECORD.md.
    // That is a pointer, so the target has to carry them.
    const consent = read("docs", "CONSENT-RECORD.md");
    assert.match(privacyDoc, /docs\/CONSENT-RECORD\.md/, "the notice must keep the pointer");
    for (const level of ["fully_autonomous", "prompt_guided", "human_validated"]) {
      assert.ok(consent.includes(level), `docs/CONSENT-RECORD.md must name ${level}`);
    }
    assert.match(consent, /neither provider has confirmed a retention period/i);
  });
});

describe("no document in this lane claims more than the code does", () => {
  const newDocs = [
    ["docs/CONSENT-RECORD.md", read("docs", "CONSENT-RECORD.md")],
    ["docs/PROCESSING-REGISTER.md", read("docs", "PROCESSING-REGISTER.md")],
    ["docs/SBOM.md", read("docs", "SBOM.md")],
  ].filter(([, text]) => text.length > 0);

  it("has documents to check, so this rule cannot pass by matching nothing", () => {
    assert.ok(newDocs.length >= 3, `only ${newDocs.length} of the three new documents exist`);
  });

  it("names no legal entity anywhere in the new documents", () => {
    for (const [name, text] of newDocs) {
      for (const suffix of ["Ltd", "Limited", "Inc\\.", "GmbH", "LLP", "Pte"]) {
        assert.doesNotMatch(text, new RegExp(suffix), `${name} names a legal entity: ${suffix}`);
      }
    }
  });

  it("never claims a standard certification or a compliance status", () => {
    for (const [name, text] of newDocs) {
      const flatText = flat(text);
      for (const phrase of [/\bis\s+compliant\b/i, /\bGDPR[-\s]compliant\b/i, /\bwe\s+comply\b/i]) {
        assert.doesNotMatch(flatText, phrase, `${name} makes a compliance claim`);
      }
      // "certified" is allowed only with a walk-back on the same line.
      for (const line of text.split("\n")) {
        if (!/\bcertified\b/i.test(line)) continue;
        assert.match(line, /\bnot\b|\bnever\b|\bwithout\b|\bcannot\b/i, `${name} says "certified" without a walk-back`);
      }
    }
  });

  it("states each honest gap rather than leaving a reader to find a blank", () => {
    const consent = read("docs", "CONSENT-RECORD.md");
    const register = read("docs", "PROCESSING-REGISTER.md");
    const sbom = read("docs", "SBOM.md");
    assert.match(consent, /no registered/i);
    assert.match(consent, /region/i);
    assert.match(consent, /no withdrawal/i);
    assert.match(register, /no lawyer has reviewed/i);
    assert.match(sbom, /no hash/i);
    assert.match(sbom, /no dependency graph/i);
  });

  it("ties each retention window in the notice to the purge, or says nothing enforces it", () => {
    const doc = flat(privacyDoc);
    const page = flat(privacyPage);
    // 24 hours and 30 days are the two windows the code purges.
    for (const window of ["24 hours", "30 days"]) {
      assert.ok(doc.includes(window), `docs/PRIVACY.md lost the ${window} window`);
      assert.ok(page.includes(window), `/privacy lost the ${window} window`);
    }
    // The windows with no purge must still say so on both sides.
    for (const gap of [
      "There is no automatic deletion today",
      "no automatic deletion today",
      "no deletion window",
    ]) {
      assert.ok(doc.includes(gap) || page.includes(gap), `both copies must keep the honest gap: ${gap}`);
    }
    const analyze = read("convex", "scans", "analyze.ts");
    const retention = read("convex", "analytics", "retention.ts");
    assert.match(analyze, /CONTENT_CACHE_TTL_MS\s*=\s*24 \* 60 \* 60 \* 1000/);
    assert.match(analyze, /purgeStaleContents/);
    assert.match(retention, /USAGE_EVENT_TTL_MS\s*=\s*30 \* 24 \* 60 \* 60 \* 1000/);
    assert.match(retention, /db\.delete\("usageEvents"/);
  });
});
// The red/blue pass found the wording hash was always taken over the compiled-in
// text while the version came from the ledger line, so a stale-version decision
// asserted, under "The wording you were shown", that the person read today's
// words. The hash is now taken only when the two agree.
describe("the wording hash is only taken over words the person read", () => {
  it("leaves the hash empty and names the gap when the ledger names another version", async () => {
    const stale = { ...granted, noticeVersion: "2026-06-01", latest: true };
    const record = await buildConsentRecord(stale, "usage");
    assert.equal(record.privacy_notice.version, "2026-06-01");
    assert.equal(
      record.privacy_notice.wording_sha256,
      null,
      "the current text must not be hashed under an older version",
    );
    assert.ok(
      record.not_filled.some((gap) => gap.field === "privacy_notice.wording_sha256"),
      "the gap must be named rather than guessed",
    );
  });

  it("still hashes when the ledger names the version this build carries", async () => {
    const record = await buildConsentRecord(granted, "usage");
    assert.match(record.privacy_notice.wording_sha256, /^sha256:[0-9a-f]{64}$/);
  });
});

// The receipt is the copy the person keeps, so the same version guard has to
// reach it. Before this, a stale-version decision persisted a receipt printing
// today's words under the heading "The wording you were shown".
describe("the receipt does not reproduce words the person did not read", () => {
  it("leaves the wording out and says why when the ledger names another version", async () => {
    const stale = { ...granted, noticeVersion: "2026-06-01", latest: true };
    const record = await buildConsentRecord(stale, "usage");
    const receipt = await buildConsentReceipt(record);
    assert.equal(receipt.notice_wording, null, "the receipt must not reproduce words the person did not read");
    assert.ok(
      receipt.notice_wording_note !== null && /not reproduced/i.test(receipt.notice_wording_note),
      "the receipt must say why the wording is absent",
    );
    const text = renderConsentReceipt(receipt);
    assert.ok(
      !text.includes(DIAGNOSTICS_NOTICE_WORDING[0]),
      "the stale receipt must not print the current first line under the old version",
    );
    assert.match(text, /Not reproduced/);
    assert.ok(!/not computed on this runtime/.test(text), "the reason must be the version, not a false runtime limit");
  });

  it("still prints the wording when the version matches", async () => {
    const receipt = await buildConsentReceipt(await buildConsentRecord(granted));
    assert.ok(Array.isArray(receipt.notice_wording));
    assert.ok(renderConsentReceipt(receipt).includes(DIAGNOSTICS_NOTICE_WORDING[0]));
  });
});
