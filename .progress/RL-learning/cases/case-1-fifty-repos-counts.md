# Case draft 1: what 50 public repositories looked like, by counts only

Status: DRAFT. Not published. A person decides whether any of this appears on the
website. Counts only: no repository names, no paths, no line numbers, no values,
nothing that identifies a project or its owner.

## The shape of the run

| | |
|---|---|
| Repositories reviewed | 50 |
| Public only, depth-1 clone at a pinned revision | yes |
| Files read | 15,532 |
| Files skipped and disclosed | 1,339 |
| Median files read per repository | 168 |
| Repositories where more than 20% of files were skipped | 6 |
| Coverage note read "partial" | 50 of 50 |

Coverage is the honest headline. 1,339 files were never read and every one of them
is named in a not-checked list. A partial result is not a pass, and this run never
called one a pass.

## Findings by severity

| Severity | Count |
|---|---|
| High | 310 |
| Medium | 123 |
| Low | 80 |
| Info | 728 |

## Every finding, by rule

| Rule | Count |
|---|---|
| Network hint | 405 |
| Credential pattern | 302 |
| Dead copy | 132 |
| Repeated function | 118 |
| innerHTML assignment | 73 |
| License policy | 50 |
| SQL pattern | 48 |
| Debug leftover | 30 |
| Eval use | 28 |
| Private key header | 20 |
| Tracked env file | 17 |
| Generated file | 14 |
| CORS wildcard | 2 |
| Child process | 1 |
| No README | 1 |

## What happened when a person opened every high and medium row

433 high and medium rows were produced. Every one was judged by opening the file
at the reported line.

| Outcome | Rows | Share of 433 |
|---|---|---|
| Kept: real, and correctly classified | 52 | 12% |
| License notice on a real file | 37 | 9% |
| License row pointing at a path that does not exist | 13 | 3% |
| False positive | 331 | 76% |

52 plus 37 plus 13 plus 331 is 433. Nothing is rounded and nothing is dropped.

### What the 331 false positives were

| Cause | Rows |
|---|---|
| The credential name gate matched a word inside a receiver, an attribute, or a dotted type name | 262 |
| innerHTML matched inside generated documentation or a vendored third-party tree | 47 |
| The eval rule matched `model.eval()`, which switches a machine-learning model to evaluation mode | 21 |
| The child-process rule matched a module import with no arguments | 1 |

262 of 331, nearly 80%, came from one defect. The rule asks whether a variable's
*name* contains a credential word, then takes whatever follows as its *value*.
Given `viewBinding.tvSendCode.setOnClickListener` it sees "code" in a name and a
method reference as a value, and reports a hardcoded credential. Given
`<autoresizingMask key="frame">` it sees an XML attribute. Given
`Components.Schemas.CreateResponse` it sees a type name.

### What the 13 unopenable rows are

A license finding reported its location as `(repo)` on line 1. There is no such
file. A reader who tries to check it cannot, so the row teaches nothing while
looking exactly like a result. This is a real rule emitting an unopenable
location, which is a different failure from a rule being imprecise.

### What the 52 kept rows were

| Kind | Rows |
|---|---|
| Committed signing keys, app secrets, and private key headers | 19 |
| innerHTML assignment in the project's own source, not generated or vendored | 26 |
| eval turning text into code, correctly high | 7 |

Not one of the 19 needed a clever detector. A committed key in a sample app, a
committed app secret, and private keys a project ships on purpose for its own test
suite, in most cases with a security file saying so. Every one was found by a
person opening the line, in seconds.

The 7 are the ones worth keeping the tool for. A backtick eval of a shell string in
a Ruby test helper, and a JavaScript eval across a Haskell foreign-function
boundary in a compiler runtime. Both high severity, both deserved it.

## The two numbers to lead with

- **1 in 8** high and medium rows survived a person opening the line. A tool that
  flags eight things and is right once is a tool people learn to ignore.
- **50 of 50** runs disclosed what they did not read.

The second number is what makes the first fixable. Every false positive above was
found by opening a line, and opening a line is cheap.

## What this draft does not claim

- It does not claim these repositories have these problems. It claims the tool
  produced these rows on these repositories. Those are different sentences.
- It does not claim any repository is safe, unsafe, or audited.
- It does not name any repository, file, or person.
- The 19 committed-key rows are not described here. Live-severity detail stays
  with the owner and never enters a publishable artifact.
