# Wave-full 08: crypto/ML x10, full offline review (2026-10-05)

Runner `mcp/review-entry.ts` offline, depth-1 clones under /tmp/opencode/full,
each clone deleted after its scan. Split: 10 on the primary free lane, 0
fallbacks. Every HIGH and MEDIUM judged by reading the real file:line. No code
edits. Shapes only, no value is ever printed.

## Rows

| repo | shortsha | read/skip | H | M | by-rule top | decision |
|---|---|---|---|---|---|---|
| abailey81/Regime-Switching-Risk-Parity-Crypto-Index-Vault | ad75937 | 60/3 | 1 | 3 | network 8, debug 3, credential 1 | `.env.example` placeholders, cleared |
| albertobas/zk-connect-four | 7a75269 | 134/18 | 3 | 1 | network 10, debug 3, eval 2 | `model.eval()` FP, `.zkey` path FP |
| mohin-io/Decentralized-Autonomous-Hedge-Fund-AI-DAO | 8dbc75d | 144/21 | 10 | 1 | network 10, eval 5, credential 5 | CORS header names in vercel.json, docs FP |
| bhagvatgiri/exploit-gym | c4c683e | 41/3 | 6 | 1 | eval 6, repeated-fn 5 | `model.eval()` FP, markdown FP |
| redDwarf03/zk-latent-bridge | 4884517 | 12/1 | 1 | 1 | network 3, debug 1, eval 1 | `model.eval()` FP, 12 files read |
| AmirhosseinHonardoust/Onchain-Security-Suite | b0febd0 | 24/2 | 0 | 1 | network 2, license 1 | no highs |
| chainstacklabs/web3-ai-trading-agent | ffcc1c3 | 40/2 | 5 | 1 | network 10, eval 4 | README placeholder key, cleared |
| opentensor/validators | 9e2172f | 63/1 | 0 | 1 | network 10, license 1 | clean repo |
| mwritescode/smart-contracts-vulnerabilities | d755f0f | 25/5 | 2 | 1 | network 5, eval 2 | `model.eval()` FP, notebook FP |
| dharmpatel28/Ethereum-Price-Prediction | 3a1f919 | 20/7 | 3 | 2 | credential 3, network 2, eval 1 | WQ-3 real Django SECRET_KEY |

## LIVE SEVERITY

One new row, `owner-queue.md`: `dharmpatel28/Ethereum-Price-Prediction` at
`3a1f919`, `eth_prediction/settings.py:23`, a 66-character `SECRET_KEY` literal
with the standard `django-insecure-` prefix, committed. The same file sets
`DEBUG = True` and `ALLOWED_HOSTS = []`, which is a development configuration,
so the shape is real and the real-world exposure is unproven. Owner decides.

Cleared by reading the file, so they are not re-reported:
- `Regime-Switching...Vault`, `.env.example:12` and `:15`. Two keys
  (`DEPLOYER_PRIVATE_KEY`, `ETHERSCAN_API_KEY`) whose values are 31 and 22
  characters of underscore-separated lowercase words. Placeholder-shaped, in a
  file whose whole purpose is to hold placeholders.
- `web3-ai-trading-agent`, `README.md:215`. A 24-character key literal with the
  line's own trailing comment saying to replace it.

## New defects this wave

- **`code.eval-use` fires on PyTorch `model.eval()`. 19 rows across 6 repos.**
  The rule matches the `eval(` call shape without checking the receiver. In
  machine-learning code `model.eval()` sets evaluation mode and is the opposite of
  a code-execution risk. This is the single worst false-positive class found in
  100 repos: it is high severity, it is trivially recognisable, and it makes a
  whole category of repo look dangerous. Highest-value fix on the list.
- The same rule fires on `from eval import ...` in prose and on a markdown line
  containing the word `eval(` in a timing note. Two more rows in exploit-gym.
- `secret.credential-pattern` fires on HTTP header NAMES in a Vercel config:
  `"key": "Access-Control-Allow-Origin"` and two siblings. The rule reads any
  `key:` pair as a credential. Three rows.
- The one TP the wave produced was nearly lost. `SECRET_KEY = '...'` did not
  match the old masker, because the name contains `SECRET` with a suffix. The
  value printed into a session before the masker was widened. Recorded in
  `owner-queue.md` so the owner knows it is on this machine's session logs.

## Counts

- Repos: 10. Scanned: 10. Failed: 0.
- HIGH: 31. MEDIUM: 12. Of the 43 HIGH/MEDIUM, 1 is true as a shape, 42 are
  false positives, and 19 of those 42 are the single `model.eval()` class.
- Every coverageNote says partial. Three repos read under 30 files, so their
  "no highs" is weak coverage, not a clean bill. zk-latent-bridge read 12 files.
- Deps: 2 repos reported a real lockfile package count (565 and 577). The rest
  name npm as the missing ecosystem while the repo is Python.
