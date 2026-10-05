// Deterministic license signals. Reports what was found and maps it to a
// review policy. This is not legal advice; copyleft and missing licenses
// always need a human decision before sharing.

export type LicensePolicy =
  | "Allowed"
  | "Review required"
  | "Not recommended"
  | "Unknown"
  | "Not checked";

/** What a licence policy allows us to do with the code it covers. */
export type LicenseUsage = "mirror" | "reference-only" | "unknown";

export interface LicenseResult {
  detected: string[];
  files: string[];
  packageLicense: string | null;
  policy: LicensePolicy;
  /** What this policy allows us to do with code we bring into our own tree. */
  usage: LicenseUsage;
  note: string;
}

const LICENSE_MARKERS: Array<{ id: string; pattern: RegExp }> = [
  { id: "MIT", pattern: /\bmit license\b|permission is hereby granted, free of charge/i },
  { id: "Apache-2.0", pattern: /apache license[^]*version 2\.0|licensed under the apache license/i },
  { id: "GPL-3.0", pattern: /gnu general public license[^]*version 3/i },
  { id: "GPL-2.0", pattern: /gnu general public license[^]*version 2/i },
  { id: "AGPL-3.0", pattern: /affero general public license/i },
  { id: "LGPL", pattern: /lesser general public license/i },
  { id: "MPL-2.0", pattern: /mozilla public license,? (?:v(?:ersion)? )?2\.0/i },
  { id: "BSD-3-Clause", pattern: /bsd 3-clause|redistribution and use in source and binary forms[^]*neither the name/i },
  { id: "BSD-2-Clause", pattern: /bsd 2-clause|redistribution and use in source and binary forms/i },
  { id: "ISC", pattern: /isc license|permission to use, copy, modify, and\/or distribute this software/i },
  { id: "Unlicense", pattern: /the unlicense|this is free and unencumbered software released into the public domain/i },
  { id: "CC0-1.0", pattern: /cc0 1\.0|creative commons zero/i },
  { id: "BUSL-1.1", pattern: /business source license/i },
  { id: "SSPL-1.0", pattern: /server side public license/i },
  { id: "Commons-Clause", pattern: /commons clause/i },
  { id: "Prosperity", pattern: /prosperity public license/i },
  { id: "Elastic-2.0", pattern: /elastic license 2\.0/i },
];

const SIGNAL = "Signal, not legal advice.";

export type ExpressionOperator = "single" | "and" | "or";

export interface LicenseExpression {
  /** The declaration exactly as written, so the exact id is never lost. */
  verbatim: string;
  /** Base ids, with any `WITH <exception>` tail removed. Obligations use these. */
  licenses: string[];
  /** Exception ids named after WITH. An exception changes the terms. */
  exceptions: string[];
  operator: ExpressionOperator;
}

/**
 * Read one declared string as an SPDX expression. `MIT AND Apache-2.0` is two
 * licences that both apply, `MIT OR Apache-2.0` is a choice, and
 * `Apache-2.0 WITH LLVM-exception` is one licence with changed terms. Reading
 * the literal string as one opaque id made the first read as Allowed and lost
 * the Apache obligations entirely.
 *
 * Exported because a dependency's declared licence is parsed by exactly the same
 * grammar. A second parser here would drift from this one, and the two would
 * disagree about what `MIT OR Apache-2.0` means.
 */
export function parseExpression(declared: string): LicenseExpression {
  const verbatim = declared.trim();
  const body = verbatim.replace(/^\(+/, "").replace(/\)+$/, "").trim();
  const sawAnd = /\sAND\s/.test(` ${body} `);
  const sawOr = /\sOR\s/.test(` ${body} `);
  const licenses: string[] = [];
  const exceptions: string[] = [];
  for (const token of body.split(/\s+(?:AND|OR)\s+/)) {
    const parts = token.replace(/^\(+/, "").replace(/\)+$/, "").trim().split(/\s+WITH\s+/);
    const base = (parts[0] ?? "").trim();
    if (base.length > 0 && !licenses.includes(base)) licenses.push(base);
    for (const tail of parts.slice(1)) {
      const name = tail.trim();
      if (name.length > 0 && !exceptions.includes(name)) exceptions.push(name);
    }
  }
  const operator: ExpressionOperator = sawAnd ? "and" : sawOr ? "or" : "single";
  return { verbatim, licenses, exceptions, operator };
}

