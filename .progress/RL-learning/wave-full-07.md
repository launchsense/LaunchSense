# Wave-full 07: C/C++ x10, full offline review (2026-10-05)

Runner `mcp/review-entry.ts` offline, analyzer `stage3.1`, depth-1 clones,
cleaned per wave. Split: 10 on space-bunny-free, no fallback needed. Every
HIGH and MEDIUM judged by reading the real file:line. No code edits. Shapes only.

## Rows

| repo | shortsha | files read/skip | leaks | code | deps | licenses | by-rule top | decision |
|---|---|---|---|---|---|---|---|---|
| DaveGamble/cJSON | 6d9f244 | 227/3 | 0 | L | I | M1 | credential 1 | fuzz fixture password, FP |
| yyjson-tldr/yyjson -> ibireme | 6447536 | 872/28 | 0 | L17 | I | M1 | inner-html 17 | doxygen localStorage, FP |
| Cyan4973/xxHash | 680bf46 | 96/7 | 0 | L | I | M1 | license 1 | BSD present, advice wrong |
| cesanta/mongoose | da82df2 | 806/324 | 1 tutorial key | L4 | I | M1 | credential 4, private-key 2 | WQ-4, pk_ public key FP |
| civetweb/civetweb | 588860e | 979/130 | 11 test keys | L4 | I | M1 | private-key 11 | WQ-3, registry key= FP |
| google/snappy | 9c28114 | 148/20 | 0 | L | I | M1 | license 1 | Apache present, advice wrong |
| lz4/lz4 | 0774d05 | 141/9 | 0 | L | I | M1 | license 1 | BSD present, advice wrong |
| json-c/json-c | dcd1572 | 104/5 | 0 | L | I | M1 | credential 2 | ## token paste, FP |
| hathach/tinyusb | c391fe9 | 723/32 | 0 | L2 | I | M1 | credential 12 | XML option key=, FP |
| septag/rizz | b52a7f8 | 348/101 | 0 | L18 | I | M1 | inner-html 18 | vendored remotery, FP |

Deps I = incomplete everywhere, no lockfile parser for these ecosystems, and
mongoose's 324 not-checked entries are mostly its Arduino tutorial images. Every
coverageNote says partial. yyjson URL 404s upstream, `ibireme/yyjson` used.

## LIVE SEVERITY (owner-queue.md, written first)

Four, all recorded in owner-queue.md before this sheet, shapes only.
WQ-3 civetweb/civetweb `588860e`, 11 committed private keys across
`resources/cert/` and `docs/OpenSSL.md:83`. Upstream `SECURITY.md:18` states
these are test-only and must never be used in production, so this is a pattern
to watch, not an incident.
WQ-4 cesanta/mongoose `da82df2`, one EC private key in
`tutorials/arduino/w5500-http/w5500-http.ino:81-84` inside a `TLS_KEY` macro.
Low-value tutorial key, same pattern.
Other 91 HIGH/MEDIUM in this wave are false positives.

## New defects this wave

- `code.inner-html` is now the top rule by volume, 41 rows across 3 of 10 repos,
  and every one is third-party or generated: vendored remotery debug console in
  rizz, Doxygen output in yyjson, and civetweb example strings that embed JS.
  Generated and `3rdparty` trees are being scanned as first-party source. New
  gap: no vendored-path demotion for `3rdparty/`, which is present but not in
  the SKIP set.
- C/C++ credential regex fires on `key=` as a Windows registry variable, on C
  preprocessor `##` token paste, and on XML `option key=` attributes. 21 false
  highs in 4 repos.
- civetweb `private-key` correctly found all 11 committed keys but gives them
  the same high as everything else, with no signal that upstream documents them
  as test material. Precision is right, ranking is not.
- `code.child-process` on `require('child_process')` is an import, not a spawn,
  yet it is high. Severity inflation on a language construct.
- TinyUSB ships `.agents/` and `.claude/` skill directories inside the repo, so
  agent instruction files are being scanned as source. Two duplicate highs from
  the same line in both copies.

## Fabrication flags

0. All 95 HIGH/MEDIUM verified present at the exact reported line across 10
repos. Cleanest wave so far on this check, 95 of 95.

## Integrity note

No sub-subagent was dispatched this wave. Judging was done directly against the
cloned files by the harness, which reads the real line and reports an absent
file or an out-of-range line rather than trusting the scan. The model ladder
was therefore not exercised; recording that rather than implying a split that
did not happen.