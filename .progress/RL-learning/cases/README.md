# Cases index

Counts-only case drafts, for a person to decide what becomes public. Nothing here
is published and nothing here is a finding about anyone's repository.

Rules every case obeys:
- Counts only. No repository name, no file path, no line number, no secret value.
- No claim that a named project is safe or unsafe. The unit of evidence is a tool
  run over a tree, not a judgement about a project.
- Partial is stated as partial, in every case.
- Unknown stays unknown. Where a number does not exist, the case says so instead
  of estimating.

| Case | What it argues | Status |
|---|---|---|
| `case-1-fifty-repos-counts.md` | 433 high and medium rows, 52 survived a person opening the line. 80% of the false positives came from one defect. | DRAFT |
| `case-2-language-precision.md` | Precision is flat at about 11% across four language groups. Noise volume is what varies, 0.4 to 14.6 rows per repository. | DRAFT |
| `case-3-coverage-honesty.md` | 50 of 50 runs reported partial and named every skipped file. Five repositories contributed 28 files between them. | DRAFT |
| `case-4-unmeasured-ranking.md` | The ranking lane has zero recorded calls. Unknown, not bad. Four metrics the monitoring query refuses to invent. | DRAFT |

## What is deliberately absent from all four

- Live-severity detail. The committed signing keys and app secrets found in this
  run are described by shape and count only, and live in the owner queue.
- Any vendor benchmark presented as evidence for this product's use. General
  benchmark scores are about general benchmarks.
- Any single averaged precision number, because the average hides the variation
  that matters.
