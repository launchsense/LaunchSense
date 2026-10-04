# Feature-board audit: every `done` row against the code

Written 2026-10-05. Each `done` row in `docs/feature-board.md` is checked against
the real file and line. Verdicts are TRUE, PARTIAL, or FALSE. FALSE means the row
claims something the code does not do.

Rules for this audit:
- A row with no code behind it is a defect, not a style note.
- Every claim is cited to a file and line. No claim is accepted because it sounds
  right.
- A row is PARTIAL when the mechanism exists and a specific sub-claim does not.

## Summary

| Row | Verdict |
|---|---|
| Hosted MCP | PARTIAL |
| Signed-in scan | TRUE |
| Policy text on files we already read | TRUE |
| Lockfile inventory and transitive advisories | PARTIAL |
| Registry facts | PARTIAL |
| Repeated functions and dead copies | TRUE |
| Deep local reads | TRUE |
| More code patterns | TRUE |

6 TRUE, 2 PARTIAL, 0 FALSE. Every PARTIAL has a named defect at the end.

---

## 1. Hosted MCP - PARTIAL

Claims checked: the Connect page shows the address; a coding tool adds it; it does
not clone this repo; `launchsense_scan_public` reads one public repo; with the same
caps as the paste; `launchsense_get_report` reads a report by scan id; alpha has no
login; two scans an hour per caller and eight in total; it does not read a
laptop-only repo; it does not ask deps.dev; OSV stops at 50 packages; it does not
store raw file contents or raw secret values; a model may only reorder inside one
severity band.

**TRUE, with the code behind it:**

- The address is the deployed one, in `convex/mcpHttp.ts:4` and shown on the
  Connect page at `src/pages/Connect.tsx:3`.
- The same caps as the paste, named in the tool description itself at
  `convex/mcpHttp.ts:28`: "Same caps as the website paste: 200 files and about
  2MB." The caps themselves are `shared/scanCaps.ts:3-4`.
- "Does not read a repo that exists only on the caller laptop" is not a promise in
  prose only, it is the shape of the handler: `convex/http.ts:191` takes a
  `repoUrl` and nothing else. There is no path argument, so there is no local
  path to read.
- No login on the MCP route: `convex/http.ts:132` reads `x-forwarded-for` and
  calls the tool. No `getAuthUserId` anywhere in that route.
- The rate caps are exactly as written: `convex/mcpLimit.ts:5-6` set
  `CALLER_LIMIT = 2` and `GLOBAL_LIMIT = 8`, and `convex/http.ts:197` refuses
  with "This route is paused until the shared quota window resets."
- OSV stops at 50 packages: `convex/scans/analyze.ts:632` slices to 50.
- It does not store raw file contents: findings carry `ruleId`, `severity`,
  `title`, `path`, `line` at `convex/http.ts:213-219`. No content field.
- The model may only reorder inside one band: the whole ranking promise lives in
  `shared/reports/priority.ts`, and the board row matches what
  `convex/adapters/decision.ts:9-13` states about itself.

**Defect 1. The board names a tool that does not exist under that name.** The row
says `launchsense_scan_public`. That is the MCP-protocol name and it is correct in
`convex/mcpHttp.ts:26`. But the REST tools list at `convex/http.ts:21` advertises
`launchsense_scan_public_repo`, and the REST list at `convex/http.ts:35` advertises
`launchsense_explain_findings`, which does not exist in `mcpHttp.ts` at all. A
person reading the board and then calling the REST endpoint gets a name mismatch.
The board should name both routes separately.

**Defect 2. "It does not ask deps.dev" is true of the hosted MCP route but the
reason is not stated.** `convex/scans/analyze.ts:756` puts "registry freshness and
deps.dev metadata not checked" in the coverage note, so the claim holds and is
disclosed. No defect. Recording it because the board states it as a limit when it
is already a disclosed not-checked line.

**Not verified here:** whether the deployed route currently answers. This audit
reads code. It does not call the live endpoint.

---

## 2. Signed-in scan - TRUE

Every claim checked, all hold.

- Guest stays 200 files and about 2MB, signed-in is 1,000 files and about 8MB,
  download stops at 20MB: `shared/scanCaps.ts:3-7` defines exactly those four
  numbers, and `convex/scans/analyze.ts:261-262` selects between them on
  `signedRead`.
- "It does not read past 1,000 files or about 8MB" is enforced by the same two
  constants, not by a comment.
