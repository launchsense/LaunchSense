# Limits

What this release does not do. Everything here is stated so nothing looks finished when it is not.

LaunchSense audits your repo on your machine, through your coding tool. It has no hourly limit, sends nothing to us unless you opt in, and reads your working tree including work you have not committed.

## Code we can read

- The local read covers 5,000 files and 40MB in all, 100KB per file.
- OSV covers up to 50 packages. The rest stay not checked.
- Caps: 100 KB per file. Lockfiles may be read up to 500 KB so exact installed versions can be checked. Skipped files are listed as not checked.
- Binary files and generated folders like node_modules, dist, and build are skipped.

## Capacity, and what we show you

- Every local run has a time budget. When it runs out, the result is partial and the not-checked list says what was left undone.

## Checks we do not run

- The website paste and the hosted MCP do not ask deps.dev. An empty answer stays unknown.
- Vulnerability lookup covers npm, PyPI, and Go. Timeouts show as unknown, never as safe. For npm, exact installed versions are used from `package-lock.json` when that file is present.
- Dependency license terms are read for npm only, and only from a committed `package-lock.json`. A lockfile with no `packages` map reads as incomplete, not as zero licences. yarn.lock, pnpm-lock.yaml, Cargo, Go and PyPI dependency licences, vendored trees, per-file SPDX headers and REUSE.toml are not read, and a vendored tree stays a skip rather than becoming an obligation source.
- The lockfile says what the repository declared. What a registry says today is a different fact and is not read, so a re-published or re-licensed package is caught on the next scan or not at all.
- The license obligation table is a small cited table of what a licence text asks for. It is not a legal engine, it does not model linking or aggregation, and it does not decide whether an obligation applies to how you ship. A person decides that.
- A package whose license could not be read stays Unknown and is never given a severity or a finding. A guarded AI lookup for those exists, with a strict noun whitelist, and no lane is wired in this release, so it is refused.
- License notes are signals, not legal advice.
- Authentication and runtime behaviour are not tested.
- Rendered layout on a real phone is not checked.

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
- It never decides a severity, a licence fact, consent, who a caller is, or whether a request is allowed. Those are fixed code, and each one names the file that does it in `shared/copy/aiDisclosure.ts`.
- Human oversight level, `humanOversightLevel` in C2PA Technical Specification 2.4: `prompt_guided`, the term for a person who asked for the output and nobody who approved it afterwards. Every AI path here is that one. None is `fully_autonomous`, because no model writes anything without a person having asked for it first, and none is `human_validated`, because no path in this repository records a person approving a model's output. We borrow the three words. We are not a C2PA claim generator, we hold no certificate chain, and this is not a conformance claim.
- Bring your own AI key stays out of this release.

## Not built yet

- No saved projects on our server, no history on our server, no scheduled scans.
- No GitHub App installation scan yet. That connected read is on the roadmap, see `ROADMAP.md`.
- No runtime performance data.
- No blog posts published yet.

## The one rule that overrides all of these

A partial result is never a pass. Anything unchecked stays listed as not checked.