/**
 * Record a declared expression. The verbatim string always goes in, so the exact
 * id survives for the reader. Base ids go in as well for a single licence, an AND
 * set, or a WITH expression, because those are the ids the obligations are written
 * against: `MIT AND Apache-2.0` still owes the Apache NOTICE, and the base id is
 * what makes that obligation visible. An OR set keeps only the verbatim expression,
 * because OR is a choice and the licence picked decides the obligation. Reporting
 * an obligation the reader may not owe is its own kind of wrong signal.
 */
function addDeclaration(detected: Set<string>, expression: LicenseExpression): void {
  detected.add(expression.verbatim);
  if (expression.operator === "or") return;
  for (const id of expression.licenses) detected.add(id);
}

/** One manifest's declaration, kept with the file it was read from. */
interface ManifestDeclaration {
  source: string;
  license: string;
  expression: LicenseExpression;
}

function npmDeclaredLicense(content: string): string | null {
  try {
    const data = JSON.parse(content) as unknown;
    if (typeof data === "object" && data !== null) {
      const lic = (data as Record<string, unknown>)["license"];
      if (typeof lic === "string" && lic.trim().length > 0) return lic.trim();
    }
  } catch {
    // Unparseable manifest: no license signal from it.
  }
  return null;
}

/** A Rust crate declares its licence in Cargo.toml. */
function cargoDeclaredLicense(content: string): string | null {
  const m = /^license\s*=\s*"([^"]+)"/m.exec(content);
  return m !== null && m[1] !== undefined ? m[1].trim() : null;
}

/** A Python project declares its licence in pyproject.toml. */
function pythonDeclaredLicense(content: string): string | null {
  const m = /license\s*=\s*["']([^"']+)["']/.exec(content);
  return m !== null && m[1] !== undefined ? m[1].trim() : null;
}

/**
 * Every manifest in the read, not the first one the array happened to carry.
 * `files.find` read one manifest per family, so the licence verdict of a whole
 * repository depended on the caller's array order: a monorepo read as licensed
 * or unlicensed depending on which file the host listed first. Sorted by path,
 * so the facts and the verdict come out the same either way.
 *
 * Rust and Python manifests are read as equal sources to package.json, not as
 * fallbacks. Ignoring them is why every Rust crate read as unlicensed.
 */
function manifestDeclarations(files: Array<{ path: string; content: string }>): ManifestDeclaration[] {
  const out: ManifestDeclaration[] = [];
  for (const file of files) {
    const base = file.path.split("/").pop() ?? file.path;
    let declared: string | null = null;
    if (base === "package.json") declared = npmDeclaredLicense(file.content);
    else if (base === "Cargo.toml") declared = cargoDeclaredLicense(file.content);
    else if (base === "pyproject.toml") declared = pythonDeclaredLicense(file.content);
    if (declared === null) continue;
    out.push({ source: file.path, license: declared, expression: parseExpression(declared) });
  }
  return out.sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
}

function noticeSentence(found: string[], files: Array<{ path: string }>): string {
  if (!found.includes("Apache-2.0")) return "";
  const hasNotice = files.some((file) => {
    const base = (file.path.split("/").pop() ?? "").toUpperCase();
    return base === "NOTICE" || base.startsWith("NOTICE.");
  });
  return hasNotice
    ? " Apache-2.0 was found, and a NOTICE file was in this read."
    : " Apache-2.0 was found. No NOTICE file was in this read.";
}

/**
 * State what the manifests said, as facts. A repository with more than one
 * manifest has no single declared licence to state, so every declaration is
 * named instead of the first one read being taken as the answer.
 */
function declarationSentence(
  declarations: ManifestDeclaration[],
  distinct: string[],
): string {
  if (declarations.length === 0) return "";
  const listed = declarations.map((d) => `${d.source} says ${d.license}`).join(", ");
  if (distinct.length > 1) {
    return ` The manifests read do not agree on one licence, so each is its own fact: ${listed}.`;
  }
  if (declarations.length > 1) {
    const where = declarations.map((d) => d.source).join(", ");
    return ` ${distinct[0]} is declared in ${declarations.length} manifests read: ${where}.`;
  }
  return "";
}

/**
 * State a declared licence and the licence files as two separate facts. The
 * sentence names the manifest that was actually read. A Cargo-only repo has no
 * package.json, so saying "package.json says ..." there is not a wording choice,
 * it is a false source.
 */