- "It does not keep the GitHub token after sign-out": the token is written at
  `convex/auth.ts:81-83` through `writeScanToken`, and the UI sign-out calls
  `clearGitHubToken` before `signOut` at `src/features/auth/TopMenu.tsx:32-35`.
  The delete is real, at `convex/github/sessionToken.ts:27-33`, which deletes the
  row rather than blanking a field.
- "It does not store raw file contents": the token table holds `userId`,
  `accessToken`, `updatedAt` only, `convex/github/sessionToken.ts:21`.
- The public query returns a boolean and never the token:
  `convex/github/sessionToken.ts:48-60` returns `hasGitHubToken`. The token itself
  is behind an `internalQuery` at line 35.
- The login asks for read-only scope: `convex/auth.ts:31` requests
  `read:user user:email`, and the file's own comment at line 10 explains why a
  write scope was refused.

No defect. This row is the most accurate on the board.

---

## 3. Policy text on files we already read - TRUE

- License family names and source-available names are read from text the review
  already has: `shared/analyzers/licenses.ts` reads file bodies, not just a
  manifest field, and the note is assembled from what it read.
- "An OR expression stays a choice": `shared/analyzers/licenses.ts:129` detects
  the `OR` form and line 173 writes "An OR expression is a choice, not both
  licenses at once." That is the claim, in the output.
- "Unknown stays unknown": `shared/review/registry.ts:106` writes "No reliable terms from deps.dev or ClearlyDefined. Unknown stays unknown."
- "A model may quote a next look. That quote is not a finding": the quote is
  produced in `mcp/review-entry.ts:228-234` and the rendered line at line 279 says
  "This quote is not a finding."
- "This is not a full SPDX grammar": true, and the row correctly says so rather
  than claiming coverage.

No defect.

---

## 4. Lockfile inventory and transitive advisories - PARTIAL

- "lists direct and transitive npm packages": TRUE, `shared/review/lockfile.ts:56`
  sets `depth` per package.
- "asks OSV about up to 50 of those exact versions and lists how many were not
  queried": TRUE for the local review, `mcp/review-entry.ts:164` slices to 50 and
  `shared/review/buildReport.ts` reports `advisories.skipped` in the not-checked
  box. TRUE for the website too: `convex/scans/analyze.ts:755` reports
  "OSV checked 50 packages, N unknown".
- "A missing lockfile stays incomplete": TRUE,
  `shared/review/buildReport.ts:320` forces `status = "partial"` when the
  inventory is not complete.
- "Install scripts are named and not run": TRUE,
  `shared/review/buildReport.ts:159-170` creates a finding whose `why` says "This
  review did not run it."
- "A deprecated flag and a publish date come from deps.dev": see Defect 3.
- "Archived status stays unknown": TRUE, and it is disclosed rather than assumed,
  `shared/review/buildReport.ts:225`.
- "The website OSV path still stops at 50 targets": TRUE,
  `convex/scans/analyze.ts:632`.

**Defect 3. The deprecated flag and the publish date never reach the website.**
`deps.deprecated` and the publish-date not-checked line are only produced in
`shared/review/buildReport.ts:198-213`, and `buildLocalReport` is called from one
place only: `mcp/review-entry.ts:321`. A grep for `lookupPackages` and `lookupOne`
across the repository returns `shared/review/registry.ts` and
`mcp/review-entry.ts` only. The hosted scan at `convex/scans/analyze.ts` never
calls the registry, and its coverage note says so at line 756. So on the website
there is no deprecated flag and no publish date at all. The row reads as a property
of "the alpha review", which the website also is. As written it over-claims for
the hosted path.

---

## 5. Registry facts - PARTIAL

- "When the review is online it asks deps.dev, then ClearlyDefined if that is
  empty": TRUE in the local path, `shared/review/registry.ts:82` hits deps.dev
  first and line 92 falls back to ClearlyDefined.
- "Scorecard is a dated fact when a GitHub repo is named": TRUE,
  `shared/review/registry.ts:123` and called at `mcp/review-entry.ts:334`. Note
  the finding goes into the not-checked box at `mcp/review-entry.ts:335`, not into
  the findings list. A dated fact is not a finding. That matches the row.
- "Offline, those stay not checked": TRUE,
  `mcp/review-entry.ts:315-317` passes null offline and
  `shared/review/buildReport.ts:192` writes "deps.dev and ClearlyDefined were not
  queried. Unknown stays unknown."
