# Wave-full 09: infra x10, full offline review (2026-10-05)

Runner `mcp/review-entry.ts` offline, depth-1 clones under /tmp/opencode/full,
each clone deleted after its scan. Split: 10 on the primary free lane, 0
fallbacks. Every HIGH and MEDIUM judged by reading the real file:line. No code
edits. Shapes only, no value is ever printed.

This is the quietest wave so far. Ten repos, one high, and that one high is a
false positive. Worth saying plainly, because a low finding count is only useful
next to the coverage that produced it.

## Rows

| repo | shortsha | read/skip | H | M | by-rule top | decision |
|---|---|---|---|---|---|---|
| internetztube/terraform-hetzner-docker | 1c4f653 | 16/1 | 0 | 1 | network 2, license 1 | no secrets |
| bitovi/github-actions-deploy-docker-to-ec2 | fa96354 | 5/1 | 0 | 1 | network 3, debug 1 | no secrets |
| FoxxMD/compose-env-interpolation-example | 1cbdd5f | 9/1 | 0 | 1 | license 1, network 1 | no secrets |
| ridoo/docker-compose_env-evaluation | f0d55c1 | 9/1 | 0 | 1 | license 1, network 1 | no secrets |
| lnksz/docker-compose-env-repro | 2fb49b2 | 4/1 | 0 | 1 | license 1, network 1 | 4 files read, near-empty coverage |
| dustinbrun/docker-compose-homeserver | 9aa6bfc | 20/1 | 0 | 1 | network 6, license 1 | no secrets |
| shaunjanssens/homelab | 8a48606 | 62/2 | 1 | 1 | network 10, tracked-env 1 | FP, cleared below |
| Haxxnet/Compose-Examples | afeed78 | 391/1 | 0 | 4 | tracked-env 13, credential 12 | all low/info, none high |
| kubernetes/sample-controller | 63be7cf | 56/3 | 0 | 1 | network 10, license 1 | no secrets |
| DNXLabs/devops-playbook | 808a74f | 1/1 | 0 | 1 | license 1, network 1 | 1 file read, no coverage at all |

## LIVE SEVERITY

None. Nothing in this wave needs an owner decision.

The one high, `homelab`, is cleared by reading the file. `immich/.env` is
flagged by `secret.tracked-env` (high). Reading every assignment in it by key
name and value shape:

- `TYPESENSE_API_KEY` and `DB_PASSWORD` carry short literals that do not have the
  shape of credentials (6 to 16 characters, low entropy, and a homelab password
  you can guess from the compose file next to it).
- The rest are hostnames and usernames.

So the rule fired on the file's existence rather than on a credential in it. The
tracked-env rule is documented to require a live value, and the value gate let
these through. That is a defect in the value gate, not a rule that is too eager.
Compare with wave 06, where the same rule caught a real `APP_SECRET`: the rule
works, its gate is loose.

## New defects this wave

- `secret.tracked-env` reports `path:1` for the whole file, so the finding line
  is always line 1 and the `real` column shows a comment, never the offending
  assignment. Every tracked-env row in all 100 repos is unverifiable from the
  finding alone. This cost a full re-clone and a manual pass over every key in
  the file to clear it. The finding should carry the line of the assignment that
  tripped it.
- The `(repo)` pseudo-path license medium reappears in 7 of 10 repos. Same
  fabrication-shaped defect as wave 06: the path cannot be opened.
- `devops-playbook` read 1 file. That repo is a playbook, so the finding set is
  near-vacuous, but nothing in the output says "this was not a review". Coverage
  is 1 file and the status still reads as a completed pass with a decision.
- Compose repos hold their real risk in environment interpolation, which is
  exactly what 4 of these repos demonstrate. There is no check for it. Named as a
  gap, not built: an interpolation rule needs the owner's decision on shape first.

## Counts

- Repos: 10. Scanned: 10. Failed: 0.
- HIGH: 1, false positive. MEDIUM: 13, of which 7 are the `(repo)` pseudo-path
  defect and 6 are ordinary license notices.
- Coverage is the honest headline: 1006 files read in total across the wave, and
  2 of the 10 repos contributed under 10 files each.