function mismatchSentence(
  manifestSource: string | null,
  packageLicense: string | null,
  fileDetected: ReadonlySet<string>,
): string {
  if (packageLicense === null || fileDetected.size === 0) return "";
  const aligned = [...fileDetected].some((id) => id.toLowerCase() === packageLicense.toLowerCase());
  if (aligned) return "";
  const source = manifestSource ?? "the manifest";
  return ` Two facts: ${source} says ${packageLicense}. The license files read say ${[...fileDetected].join(", ")}.`;
}

/**
 * A licence file basename. Repositories spell it every way: `LICENSE`,
 * `LICENSE.md`, `LICENSE-MIT`, `MIT-LICENSE`, `LICENCE`, `COPYING.md`. A basename
 * that is not matched here is read and then thrown away, which loses the licence
 * signal and leaves the finding with no licence path at all.
 * NOTICE is accepted because Apache-2.0 needs its companion file read too.
 */
function isLicenseFile(path: string): boolean {
  const base = (path.split("/").pop() ?? path).toUpperCase();
  if (base === "NOTICE" || base.startsWith("NOTICE.")) return true;
  if (base === "COPYING" || base.startsWith("COPYING.")) return true;
  for (const word of ["LICENSE", "LICENCE"]) {
    if (base === word) return true;
    if (base.startsWith(`${word}.`) || base.startsWith(`${word}-`)) return true;
    if (base.endsWith(`-${word}`)) return true;
  }
  return false;
}

/** A licence file at the repo root. NOTICE is a companion file, not the licence. */
function isRootLicenseFile(path: string): boolean {
  if (path.includes("/")) return false;
  const base = path.toUpperCase();
  if (base === "NOTICE" || base.startsWith("NOTICE.")) return false;
  return isLicenseFile(path);
}

interface PolicyContext {
  found: string[];
  filesFetched: boolean;
  rootLicenseRead: boolean;
  rootLicenseMatched: boolean;
  suffix: string;
  declarations: ManifestDeclaration[];
  conflicting: boolean;
}

/** The policy ladder, in evaluation order. Each branch states one reason. */
function decidePolicy(ctx: PolicyContext): { policy: LicensePolicy; note: string } {
  const found = ctx.found;
  const suffix = ctx.suffix;
  if (!ctx.filesFetched) {
    return {
      policy: "Not checked",
      note: "No file contents were fetched, so licenses could not be examined.",
    };
  }
  const sourceAvailable = found.some((id) => /BUSL|SSPL|Commons-Clause|Prosperity|Elastic/.test(id));
  if (sourceAvailable) {
    return {
      policy: "Review required",
      note: `Source-available terms were read. They are not ordinary open source.${suffix}`,
    };
  }
  if (found.includes("UNLICENSED")) {
    return {
      policy: "Review required",
      note: `UNLICENSED is not the Unlicense dedication.${suffix}`,
    };
  }
  if (found.includes("AGPL-3.0")) {
    return {
      policy: "Not recommended",
      note: `AGPL text was found in the files read. A network use question needs a person.${suffix}`,
    };
  }
  if (found.some((d) => /GPL|LGPL|MPL/.test(d))) {
    const orLater = found.some((d) => /-or-later/i.test(d));
    const widen = orLater
      ? " The license grants or-later, so a later version may be chosen."
      : " It is not stated as or-later.";
    return {
      policy: "Review required",
      note: `Copyleft wording was found. The exact id is listed.${widen}${suffix}`,
    };
  }
  const andSet = ctx.declarations.filter((d) => d.expression.operator === "and");
  const orChoice = ctx.declarations.filter((d) => d.expression.operator === "or");
  const withException = ctx.declarations.filter((d) => d.expression.exceptions.length > 0);
  if (andSet.length > 0 || orChoice.length > 0 || withException.length > 0) {
    const clauses: string[] = [];
    if (andSet.length > 0) {
      clauses.push("An AND expression is every licence in it at once, so every obligation in it applies.");
    }
    if (orChoice.length > 0) {
      clauses.push("An OR expression is a choice, not both licenses at once.");
    }
    for (const item of withException) {
      clauses.push(
        `A WITH expression is that licence plus its exception (${item.expression.exceptions.join(", ")}), so it is not the plain licence on its own.`,
      );
    }
    return { policy: "Review required", note: `${clauses.join(" ")}${suffix}` };
  }
  // More than one licence is declared across the manifests read, so no single
  // licence can be stated for this repository. Unknown, not the first one read.
  if (ctx.conflicting) {
    return {
      policy: "Unknown",
      note: `The manifests read declare more than one licence, so the terms of this repository are not stated here.${suffix}`,
    };
  }
  // The root licence file is this repository's own terms. When it was read and no
  // marker matched it, the root licence is unrecognised, so a nested permissive
  // file or a manifest field must not set Allowed. Stricter verdicts above (source
  // available, copyleft, AGPL) still stand, and the other ids are listed as their
  // own facts in the note.
  if (ctx.rootLicenseRead && !ctx.rootLicenseMatched) {
    const otherIds =
      found.length > 0
        ? ` Other licence ids in this read, each its own fact: ${found.join(", ")}.`
        : " No other licence id was in this read.";
    return {
      policy: "Unknown",
      note: `The root licence file was read and no licence marker matched it, so the root licence is unrecognised.${otherIds}${suffix}`,
    };
  }
  if (found.length > 0) {
    return { policy: "Allowed", note: `Permissive license signals found.${suffix}` };
  }
  return {
    policy: "Unknown",
    note: `No license signals in the license files and manifest field that were read.${suffix}`,
  };
}

