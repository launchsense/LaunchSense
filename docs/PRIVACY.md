# Privacy

Version 2026-10-05. This is the first version published at the address
<https://harmless-chihuahua-667.convex.site/privacy>. The same text is rendered at
`/privacy` in the app. Tests compare the two, so the headings and the load-bearing
facts cannot drift apart: the read caps, the snippet cap, the redirect cap, the
retention lines, and the counter claim are on both sides, and those numbers are
checked against the constants the code uses. Sentences with no such check are prose
a person must review when the code around them changes.

## 1. Who we are

LaunchSense is a code review tool. The maintainer publishes it at www.withkeshav.com.

We have not published a registered company name, a registered address, or a named
data protection officer. We know that a privacy notice without them is incomplete. If
you need one for a compliance record, ask at www.withkeshav.com and we will add it
here rather than invent it.

## 2. What you agree to when you use this

There are three ways in, and each one is a different exchange.

- Paste a public repository URL. We read it on our server and store what we found.
- Sign in with GitHub. We use your token on our server to read one repository.
- Add the coding tool address from the Connect page. Your tool asks our server to
  read one public repository at a time.

We do not read your machine in any of the three. We store no copy of your code in our
database. We never change your code and we never write to your repository.

Nothing on this site is pre-ticked. Every box that asks for a decision starts unticked.

## 3. What you paste, and what we store from it

Repo owner and name, commit SHA, and file paths.
Finding records: rule, file, line, and a redacted snippet, capped at 200 characters.
Per file: its path, size, and a content hash. Nothing more.
Scan results, so a re-scan of the same commit can be compared against the last one.

Raw secret values are never stored. Every snippet passes through redaction before it
is written, and the redaction runs before the value can reach storage. File contents
in any form are never stored. We read them in memory during a scan and keep only the
numbers above.

A guest read uses the shared GitHub quota and stops at 200 files and about 2MB.

If you give a live app URL, our server makes a plain HTTP request to that address and
reads the returned HTML. It refuses to contact loopback, private, link-local, or cloud
metadata addresses, including hostnames that resolve to one. It follows up to three
redirects and re-checks every hop.

Our server fetches public repo data from GitHub, either as a file list or as one
repository archive. Your browser only sends the URL and shows the results.

First-party analytics writes are limited by event kind and day, so the public endpoint
cannot write an unbounded stream of rows.

Here is the rule our analytics runs on, in plain words. Analytics holds no personal
information. No email address, no network address, and no free text is written to an
analytics row. The only label that names anything is the coding tool that sent the call,
which is a claim about a tool and not about a person. The only identifier analytics is
allowed is the repository identifier, and we use it for technical purposes only: running
the scan, linking a rescan, and counting the funnel. Every other value on an analytics row
is a count, a code, a time, or one of a closed set of labels.

The list of columns behind that rule, field by field, is in
`convex/analytics/inventory.ts`, and a test reads the database schema and fails if a
column appears there that nobody classified.

## 4. What we store when you sign in

Your GitHub token, stored as a plaintext string at rest. It is not encrypted. The token
is readable only by our server's internal functions. The functions a signed-in user
can call return a boolean or nothing, never the token.

Signing out from the menu deletes the token. The token is not deleted when a session
expires on its own, so it stays until you sign out. A signed-in read gets a higher cap
of up to 1,000 files and about 8MB. Scans you run while signed in are linked to your
account id in our database. The guest scan does not use your token.

When you sign in, we write your answers to the four purpose boxes above into a table
called `consentRecords` under your account id. Each row holds which purpose it was,
whether you agreed to it, the version of the wording you read, the time you clicked,
and the time our server wrote the row. We do not write anything else there: no token,
no repository name, and no file paths. We do the same thing if you sign in again
under different wording, so both answers stay on file. There is no export button on
this site yet. Ask at www.withkeshav.com and we will read your rows back to you, or
you can run the query against your own session.

## 5. What an AI provider receives

Only when you press the Explain in plain words button. Nothing is sent on any other
press, and a scan does not send anything to a provider by itself.

The request carries a finding fingerprint, the severity, the title, and the reason. It
does not carry the file path and it does not carry file contents. It goes to Google
Gemini first, then to Ollama Cloud if Gemini does not answer. If both fail, a fixed
built-in wording is used and no provider is asked.

The provider rewrites a finding in plainer language. It never decides a finding, a
severity, a licence fact, consent, who a caller is, or whether a request is allowed.
Those come from fixed code. The `humanOversightLevel` for that call is
`prompt_guided` in the vocabulary of C2PA Technical Specification 2.4: a person
pressed the button, and nobody approved the answer afterwards. We borrow that one
word. We are not a C2PA claim generator, we hold no certificate chain, and this is
not a conformance claim. The same three words are in `docs/CONSENT-RECORD.md`.

## 6. What the coding tool connection sends

The repository URL your tool passes, and nothing from your machine. The tool runs on
your machine. It asks our server to read one public repository, up to 200 files and
about 2MB. We store the repository name, the commit, the file paths, and what we
found.

This address needs no account and signs you in to nothing. We keep a rate limit counter
so the service stays available. It is not linked to an account, and the counter holds no
part of your network address. Those rows are not deleted automatically today.

You can send an optional LaunchSense credential in an Authorization header. We keep its
lookup id in the clear and a SHA-256 hash of the credential, never the credential itself, so
a copy of our database cannot be replayed against the server. The rate limit counter then
holds that credential's own id, which is why one tool cannot spend another tool's budget.
The per-tool caps are a policy choice we have not measured against real traffic. Revoking a
credential takes effect on the next request, because the revoked flag is read on every
request rather than at an expiry. A credential that is presented and refused gets no scan,
rather than being quietly treated as anonymous.

