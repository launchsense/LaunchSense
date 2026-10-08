# How a scan works

LaunchSense checks the codebase, not the business. It does not say if the app will sell. It looks for problems you have no name for, says what is wrong, and gives a prompt you can paste.

## What you can scan

Your repo on your machine, public or private, through your coding tool. No hourly limit. Nothing is uploaded unless you opt in to anonymous counts.

## The first minute

1. Clone this repo and run `./install.sh` from its root. Answer its two questions.
2. Paste the setup prompt into Cursor, Claude Code, or Codex with your repo open.
3. Ask it to audit the repo. Copy the top 3 prompt into your coding helper.
4. Fix what it says, then ask for another review. Accepted findings go in `.ls/policy.yaml` with a reason, so they are not raised again.

## The steps

1. Your tool runs the local review against your working tree, including work you have not committed.
2. Fixed checks run: secrets, risky patterns, dependencies, licenses, and hygiene.
3. You get one fix prompt for the top 3, then the rest of the list.
4. The not-checked list goes back line for line. A partial result is never a pass.

## What runs and what does not

The checks are fixed code, so the same input always gives the same findings. Explanations in plain words are written separately, by an AI provider when one is configured. AI only rewrites findings in plainer language. It never decides what is a finding, and its output is thrown away if it references anything we did not check.

It never decides a severity, a licence fact, consent, who a caller is, or whether a request is allowed either. Those are fixed code. Its `humanOversightLevel` is `prompt_guided` in C2PA Technical Specification 2.4 terms: a person asked for the output and nobody approved it afterwards. That vocabulary is borrowed, not conformed to.

## After you fix things

Ask for another review. Accepted findings in `.ls/policy.yaml` are not raised again. Every other finding is checked fresh. Unknown never becomes fixed.

## How much it costs, and what we tell you

File contents are read in memory on your machine and never uploaded. Per-file metadata stays on your machine in `.ls/reports`.

Plain words used in the app:

- Partial means some work was skipped. A partial result is never a pass.
- Evidence means the proof behind a finding: file, line, and a redacted snippet.
- Fingerprint means the stable ID of a finding. It stays the same when lines shift.