export function analyzeLicenses(
  treeBlobs: string[],
  files: Array<{ path: string; content: string }>,
  filesFetched: boolean,
): LicenseResult {
  const licenseFiles = treeBlobs.filter(isLicenseFile);
  const detected = new Set<string>();
  const fileDetected = new Set<string>();
  let rootLicenseRead = false;
  let rootLicenseMatched = false;

  for (const file of files) {
    if (!isLicenseFile(file.path)) continue;
    const fromRoot = isRootLicenseFile(file.path);
    if (fromRoot) rootLicenseRead = true;
    const head = file.content.slice(0, 4000);
    for (const marker of LICENSE_MARKERS) {
      if (marker.pattern.test(head)) {
        detected.add(marker.id);
        fileDetected.add(marker.id);
        if (fromRoot) rootLicenseMatched = true;
      }
    }
  }

  // BSD-2 is a subset of BSD-3 text. When the endorsement clause is present, drop
  // the weaker BSD-2 so one BSD licence is reported, not two.
  if (fileDetected.has("BSD-3-Clause")) {
    detected.delete("BSD-2-Clause");
    fileDetected.delete("BSD-2-Clause");
  }

  const declarations = manifestDeclarations(files);
  for (const declaration of declarations) {
    addDeclaration(detected, declaration.expression);
  }

  // One declared licence, or none to state. Two manifests that declare different
  // licences leave no single licence to state, so the field stays null and the
  // facts go in the note rather than one file being taken as the answer.
  const distinct = [...new Set(declarations.map((d) => d.license))];
  const conflicting = distinct.length > 1;
  const packageLicense = conflicting ? null : distinct[0] ?? null;
  const manifestSource = conflicting ? null : declarations[0]?.source ?? null;

  const found = [...detected];
  const suffix = `${noticeSentence(found, files)}${declarationSentence(declarations, distinct)}${mismatchSentence(manifestSource, packageLicense, fileDetected)}`;
  const decision = decidePolicy({
    found,
    filesFetched,
    rootLicenseRead,
    rootLicenseMatched,
    suffix,
    declarations,
    conflicting,
  });

  const usage = licenseUsage(decision.policy);
  return {
    detected: found,
    files: licenseFiles,
    packageLicense,
    policy: decision.policy,
    usage,
    // The gate is stated in the note, so the licence decision that reaches a
    // report carries what it allows. A gate nothing reads is a claim the
    // product does not make.
    note: `${decision.note} ${USAGE_NOTE[usage]} ${SIGNAL}`,
  };
}

const USAGE_NOTE: Record<LicenseUsage, string> = {
  mirror: "For code we bring into our own tree, mirror is allowed.",
  "reference-only": "For code we bring into our own tree, reference only: read it, do not copy it.",
  unknown: "This licence was not checked, so what it allows is unknown. An unchecked licence is not a licence to copy.",
};

// A build-time gate for code we bring into our own tree. Mirror only what a
// permissive licence allows. Everything that needs a human, or has no licence at
// all, is reference-only: read it, do not copy it. A policy that was never
// checked stays unknown, which is not a licence to copy.
export function licenseUsage(policy: LicensePolicy): LicenseUsage {
  if (policy === "Allowed") return "mirror";
  if (policy === "Not checked") return "unknown";
  return "reference-only";
}