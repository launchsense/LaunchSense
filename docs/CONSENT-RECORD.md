# Consent records and the consent receipt

This is the ISO/IEC TS 27560:2023 shape for one decision about one purpose, and the
receipt a person keeps. It is generated, never hand-edited.

```
npm run consent-record                    reads ~/.config/launchsense/consent.jsonl
npm run consent-record -- --out-dir DIR   writes consent-records.json, consent-receipt.json, consent-receipt.txt
```

The two inputs are real and they are in different places. `install.sh` asks one
question, remembers the answer, and appends one line per real decision to a ledger
on the person's own machine. The sign-in panel in `src/features/auth/AuthPanel.tsx`
asks about four purposes in four unticked boxes, and a person who signs in gets
those four answers written to the Convex table `consentRecords`. Both are
described in `shared/consent/vocabulary.ts`, which is the only place a purpose is
defined, so a copy change and a record change are one change.

## What this file can and cannot read

`npm run consent-record` reads one thing: the local ledger. It holds no Convex
credentials, opens no connection, and cannot read the Convex database, so it cannot
read the `consentRecords` table either. So the three records it prints for `token`,
`read`, and `explain` are the **shape** of those records and not the decisions, and
they say so:

- `status: recorded_in_database`, which is this product's own value. It means a
  decision exists for that purpose for a person who signed in, this file cannot
  show it, and here is where to read it.
- no `record_id`, because the id is derived from the decision time this file does
  not have.
- no `event.time`, for the same reason.
- a `not_filled` list naming the table and the query.

The export path is the caller's own query, `myConsentRecords` in
`convex/consent.ts`. It takes no argument, reads the account id out of the
session, and returns that account's rows and nobody else's. Nothing in this
repository turns that query into a download button, so a person who wants their
records asks for them and we run the query, or runs it from their own session.

The generator is not made to pretend it can do more than that. Claiming the
sign-in decision was never captured would be false now that it is captured, and
claiming this file holds it would be false too. Both are the same mistake in
opposite directions.

## What the standard asks for, and what we have

TS 27560 is a Technical Specification, first edition 2023-08. Its Table 1 is the
record header and its Table 2 is the PII processing block. Field names follow those
tables, because the names are the point of the standard. The values are ours.

| Field | Status | Note |
|---|---|---|
| `schema_version` | filled | `launchsense.consent/1.0`, pinned so a record written before a change stays readable |
| `record_id` | filled | Derived from the purpose, the notice version, and the decision time. Not a random UUID-4, because the person keeps the receipt |
| `pii_principal_id` | **not filled** | The ledger holds no person identifier. The `consentRecords` rows do carry the account id, and this offline file cannot read that table |
| `privacy_notice` | filled | A URI, the version, and a SHA-256 over the exact lines the person read. A reference and a hash, never a stored copy. The hash is only taken where this build carries the wording, so the sign-in records carry none |
| `language` | filled | `en` |
| `purposes` | filled | One entry. One purpose per record, so the event cannot apply to two purposes |
| `purpose` | filled | Id, type, lawful basis, and the description a notice would use |
| `lawful_basis` | filled | A DPV term with the article it stands for |
| `pii_information` | filled | What the values are, whether they are sensitive, and where each comes from |
| `pii_controllers` | filled in part | The party id, the role, and a contact. **No registered name**, because none is published |
| `collection_method` | filled | How the code actually asks |
| `processing_method` | filled | What happens to it next |
| `storage_locations` | filled in part | The system is filled. **Every region reads `unknown`** |
| `retention_period` | filled in part | The window is filled. `enforced_by` is null where nothing deletes the data |
| `event` | filled for the ledger, **not filled** for the sign-in records in this file | Time, manner, location, mechanism, consent type, and locale |
| `integrity` | filled | SHA-256 over the ledger line, chained to the line before it |
| consent receipt | filled | The copy the person keeps |

## What we cannot fill, and why

