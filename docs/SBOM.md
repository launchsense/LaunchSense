# The SBOM

A CycloneDX 1.7 document, generated from the same licence inventory the notice file
reads. Same lockfile in, byte-identical document out.

```
npm run sbom                                   prints to stdout
npm run sbom -- --out sbom.cdx.json            writes the file
npm run sbom -- --out sbom.cdx.json --generated-at 2026-10-06T00:00:00Z
```

CycloneDX is ECMA-424. Two fields are required: `bomFormat` and `specVersion`. A
`serialNumber` as a `urn:uuid` and a `version` are strongly recommended. That is a low
bar, which is the reason this format was chosen: a tool we already have data for can
emit a document other people already read.

The input is `package-lock.json`, read through `shared/licensing/dependencies.ts`, the
same reader `npm run notices` uses. It never makes a request. What a registry says
today is a different fact and is not read.

## What the document contains

- One component per installed package, keyed by name and version, with a package URL.
  A scoped name keeps its scope percent-encoded, so `@auth/core` is
  `pkg:npm/%40auth/core@0.41.3` and cannot collide with another package.
- The licence each package declares, as an SPDX id. `MIT AND Apache-2.0` stays one
  expression so both terms survive. A deprecated id such as `GPL-2.0` keeps the id and
  is marked deprecated, because rewriting it into `-only` would assert a choice the
  string does not make.
- Depth, dev flag, and which declaration was read, as properties.
- `compositions` with `aggregate: incomplete`, because this repository's lockfile
  covers npm and nothing else.
- The gaps, as properties: ecosystems not read, no hashes, no dependency graph, no
  timestamp.

## The four places a generated SBOM usually lies

**No clock.** `metadata.timestamp` is emitted only when the caller passes a real build
time with `--generated-at`. A generator that stamped `Date.now()` would produce
different bytes for the same lockfile, and comparing two builds is the whole reason to
have an SBOM. Without a build time the field is absent, which the specification
allows, and `launchsense:sbom:timestamp` says why.

**No hashes.** A hash is a statement about a specific artefact. No package tarball is
downloaded or hashed here, so there is no artefact and no `hashes` array. The lockfile
does carry an `integrity` value per entry; emitting it as a CycloneDX hash would claim
we verified a tarball we never fetched. The absence is stated in
`launchsense:sbom:hashes`.

**No dependency graph.** The licence inventory carries name, version, depth, dev, and
licence. It carries no edges. A `dependencies` array would have to say `dependsOn: []`
for every transitive package, which reads as "depends on nothing" and is false. The
array is omitted and `launchsense:sbom:dependency_graph` names the omission. A consumer
that needs edges should read the lockfile, where they are.

**No random serial number.** `serialNumber` is a content-derived UUID, so the same
lockfile gives the same document identity and a different lockfile gives a different
one.

## Unknown is not a licence

A package whose licence could not be read is written as the name `Unknown` with a
property giving the reason, never as an invented id. A choice such as
`MIT OR Apache-2.0` is written as the expression it is, with a property saying that the
licence that applies is the one a person chooses. A proprietary `UNLICENSED` marker is
written as the name `LicenseRef-Proprietary-UNLICENSED`, because it is a real SPDX
document identifier and not a member of the SPDX id list, and writing it as an `id`
would name an id that does not exist.

## What this document is not

It is not a clearance and it is not legal advice. It says what each dependency
declares. Whether any obligation applies to how you ship is a person's decision, and
`docs/PRIVACY.md` section 9 and the notice file both say the same.

## What this repository does not do with it

The generated document is not committed. This repository's own SBOM is 316 components
read from 348 lockfile entries, and every one of those facts is already in
`package-lock.json`. A committed copy would drift from that lockfile on every
dependency change, which is exactly the failure an SBOM exists to prevent. Run
`npm run sbom` when you need one.

## What this lane did not build

- **`hashes`**, for the reason above. A real SBOM with digests needs the tarballs.
- **A dependency graph**, because the inventory carries no edges.
- **An `externalReferences` entry per component.** This document describes packages
  from a lockfile, and pointing at a registry page per component would be hundreds of
  links we cannot verify offline.
- **Vulnerabilities.** CycloneDX carries a `vulnerabilities` array and OSV answers are
  already read into the scan. Wiring those together is a change to the scan lane, not
  to this generator, and it is not here.
- **A signature.** CycloneDX has a JSF signature block. Signing needs a key this
  repository does not hold.