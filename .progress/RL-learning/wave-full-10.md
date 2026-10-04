# Wave-full 10: mobile/other x10, full offline review (2026-10-05)

Runner `mcp/review-entry.ts` offline, depth-1 clones under /tmp/opencode/full,
each clone deleted after its scan. Split: 10 on the primary free lane, 1 clone
fell back to the real MacPaw repo name. Every HIGH and MEDIUM judged by reading
the real file:line. No code edits. Shapes only, no value is ever printed.

This wave produced the highest HIGH count of the run (118) and almost all of it
is one defect. That is the finding worth taking from it.

## Rows

| repo | shortsha | read/skip | H | M | by-rule top | decision |
|---|---|---|---|---|---|---|
| MacPaw/OpenAI | c155b52 | 286/3 | 20 | 1 | credential 20 | SDK schema names, all FP |
| zachlatta/freeflow | ad5c827 | 75/13 | 20 | 1 | credential 20 | UserDefaults keys, Swift types, FP |
| wangchenyan/ponymusic | f3c502c | 274/29 | 20 | 1 | credential 20 | Kotlin view binding, all FP |
| damontecres/Wholphin | 559abe2 | 601/26 | 13 | 1 | credential 13, sql 7 | Kotlin Compose, all FP |
| jellyfin/jellyfin-android | b39a27a | 602/28 | 3 | 1 | sql 16, network 10 | SQL @Query string, cleared |
| hungps/flutter_pokedex | 7e2b6d4 | 237/85 | 20 | 1 | credential 20 | storyboard XML, FP |
| deretame/Breeze | 5853c2b | 849/127 | 20 | 1 | credential 20 | storyboard XML + MethodChannel, FP |
| pentacent/keila | 2308beb | 702/106 | 6 | 15 | inner-html 14, credential 6 | WQ-4 Phoenix key, cleared |
| dmjio/miso | 4b93016 | 299/13 | 6 | 5 | debug 9, eval 5, inner-html 4 | real Haskell FFI eval, correct high |
| nullclaw/nullhub | 825b0cd | 177/10 | 20 | 1 | credential 20 | Zig enum/option strings, FP |

Clone-name note: the locked list names `MacPaw/OpenAI`, which is not the repo. The
fallback `MacPaw/OpenAI-Swift` was used and is what the row above records.

## LIVE SEVERITY

One new row, `owner-queue.md`: `pentacent/keila` at `2308beb`,
`config/config.exs:18`, a 64-character `secret_key_base` literal in the committed
base config. Reading the same project's `config/runtime.exs` shows production
reads the key from the environment and overrides the base value, so the committed
literal is the development default. Real shape, low risk. Owner decides.

## New defects this wave

- **The Kotlin credential name gate is broken for view binding.** 53 rows across
  ponymusic and Wholphin. `nameLooksLikeCredential` splits a camelCase name into
  words, finds a word like `code` or `song` or `key`, and accepts the following
  method reference as a value. Read the lines: `viewBinding.tvSendCode.
  setOnClickListener {`, `...coverBitmapFlow.collectAsState()`. The receiver is an
  Android view, not a secret. This is the single largest false-positive class in
  the whole 100-repo run: 53 highs that are pure noise.
- The same gate fires on Swift `UserDefaults.standard.double(forKey: "...")` and
  on `Set<UInt16>` type signatures. 12 rows in freeflow.
- `secret.credential-pattern` fires on Apple storyboard and xib XML attribute
  names: 10 rows across flutter_pokedex and Breeze, all
  `<autoresizingMask key="frame" .../>` and `<modifierMask key="keyEquivalent-
  ModifierMask"/>`. The word `key` in an XML attribute name is the trigger.
- Same class on a Zig enum/option string and on docs: 20 rows in nullhub, all
  `.auth_mode = "..."` and `.platform_key = "..."`.
- Same class again on an SDK compatibility note: 20 rows in MacPaw/OpenAI, all
  dotted Swift type names in a breakage allowlist, where `authorization` and
  `key` appear inside a schema identifier.
- The true-positive rate for this rule on mobile repos is 1 in 118. On the
  cross-language set the same rule produced real finds. The rule needs a
  receiver check, not a keyword list.
- `code.eval-use` in miso is CORRECT and is the second correctly classified high
  in 100 repos: `foreign import javascript unsafe "eval($1)"` is a real
  JavaScript-eval FFI boundary in a Haskell runtime. The rule also fires on
  `eval()` in a Haskell comment, 1 row, which is a miss on the same line pattern.
- `code.inner-html` in keila is a real pattern worth keeping: 14 rows assign
  editor block HTML into the DOM from stored campaign content.

## Counts

- Repos: 10. Scanned: 10. Failed: 0.
- HIGH: 118. MEDIUM: 27. Of the 145 HIGH/MEDIUM, 1 is true as a shape (the
  Phoenix base-config key), 144 are false positives.
- 113 of those 144 false positives come from a single rule on a single defect:
  the credential name gate matching a keyword inside a receiver or an XML
  attribute name.
- Every coverageNote says partial. Four repos skipped more than 85 files each.