Six gaps, listed in `NOT_FILLED_FIELDS` in the vocabulary. Each record carries the
ones that apply to it in its own `not_filled`, so a record lists only fields it really
lacks. Each gap is absent because nothing in this repository can state it honestly,
not because nobody filled it in.

1. **A registered controller name.** `docs/PRIVACY.md` section 1 says no registered
   company name, registered address, or data protection officer is published. The
   record carries `registration_unknown: true` instead of a name that reads well.
2. **A principal identifier.** The local ledger records a decision about wording,
   not about who answered. The id is scoped to the record and links to nobody. The
   `consentRecords` rows do carry the account id, and this offline file cannot read
   that table, so those rows cannot fill the field here.
3. **A region.** No host or provider has confirmed one to this product. Writing
   `eu-west` because it would be nice to write it is the exact failure the field
   exists to prevent, so every region reads `unknown` with a note saying so.
4. **A withdrawal event.** No withdrawal path is built. A person can refuse a
   purpose in the sign-in panel and that refusal is stored as `granted: false`, and
   `install.sh` can be re-run with `LAUNCHSENSE_DIAGNOSTICS=off`, which writes a
   refusal line. Neither turns a stored decision off. There is no button and no
   route that does it.
5. **A data protection officer.** None is appointed, so there is no contact role to
   fill.
6. **A hash written by the installer.** It writes none. The chain is derived by the
   reader from the append-only file, so tampering is detectable against that file
   and not against a stored copy.

`event.type` has a seventh, smaller gap. TS 27560 names `consent_given` and
`consent_withdrawn`; it names nothing for a refusal at the point of the question. A
refusal is evidence, so it is recorded, and the record says `consent_refused` is this
product's own value rather than borrowing a term that means something else.

`status` has an eighth, smaller gap. `recorded_in_database` is this product's own
value, and it exists because TS 27560 names a record but not the case of a decision
held in a system the publisher of the record cannot read.

## The sign-in records

The gap this document used to lead with is closed, and the way it is closed matters
as much as the closing.

The four boxes in `AuthPanel.tsx` used to be React state. A person could tick four
boxes, click Sign in, and leave nothing behind: no purpose, no answer, no time, no
wording version. Three of the four purposes therefore had no record anywhere, and
the record said `not_recorded`, which was honest and also the gap.

What happens now:

1. The click persists the four answers, the wording version
   (`SIGN_IN_NOTICE_VERSION` in `shared/copy/signIn.ts`), and the click time to
   `sessionStorage`. It cannot write a record: the person is anonymous until the
   OAuth callback, so there is no account to attach one to.
2. `src/features/auth/ConsentRecorder.tsx` watches for a session and then calls
   `recordSignInDecisions` once, with those values, and clears what it persisted.
   Nothing is persisted means nothing is written, so a person who signed in before
   this change has no row and none was invented for them.
3. The mutation takes the account id from `getAuthUserId`. There is no `userId`
   argument, so nothing in the request can move a record onto somebody else's
   account.
4. One row is written per (account, purpose, notice version). The same decision
   twice updates one row. A wording change adds a row beside the old one rather
   than overwriting it, so both answers stay readable and the version is what
   re-asks.
5. `myConsentRecords` returns the caller's own rows for export.

Two facts about that path stay on this page because they are limits, not details.
The sign-in wording is not hashed, because this build carries those lines as a
component rather than as text, and hashing the installer's wording under a sign-in
notice version would tell a reader they agreed to words they never saw. And
`decidedAt` is the browser's clock, so the row also carries `recordedAt` from this
server; the mutation refuses a click time that is not a plausible past or present
time.

GDPR Art 7(1) puts the burden of demonstrating consent on the controller. For a
person who signs in today, this build can demonstrate three of the four purposes
from the database and the fourth from the local ledger. For a person who signed in
before this change, it can demonstrate nothing about those three, and the record
still does not pretend otherwise.

## Integrity

