# Contributing to LaunchSense

One maintainer, no legal department, so the process is small and written down.

## Sign-off, not a CLA

There is no Contributor License Agreement. Every commit carries a
`Signed-off-by: Your Name <you@example.com>` trailer instead, which is the
Developer Certificate of Origin 1.1 (https://developercertificate.org/).
Sign with `git commit -s`. A pull request without the trailer on every commit
is not merged. The trailer is the record; there is no separate registry, and
no email database is kept.

The automated builds this operator runs (signed `launchsense-night`) act for
the copyright holder, and their output belongs to the holder.

## Know which licence zone you touch

`LICENSE.txt` names the MIT paths and the proprietary remainder. Check before
you write: a rule, a doc, or a test that imports a proprietary module cannot
ship under MIT. The three test files that verify proprietary surfaces are
named in the licence and stay proprietary. New files default to the zone of
their directory.

## Rules have a convention

A new check needs a stable rule id, a severity from `shared/policies/severity.ts`
(never invented per rule), and a precision test that proves it fires on the
real shape and stays quiet on prose. The corpus harness is the bar every
pattern must clear before it becomes a template.

## The full suite needs the monorepo

The open test subset passes standalone. Tests that read proprietary files as
text need the whole checkout. That is documented, not hidden.

## Trademark

Do not use LaunchSense as a product name and do not imply endorsement. See
`LICENSE.txt` Section 5.
