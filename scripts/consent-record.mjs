// Writes the consent records and receipts for this machine's install.sh ledger.
//
//   node scripts/consent-record.mjs                 reads ~/.config/launchsense/consent.jsonl
//   node scripts/consent-record.mjs --log PATH      reads another ledger, for a check
//   node scripts/consent-record.mjs --out-dir DIR   writes records.json and receipt.txt
//
// The ledger is one JSON object per line, appended by install.sh when a decision is
// really made. It holds a notice version, a granted flag, a time, and the source of
// the decision. It holds no token, no key, and no identifier for the person, and
// this script prints nothing that is not already in that file.
//
// WHAT THIS FILE CANNOT DO. It reads one local ledger and nothing else. It holds
// no Convex credentials, opens no connection, and cannot read the consentRecords
// table where the sign-in panel's four decisions are written for a signed-in
// person. So the token, read, and explain records it prints are the shape of those
// records with `status: recorded_in_database`, no record id, and no event time,
// and their not_filled list names the table and the query that do hold the
// decision. Making this file pretend it could produce them would be the same
// defect as claiming the decision was never captured, in the other direction.
//
// The records are built in the shape ISO/IEC TS 27560:2023 names, and the receipt
// is the copy a person can keep. Both are deterministic: the same ledger gives the
// same bytes, because the record id is derived from the content and no clock is read.
//
// No network. No write outside the directory asked for.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Prefixed } from "../shared/consent/digest.ts";
import {
  buildConsentRecord,
  buildConsentRecordTemplate,
  buildConsentReceipt,
  renderConsentReceipt,
} from "../shared/consent/record.ts";
import {
  CONSENT_LEDGER_PATH,
  CONSENT_PURPOSES,
  DIAGNOSTICS_NOTICE_VERSION,
} from "../shared/consent/vocabulary.ts";

// fileURLToPath, not URL.pathname: this checkout path contains spaces and the
// raw pathname keeps them percent encoded.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value === undefined || value.length === 0 ? null : value;
}

/**
 * Read the ledger into decisions, with the hash chain derived by the reader.
 *
 * The installer writes no hash, so the chain is computed here: each line's own
 * SHA-256 is the record hash and the previous line's hash is the `prev_hash`.
 * Editing an earlier line therefore moves every later hash, which is what makes an
 * append-only text file checkable after the fact. It is not a signature, and it does
 * not stop anyone who can rewrite the whole file.
 */
async function readLedger(path) {
  if (!existsSync(path)) return { decisions: [], unreadable: 0, present: false };
  const lines = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0);
  const decisions = [];
  let unreadable = 0;
  let prevHash = null;
  for (const [index, line] of lines.entries()) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      unreadable += 1;
      continue;
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed["noticeVersion"] !== "string" ||
      typeof parsed["granted"] !== "boolean" ||
      typeof parsed["decidedAt"] !== "string"
    ) {
      unreadable += 1;
      continue;
    }
    const recordHash = await sha256Prefixed(line);
    decisions.push({
      noticeVersion: parsed["noticeVersion"],
      granted: parsed["granted"],
      decidedAt: parsed["decidedAt"],
      source: typeof parsed["source"] === "string" ? parsed["source"] : "this line names no source",
      line,
      prevHash,
      latest: index === lines.length - 1,
    });
    prevHash = recordHash;
  }
  return { decisions, unreadable, present: true };
}

const logPath = arg("--log") ?? join(homedir(), CONSENT_LEDGER_PATH);
const outDir = arg("--out-dir");
const { decisions, unreadable, present } = await readLedger(logPath);

const records = [];
// The receipt belongs to the decision that is still in force, which is the last
// line in the ledger. An earlier answer is evidence and keeps its own record.
let currentRecord = null;
for (const [index, decision] of decisions.entries()) {
  const record = await buildConsentRecord(decision);
  records.push(record);
  if (index === decisions.length - 1) currentRecord = record;
}
for (const purpose of CONSENT_PURPOSES) {
  // A shape for every purpose this ledger cannot answer. The decision may well
  // exist in the database, and printing nothing about it would leave a reader of
  // this file thinking it was never captured.
  if (purpose.recorded_in !== "local_ledger") records.push(await buildConsentRecordTemplate(purpose.id));
}

const current = decisions.find((decision) => decision.latest) ?? null;
const receipt = currentRecord === null ? null : await buildConsentReceipt(currentRecord);

const summary = {
  ledger: logPath,
  ledger_present: present,
  decisions_read: decisions.length,
  lines_unreadable: unreadable,
  notice_version_in_force: current?.noticeVersion ?? DIAGNOSTICS_NOTICE_VERSION,
  notice_version_matches_install_script: (current?.noticeVersion ?? DIAGNOSTICS_NOTICE_VERSION) === DIAGNOSTICS_NOTICE_VERSION,
  current_answer: current === null ? "no decision on record" : current.granted ? "granted" : "refused",
  records: records.length,
  recorded_records: records.filter((record) => record.status === "recorded").length,
  shapes_only: records.filter((record) => record.status === "not_recorded").length,
  in_database_not_in_this_file: records.filter((record) => record.status === "recorded_in_database").length,
  // Said in the output, not only in a comment, so a reader who only ever sees the
  // JSON still learns that this file is not the whole record set.
  sign_in_records:
    "Not in this file. This generator reads the local ledger only and cannot read the Convex database. A signed-in person reads their own rows with the myConsentRecords query in convex/consent.ts.",
};

if (outDir !== null) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "consent-records.json"), `${JSON.stringify(records, null, 2)}\n`, "utf8");
  if (receipt !== null) {
    writeFileSync(join(outDir, "consent-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    writeFileSync(join(outDir, "consent-receipt.txt"), `${renderConsentReceipt(receipt)}\n`, "utf8");
  }
  process.stdout.write(`Wrote ${records.length} record(s) to ${outDir}\n`);
} else {
  process.stdout.write(`${JSON.stringify(records, null, 2)}\n`);
  if (receipt !== null) process.stdout.write(`\n${renderConsentReceipt(receipt)}\n`);
}

process.stdout.write(`\n${JSON.stringify(summary, null, 2)}\n`);
void ROOT;