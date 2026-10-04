# Queue (night run). Coordinator takes the top UNSTARTED item, finishes it, commits, marks done, moves on.
# One unit at a time. Never wait for the operator. If a unit fails twice, mark DEFERRED + reason and take the next.

1. DONE  M1 ranking math module (commit 53c5c5c)
2. DONE  M2 five precision drafts (drafts/)
3. DONE  wave-full 05 (wave-full-05.md)
4. DONE  M1b maths scoring pass: 12 bands scored on local nimble (0-3 rubric, values 2.16-2.94), sample /tmp/opencode/maths-band-sample.json
5. DONE  wave-full 06 PHP/Ruby (wave-full-06.md, sheet written by a concurrent coordinator; I re-verified its 2 owner-queue rows against the clones and both hold)
6. DONE  wave-full 07 C/C++ (wave-full-07.md, 10/10, 1 clone-name fallback: yyjson-tldr/yyjson does not exist, ibireme/yyjson scanned instead)
7. DONE  wave-full 08 crypto/ML (wave-full-08.md, 10/10, WQ-3 real Django SECRET_KEY)
8. DONE  wave-full 09 infra (wave-full-09.md, 10/10, quietest wave, 1 high and it is a FP)
9. DONE  wave-full 10 mobile/other (wave-full-10.md, 10/10, 144 of 145 H/M are FPs from one credential-name defect, WQ-4)
10. DONE M4 monitoring query + coverage remainder (monitoring-reading.md, convex/decisionMonitoring.ts, .progress walk exclusion, OSV honesty line, 8 new tests, 393/393 suite green, tsc clean)
11. DONE M5 counts-only case drafts (cases/, 4 drafts + index, counts only, all totals reconcile)
12. TODO morning-report.md

## Feature-board work (from docs/feature-board.md, added 2026-10-05)

Rule: a `noted` row gets a PLAN only (never code, owner agreement first). A
`done` row gets an AUDIT (does the code actually do what the row claims).
Every audit cites the real file/line; a claim with no code is a defect.

13. DONE Audit done rows against code (feature-board-audit.md): 8 done rows, 6 TRUE 2 PARTIAL 0 FALSE, 4 cited fixes
    - Hosted MCP: two launches? caps, 2/hr + 8/hr, no login, no laptop repo.
    - Signed-in scan: 1000 files/8MB, token deleted on sign-out.
    - Policy text on files read: OR expression stays a choice.
    - Lockfile inventory: 50 OSV cap, not-checked count, install scripts named not run.
    - Registry facts: deps.dev then ClearlyDefined, Scorecard dated fact, offline = not checked.
    - Repeated functions/dead copies: 12-line hash, generated marker, duplicate files.
    - Deep local reads: vendored tree named, SBOM omissions, model card.
    - More code patterns: innerHTML, child_process, weak crypto, CORS wildcard ids.
    Output: per row TRUE / PARTIAL / FALSE with file:line, plus a fixes list.
14. DONE Write plans for noted rows (feature-board-plans.md), no code: 5 noted rows, each with what-it-is, seam, never-list, and owner decisions
    - 24/7 public-repo learner (needs a quota owner first, per the row).
    - Outreach bot (disclosure flow: CONTRIBUTING/security policy, person approves batch one).
    - Relationship questions.
    - Concepts node.
    - Giving the bots a computer (Grok Bot chosen; fallbacks noted).
    Each plan: what it is, the seam, the never-list, and what must be decided by
    the owner before code.
15. TODO Feature-board reconciliation: for each done row, is it TRUE *today* on
    the live deploy? Flag any row the code no longer backs (claim drift).


## Rules
- Commit after each unit. Append one status line to status.md with time + sha.
- Subagents: space-bunny-free, then openrouter/stealth/space-bunny-alpha, then
  ollama-cloud/deepseek-v4.1-flash. Local nimble/tev1 for maths.
- Observer every return. No push, no deploy, no keys, no private folders.
- Live severity to owner-queue.md first, shapes only.
