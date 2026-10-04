# Case draft 2: the same check, five language groups, and what each one breaks

Status: DRAFT. Not published. Counts only. No repository names, no paths, no
values.

## Why this case exists

Case 1 showed that three quarters of the high and medium rows were false positives.
This one asks a sharper question: is that rate the same everywhere? It is not, and
the difference is not random noise. It is a specific set of defects, and each one
lands on a specific kind of repository.

## Coverage by language group

50 repositories, grouped by the dominant language of the locked list.

| Group | Repos | Files read | High | Medium | High+medium rows |
|---|---|---|---|---|---|
| PHP and Ruby | 10 | 3,318 | 88 | 16 | 104 |
| C and C++ | 10 | 6,976 | 42 | 53 | 95 |
| Crypto and ML | 10 | 563 | 31 | 13 | 44 |
| Infrastructure | 10 | 573 | 1 | 13 | 14 |
| Mobile and other | 10 | 4,102 | 148 | 28 | 176 |
| **Total** | **50** | **15,532** | **310** | **123** | **433** |

The totals reconcile with case 1: 15,532 files, 310 high, 123 medium.

## The number that matters

Rows a person kept, per group:

| Group | Kept | Of rows | Rate |
|---|---|---|---|
| Infrastructure | 0 | 14 | 0% |
| Crypto and ML | 5 | 44 | 11% |
| PHP and Ruby | 11 | 104 | 11% |
| Mobile and other | 20 | 176 | 11% |
| C and C++ | 16 | 95 | 17% |

Read this carefully, because the naive version of the claim is wrong. **The
precision rate is roughly flat across four of the five groups, around 11%.** Only
infrastructure is different, and only because it produces so few rows in the first
place.

The real story is not that one language scores better. It is that the *volume of
noise* tracks how much framework and generated code a repository contains:

| Group | Noise rows produced | Per repository |
|---|---|---|
| Infrastructure | 4 | 0.4 |
| Crypto and ML | 29 | 2.9 |
| PHP and Ruby | 83 | 8.3 |
| C and C++ | 69 | 6.9 |
| Mobile and other | 146 | 14.6 |

An infrastructure repository, because it is mostly YAML and Docker files, produces
almost nothing at all. A mobile application produces 15 noise rows per repository.
Both get the same confidence in the output.

## What each group breaks

Every reported location was opened. Grouped by what the rule actually misread:

| What the rule saw | What it was | Rows |
|---|---|---|
| A name containing a credential word, followed by a receiver or attribute | An Android view binding, an XML attribute, a config key | 262 |
| A dotted identifier | A namespace path or an SDK schema type | (in the 262) |
| `eval()` on a model | A model switching to evaluation mode | 21 |
| innerHTML inside generated or vendored files | Generated documentation, a debug overlay library | 47 |

Two of these are language-specific and worth naming:

- **`model.eval()`** accounts for all 21 eval false positives and lands entirely
  in machine-learning repositories. `model.eval()` is the standard PyTorch call for
  evaluation mode. The rule matches the `eval(` shape without looking at the
  receiver, so it reports a code-execution risk where there is a model setting a
  flag.
- **Apple storyboard XML** accounts for 10 rows across two Flutter applications.
  `<autoresizingMask key="frame" widthSizable="YES">` is an interface-builder file,
  and the word `key` in an attribute name is the whole trigger.

## The honest summary

The headline precision rate is stable at around 11% across four language groups.
That is still a tool that is wrong seven times out of eight, and it is wrong for
one reason: **the rule reads a word in a line and assumes the line is about that
word.** Everything in this case is one defect wearing five different costumes.

The variation that matters to someone about to share a repository is volume, not
accuracy. Whether they see 1 noise row or 15 depends on how much framework
scaffolding their project has, and that is invisible in the output.

Publishing a single averaged precision number would hide all of this. The per-group
rows are the honest artifact.

## What this draft does not claim

- No language or group is characterised as better or worse code.
- No repository is named.
- These rates measure one tool, once, on 50 repositories. They are not a benchmark
  and not a score for anyone's work.
