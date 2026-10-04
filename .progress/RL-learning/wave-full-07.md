# Wave-full 07: C/C++ x10, full offline review (2026-10-05)

Runner `mcp/review-entry.ts` offline, depth-1 clones under /tmp/opencode/full,
each clone deleted after its scan. Split: 9 on the primary free lane, 1 repo
needed a clone-name fallback (see the table). Every HIGH and MEDIUM judged by
reading the real file:line. No code edits. Shapes only, no value is ever printed.

## Rows

| repo | shortsha | read/skip | H | M | by-rule top | decision |
|---|---|---|---|---|---|---|
| DaveGamble/cJSON | 6d9f244 | 227/3 | 1 | 1 | network 10, dead-copy 9, credential 7 | fuzz JSON `dataStorePassword` field name, license real |
| ibireme/yyjson (listed as yyjson-tldr/yyjson) | 6447536 | 872/28 | 3 | 18 | inner-html 17, dead-copy 20, credential 3 | doxygen third-party JS only, FP |
| Cyan4973/xxHash | 680bf46 | 91/4 | 0 | 1 | network 10, license 1 | clean repo, license medium |
| cesanta/mongoose | da82df2 | 1711/321 | 7 | 4 | repeated-fn 20, dead-copy 20, generated 10 | 1 EC key header + docs `password`/`token` var names |
| civetweb/civetweb | 588860e | 405/127 | 17 | 4 | private-key 11, repeated-fn 10, credential 6 | 9 RSA/EC test cert keys, docs FP |
| google/snappy | 9c28114 | 38/17 | 0 | 1 | network 10, license 1 | clean repo, license medium |
| lz4/lz4 | 0774d05 | 161/6 | 0 | 1 | network 10, repeated-fn 2 | clean repo, license medium |
| json-c/json-c | dcd1572 | 204/2 | 2 | 1 | network 10, dead-copy 3, credential 2 | C macro token-paste `##key`, FP |
| hathach/tinyusb | c391fe9 | 2718/29 | 12 | 3 | repeated-fn 20, dead-copy 20, credential 14 | XML `<option key=...>` attributes, FP |
| septag/rizz | b52a7f8 | 549/98 | 0 | 19 | inner-html 18, repeated-fn 13 | all 18 innerHTML in vendored remotery debug UI |

Clone-name note: the locked list names `yyjson-tldr/yyjson`, which does not exist
on GitHub. Two known alternates (`icyfox/yyjson`, `yyjson/yyjson`) were also
checked and are not found. The upstream project is `ibireme/yyjson`, which is what
was scanned. Recorded, not silently swapped.

## LIVE SEVERITY

One family, in `owner-queue.md`: 13 committed private-key block headers across
civetweb (9 RSA plus 2 EC) and the mongoose tutorials (1 EC). Real key material
on disk, but these are the demo certificates the projects ship so their TLS
examples run. The owner decides. No value or key body was read or copied.

## New defects this wave

- `code.eval-use` does NOT fire in this wave, but `secret.credential-pattern`
  fires on C preprocessor token pasting: `entry##key = entry_next##key` in
  `json_object.h:507` and `:521`. The `##` operator reads as a secret name.
- `secret.credential-pattern` fires on XML attribute names in firmware board
  config: 14 rows in tinyusb, all `<option key="#TargetName#" .../>`. The literal
  `key=` with a hash-delimited target is the trigger.
- `code.inner-html` counts generated doxygen output as project code: 17 rows in
  yyjson, all under `doc/doxygen/html/`. Generated documentation should be
  skipped by name, the way `vendor` already is.
- Same inner defect in a vendored tree: 18 rows in rizz, all under
  `3rdparty/remotery/`. The walk skips `vendor` and `third_party` but not
  `3rdparty`, so a real vendored library was walked anyway.
- `code.child-process` at `mongoose/resources/watch.js:4` is `require(
  'child_process')`, a module import with no arguments. Correct rule, wrong
  precision: the shape is a dev script spawning a build watcher.
- License rule still emits the `(repo)` pseudo-path. 5 repos in this wave carry
  the LICENSE medium on a real file (cJSON, xxHash, snappy, lz4, json-c) and the
  wave-06 defect of a non-existent path does not recur here.

## Counts

- Repos: 10. Scanned: 10. Failed: 0.
- HIGH: 42. MEDIUM: 39. Of the 81 HIGH/MEDIUM, 13 are true as a shape
  (private-key headers), 68 are false positives.
- Every coverageNote says partial. Not-checked rows are in the wave JSON.
- Largest single FP class: credential-pattern on `key=` XML and C macro syntax,
  16 rows.