`integrity.record_hash` is the SHA-256 of the exact ledger line. `prev_hash` is the
hash of the line before it, so editing an earlier line moves every later hash. The
chain is derived when the file is read, not stored, which means it is tamper-evident
against that file and offers no protection against someone who can rewrite the whole
file. That is a weaker property than a signature, and it is stated as one.

`record_id` is a content-derived UUID with the version nibble set to 8, which RFC 9562
reserves for a custom layout. It is not a v4 and not a v5, and calling it one would be
wrong. The same decision always produces the same id, so a receipt kept for a year can
be checked against a ledger read today.

## The receipt

`renderConsentReceipt` prints the copy a person keeps. It states the notice version,
the hash of the wording, and the wording itself, because a hash proves two texts are
the same and does not tell a reader what they agreed to. It names the rights, and it
says plainly that there is no withdrawal button and no route that serves a record to
anybody but the person it belongs to, because neither exists.

A receipt for a purpose whose decision lives in the database prints the status and
then says that this file does not hold the decision and names the table and the
query. It does not print the sign-in wording, because this build carries it as a
component rather than as text, and showing a person the installer's lines under a
sign-in notice version would be a false receipt.

For a purpose whose basis is consent, this receipt is the document GDPR Art 20 asks
for. That is this product's reading, not a lawyer's. The receipt is deterministic:
same ledger in, same bytes out, because `issued_at` is the decision time rather than
the time the generator ran.

## The explain purpose, and the one place a model is involved

`explain` is the only purpose where a model touches personal data, so it is the one
worth being exact about. The request carries a finding fingerprint, the severity, the
title, and the reason. It carries no file path and no file contents. It goes to Google
Gemini first, then to Ollama Cloud if Gemini does not answer, and if neither answers no
provider is asked and the fixed wording is shown instead.

The model rewrites the wording of a finding a fixed rule already produced. It never
decides a finding, a severity, a licence fact, consent, who a caller is, or whether a
request is allowed. Its `humanOversightLevel` is `prompt_guided`, the C2PA Technical
Specification 2.4 value for a person who provided the request and nobody who approved
the output. No path in this product is `fully_autonomous`, because nothing a model
writes happens without a person asking for it, and none is `human_validated`, because
no path in this repository records a person approving a model's output.

Two facts about that purpose this product cannot state, and says so in the record rather
than filling in: neither provider has confirmed a retention period, and neither has
confirmed a region. `providerCalls` keeps the day, the source, the model, the latency, a
hash of the prompt, and token counts. It keeps no prompt text and no reply, and nothing
deletes it.

## Vocabulary, cited as vocabulary

The `extension` block carries W3C Data Privacy Vocabulary v2 terms so a third party can
read a record without a custom parser. DPV 2 is a Community Group Final Specification
dated 2024-08-01, so it is cited as a vocabulary and not as a standard. Only
`dpv:ConsentStatus:Given` is written, and only for a granted answer: the DPV term for
a refusal was not verified in this lane, so none is written.

We claim consistency with named articles, never a compliance status. Nobody certifies
this document.

## What this lane did not build

- **A withdrawal path.** A refusal is stored and is visible in the export, and a
  person can record a refusal by ticking differently next time, but nothing turns a
  stored decision off. There is no button, no route, and no deletion job for
  `consentRecords`.
- **An export button.** `myConsentRecords` is a query, not a page. No screen in the
  product calls it yet, so a person who wants their records asks us and we run the
  query against their own session.
- **A receipt at a stable URL.** The receipt is a file a person runs on their own
  machine. Publishing one at a URL would need a route that resolves a record id for
  the person it belongs to, and no route does.
- **A wording hash for the sign-in notice.** The wording lives in
  `shared/copy/signIn.ts` and in a component. Hashing the wrong lines under this
  version is worse than carrying no hash, so the field is empty and named.
- **A DPO, a registered entity, or a confirmed region.** Those are facts about the
  world, not about the code.
- **Art 30(2).** The processor register belongs to Convex, GitHub, Google, Ollama,
  and the font service. It is named in `docs/PROCESSING-REGISTER.md` and not written
  here.