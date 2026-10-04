# Limits

What this release does not do. Everything here is stated so nothing looks finished when it is not.

LaunchSense does not say if the product will sell. It does not judge the market or the idea. Repeated functions are not checked yet. Duplicate files and huge files are.

## Code we can read

- The paste box reads a public GitHub repo with no account. That guest read stops at 200 files and about 2MB, and it uses the shared GitHub quota.
- Sign in with GitHub to read one private repo you can already read, or more of a public one. That read uses your GitHub token on our server for one archive download, then the token is deleted when you sign out. The signed-in cap is 1,000 files and about 8MB. The download stops at 20MB either way. We do not store the file contents.
- GitHub quota for a guest scan is shared. When it runs out, scans show partial with a retry time. A signed-in scan spends that person's GitHub quota and does not change the guest meter.
- One scan makes about four GitHub requests: repository metadata, the latest commit, the file list, and one repository archive.
- Caps: 100 KB per file. Lockfiles may be read up to 500 KB so exact installed versions can be checked. Skipped files are listed as not checked.
- Binary files and generated folders like node_modules, dist, and build are skipped.

## Capacity, and what we show you

- The scan page shows how many GitHub requests are left, how many more scans that allows, and when the quota resets.
- Six scans analyse at the same time. Extra scans queue and are told their place instead of everyone failing together.
- Every scan has a time budget. When it runs out, the result is partial and the not-checked list says what was left undone.

## Checks we do not run

- Dependency freshness and deps.dev data are not checked yet.
- Vulnerability lookup covers npm, PyPI, and Go. Timeouts show as unknown, never as safe. For npm, exact installed versions are used from `package-lock.json` when that file is present.
- License notes are signals, not legal advice.
- Authentication and runtime behaviour are not tested.
- Rendered layout on a real phone is not checked. The live check only reads served HTML, and the report says so.

## Signals, not verdicts

- Share Readiness is a signal from the files we could read. It is not a certification and it does not decide the quality of your product.
- Standards lines cover an OWASP ASVS 5.0.0 subset, OWASP Top 10:2025 categories we can see, OSV for npm, PyPI, and Go, and three CWE labels on checks we already run. deps.dev and OpenSSF Scorecard are not-checked. Every line has a version, a caveat, and a source. No line claims a certification.
- Repo DNA describes shape and structure, nothing about merit.

## Signals, not scores

- Read coverage is the share of paths we actually opened. It is not a quality score.
- Actionable share is the share of findings needing action. It describes the mix of findings, not how much was checked.
- Share Readiness is a band with plain reasons attached. Not a certification and not a grade.

## AI explanations

- Explanations use Google AI Studio / Gemini when a server key is configured. If Gemini does not answer, the server tries Ollama Cloud with a small model. If neither is configured or neither answers, plain deterministic wording is shown instead.
- AI output is rejected when it references an unknown finding, drops an actionable finding, or claims a check we did not run. Rejected output falls back to plain wording.
- AI never decides what is a finding. Only the fixed checks decide that.
- Bring your own AI key stays out of this release.

## Not built yet

- No saved projects, no history, no rescan across sessions.
- A coding tool review that reads the files on your machine is not running yet. There is no code upload.
- No monitoring and no scheduled scans.
- No GitHub App installation scan yet. That connected read is on the roadmap, see `ROADMAP.md`. Sign-in today downloads one archive with the person's token.
- No runtime performance data. GitHub does not expose it.
- No blog posts published yet.

## The one rule that overrides all of these

A partial result is never a pass. Anything unchecked stays listed as not checked.