A credential records the operator's label for a harness, such as "claude-code". That label is
their claim, not something we verified. We cannot currently verify which harness sent a
request: the scan reads the public repository with our own GitHub credential, so nothing
about the call identifies a person. Treat every harness-level number as a caller claim.

### What the coding tool connection records about its own use

We record one row per protocol action on this address, so we can tell which agent is
calling, which tool, how often, and whether it worked. Each row holds the tool name, the
outcome, how long it took, the protocol version, and which of eight known harnesses made
the call. We do not record the arguments or the result of a tool call. In particular we do
not record the repository URL, even though the OpenTelemetry specification would allow it
as an opt-in attribute: that attribute carries a warning about sensitive content, and here
it would be a list of whose code you asked about. We do not record your network address,
the file contents, file paths, finding titles, or error text. If the call read a
repository, the row holds a one-way hash of the name and the date rather than the name.

Those rows are deleted after 30 days by a nightly job. The rolled-up daily counts that
come from them are kept, and they hold no repository name either: they are counts and a
small set of labels.

The daily counts answer "which harness calls us, which tool, how often, and does it
work". They do not say who you are, and they do not name a repository.

Which tool you are calling and whether it worked is not attributed to your account. It is
an aggregate over every caller of the public address.

## 7. Fonts and what the browser sends without asking

The site loads two font families from Google Fonts, so your browser contacts Google
with your IP address before the page finishes drawing. We load no analytics script, no
chat widget, and no advertising tag.

Our own server sees your IP address on every request, as any web server does, and it
stays in the server logs.

## 8. How long we keep each thing

Every line below names the code that deletes the thing, or says that nothing does.
A window with no job behind it is stated as a gap rather than as a promise.

- Cached file metadata: deleted 24 hours after it was written, by a later scan of that
  repository. The window is `CONTENT_CACHE_TTL_MS` in `convex/scans/analyze.ts`, and
  the deletion is `purgeStaleContents` in `convex/scans/store.ts`, bounded at 500 rows
  a run.
- OSV vulnerability answers are reused for 7 days and then looked up again. That is a
  read window, not a purge: nothing deletes the `osvCache` table.
- Findings and evidence: kept so a re-scan can tell you what you fixed. There is no
  automatic deletion today.
- Quota counters: a single row, overwritten.
- Rate limit counters: no automatic deletion today, and no network address in them. When a
  credential resolved, the key holds that credential's own id.
- Coding tool usage rows on the hosted address: deleted after 30 days by a later nightly
  job. The window is `USAGE_EVENT_TTL_MS` in `convex/analytics/retention.ts` and the job
  is the `purge expired usage events` cron at 03:40 UTC, bounded at 500 rows a run. The
  daily counts folded from them are kept, and hold no repository name.
- Usage counts from the local installer: written to `usageDiagnostics` only after you
  answer yes at the install question. That table has no deletion window today. Nothing in
  this repository deletes it.
- Your GitHub token: kept until you sign out from the menu. It is not deleted when the
  session expires.
- Sign-in consent records: one row per purpose per account in `consentRecords`, kept
  while the account exists. Nothing in this repository deletes that table, so a stored
  decision cannot be taken back from the product today. There is no withdrawal button
  and no route that turns a decision off.
- Provider call rows from Explain in plain words: kept. Nothing deletes `providerCalls`.
- Server request logs: kept by the host, on the host's own schedule, which we neither
  control nor state.

The full list, with the tables and the columns behind each line, is the register in
`docs/PROCESSING-REGISTER.md`.

## 9. Who can see it

Us, and four processors, and nobody else.

- Convex holds the database and serves the site.
- GitHub serves the repository data we read.
- Google Gemini and Ollama Cloud receive the explain request described in section 5,
  and only after you press the button.
- Brevo is the intended email provider. No email is sent today.

Our staff can read the database to run the service and to answer a support request.
Nobody else is given access.

## 10. Your choices

- Do not paste a URL and nothing is collected.
- Sign out and the token is deleted straight away.
- Do not press Explain in plain words and no provider is asked.
- The local review installer asks one question, and the default answer is no. Usage
  counts stay on your machine until you say yes. You can turn them off later with
  `LAUNCHSENSE_DIAGNOSTICS=off`.

What is not built yet: turning off scan history from an account menu, and a
Delete my data button. Ask at www.withkeshav.com and we do it by hand.

## 11. How to delete your data

Signing out deletes your GitHub token immediately.

There is no self-service deletion button. Ask at www.withkeshav.com and we delete your
scans, findings, evidence, projects, and token rows by hand. We delete your
`consentRecords` rows the same way, on request. We will not quietly edit a decision
instead: if you want a different answer, the record of the old one stays and the new
one is written beside it.

What we cannot take back: a share link or a passport link you already published stays
public, because a published link cannot be unpublished. Tell us what you published and
we will list those links for you first.

## 12. Who to complain to

In India, the Data Protection Board of India. In the European Union, the data
protection authority where you live. We would rather you told us first at
www.withkeshav.com.

## 13. Changes

Version 2026-10-05, 5 October 2026. This is the first version. It added the /privacy
route, the footer link, the sign-in purpose boxes, the Connect page disclosure, and the
default-no question in the local installer. The installer used to write an agreement
on your behalf before asking anything. It does not any more.

6 October 2026. Section 4 now says that your answers to the four purpose boxes are
written to `consentRecords`, and section 8 says that nothing deletes them. Before this,
your answers were read by the page, kept in the browser for as long as the page was
open, and never written down anywhere. Nobody's past answers have been reconstructed,
so an account that signed in before this has no row and we did not invent one.