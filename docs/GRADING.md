# Grading the scanner's own findings

`scripts/grade-findings.mjs` turns archived scan JSON plus a local checkout into
a worklist where every row carries the real source line. A person signs each row
true, false, or noise. The script never signs one itself.

This is how you find out whether a check is true. It is not a feature a visitor
sees. It is the step between "the scanner reports a rule" and "the rule is
trustworthy".

## What it does

- Reads a directory of saved scan JSON files and a checkout for each scan.
- Prints one line per finding, with the file line above and below it.
- Masks secret-shaped literals, so a value never leaves the worklist, while the
  identifier around it stays readable.
- Counts what it could not read, each under its own status:
  `file-missing`, `line-out-of-range`, `unreadable`, `placeholder-path`,
  `no-checkout`, `forbidden-path`.

## What it does not do

- It never assigns true, false, or noise. A verdict needs a reader.
- It never adds or drops a row. Every finding in the input gets one output slot,
  so the totals always reconcile against the scan JSON.
- It never hides an ungraded row. An unreadable file is reported as unreadable,
  never as a pass.

Three defects it fixed in its own first pass, kept so they are not repeated:

1. Dedup kept the alphabetically first scan file, which was the copy with no
   checkout, turning 37 readable rows into `no-checkout`. It now keeps the copy
   that can be opened.
2. A clone that failed leaves an empty directory behind. Reading it reported
   every row as a missing file, blaming the repo for this machine's network. An
   empty directory is now not a checkout.
3. Masking every long quoted run hid URLs, SQL, and module names, which turned
   real rows into false verdicts. Only credential-shaped literals are masked.

## Run it

```
node scripts/grade-findings.mjs --evidence <dir> --map <map.json> [--repos <dir>] [--local <map.json>] [--forbid <prefix>]... [--out <file>]
```

- `--evidence` a directory of scan JSON files, each with a `findings` array.
- `--map` a JSON file of `{ "scans": { "<scanKey>": ["owner/repo", "<shortsha>"] } }`.
- `--repos` where the checkouts live, one directory per scan key. Default `.`.
- `--local` a JSON map of scan key to a checkout already on this machine.
- `--forbid` a path prefix never to read, repeatable. Empty by default, so the
  script carries no project name of its own. `.git/` and `node_modules/` are
  always refused.
- `--out` write the worklist JSON to a file instead of stdout.

## The tests

`tests/grade-findings-checks.mjs` holds the four ways this work goes wrong
quietly: a row that cannot be read treated as a row that was read, a row dropped
from the totals, a duplicate scan double counted, and a secret value carried into
the worklist. It runs in `npm run check`.