- "Not a score, and not a legal source": TRUE, the string "Not a legal source" is
  in the registry note at `shared/review/registry.ts:88`.

**Defect 4, the same seam as Defect 3.** Every part of this row is true of the
local review and true of nothing on the website. The row is written in the present
tense about "the review", which a visitor reads as the thing on the website. The
website never asks either registry. This is one defect seen from two rows, and the
fix is one sentence in each: say the row covers the local and alpha review, and
say the hosted scan discloses the registry as not checked.

---

## 6. Repeated functions and dead copies - TRUE

- "reports repeated 12-line function text": TRUE, `shared/review/extraChecks.ts:35`
  slices exactly 12 lines, and line 57 says "These two spans share the same 12-line
  token hash."
- "a generated marker on a large file": TRUE, `extraChecks.ts:146`.
- "duplicate files": TRUE, `extraChecks.ts:64`.
- "Dynamic import stays unknown": TRUE and it is the careful part.
  `extraChecks.ts:73` looks for `import(`, and line 85 says "Reachability is
  unknown" rather than claiming the copy is dead. When no dynamic import is seen,
  line 98 still says "This is not proof it is safe to delete."
- "This is not a quality score": consistent with every `why` string in the file.

No defect. The hedge language matches the code exactly.

---

## 7. Deep local reads - TRUE

- "can name a vendored tree it did not read": TRUE. The walk records a distinct
  reason for `vendor` and `third_party` at `mcp/review-entry.ts:87`, worded "Vendored
  tree was not read, so its notices were not checked."
- "a host it did not contact": TRUE, `shared/review/buildReport.ts:194` and 229
  name deps.dev, ClearlyDefined, and OSV as not contacted.
- "a lockfile SBOM with omissions": TRUE, `buildReport.ts:323-333` emits `tool`,
  `components`, and an `omissions` array naming the npm-only limit and the binary
  limit.
- "a model or dataset card": TRUE, `shared/review/extraChecks.ts:124`.
- "ScanCode is not included": TRUE, confirmed by a repository-wide search. The row
  is right to say so.

No defect.

---

## 8. More code patterns - TRUE

- "New findings use code.* ids. Old secret.* ids still score": TRUE.
  `shared/analyzers/codePatterns.ts:22-30` returns `code.inner-html`,
  `code.child-process`, `code.weak-crypto`, `code.cors-wildcard`, and
  `shared/policies/severity.ts` still lists `secret.` ids.
- "Added innerHTML, child_process exec, weak crypto, and a CORS wildcard": TRUE,
  the four rules at `codePatterns.ts:22, 23, 26, 29`.
- "SQL stays a shape, not a proved injection": TRUE, the `why` string in
  `shared/review/buildReport.ts:101` reads "That does not prove injection."

**One measured observation, not a board defect.** This audit also read every
reported line, and `code.eval-use` is registered but is not in this row's list of
added patterns. It is a real rule that fires correctly, in two repositories in
this set, on a shell-string eval and on a JavaScript eval across a Haskell
foreign-function boundary. The row is not wrong, it is incomplete. The board
lists what was added; eval was added too and is not named.

---

## Fixes list

Ordered by how much a reader would be misled.

1. **Hosted MCP, Defect 1.** Name both routes. The MCP protocol route advertises
   `launchsense_scan_public` and `launchsense_get_report`
   (`convex/mcpHttp.ts:26,38`). The REST tools list advertises
   `launchsense_scan_public_repo` and `launchsense_explain_findings`
   (`convex/http.ts:21,35`), and the second of those has no handler anywhere. The
   board should say which route each name belongs to, and `docs/feature-board.md`
   should not imply the REST list matches the protocol list.
2. **Registry facts, Defect 4.** Add one sentence: this row covers the local and
   alpha review. The hosted scan does not ask deps.dev or ClearlyDefined and says
   so in its coverage note.
3. **Lockfile inventory, Defect 3.** Same correction for the deprecated flag and
   the publish date. Both exist only in `buildLocalReport`, which only
   `mcp/review-entry.ts` calls.
4. **More code patterns, observation.** Add `code.eval-use` to the list of added
   patterns, or say the list is not exhaustive.

None of these four is a security hole. Three are a reader being told something is
available in the hosted product that is only available in the local one. The
fourth is an omission in the other direction, a real rule the board does not
mention.
