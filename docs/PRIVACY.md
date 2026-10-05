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

## 4. What we store when you sign in

Your GitHub token, stored as a plaintext string at rest. It is not encrypted. The token
is readable only by our server's internal functions. The functions a signed-in user
can call return a boolean or nothing, never the token.

Signing out from the menu deletes the token. The token is not deleted when a session
expires on its own, so it stays until you sign out. A signed-in read gets a higher cap
of up to 1,000 files and about 8MB. Scans you run while signed in are linked to your
account id in our database. The guest scan does not use your token.

## 5. What an AI provider receives

Only when you press the Explain in plain words button. Nothing is sent on any other
press, and a scan does not send anything to a provider by itself.

The request carries a finding fingerprint, the severity, the title, and the reason. It
does not carry the file path and it does not carry file contents. It goes to Google
Gemini first, then to Ollama Cloud if Gemini does not answer. If both fail, a fixed
built-in wording is used and no provider is asked.

## 6. What the coding tool connection sends

The repository URL your tool passes, and nothing from your machine. The tool runs on
your machine. It asks our server to read one public repository, up to 200 files and
about 2MB. We store the repository name, the commit, the file paths, and what we
found.

This address needs no account and signs you in to nothing. We keep a rate limit counter
so the service stays available. It is not linked to an account, and the counter holds no
part of your network address. Those rows are not deleted automatically today.

## 7. Fonts and what the browser sends without asking

The site loads two font families from Google Fonts, so your browser contacts Google
with your IP address before the page finishes drawing. We load no analytics script, no
chat widget, and no advertising tag.

Our own server sees your IP address on every request, as any web server does, and it
stays in the server logs.

## 8. How long we keep each thing

- Cached file metadata: deleted 24 hours after it was written, by a later scan of that
  repository.
- OSV vulnerability answers are reused for 7 days and then looked up again.
- Findings and evidence: kept so a re-scan can tell you what you fixed. There is no
  automatic deletion today.
- Quota counters: a single row, overwritten.
- Rate limit counters: no automatic deletion today, and no network address in them.
- Your GitHub token: kept until you sign out from the menu. It is not deleted when the
  session expires.

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
scans, findings, evidence, projects, and token rows by hand.

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