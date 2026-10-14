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
  /** Listed licensing inputs whose kind/content/scope could not be established. */
  unresolved: Array<{ path: string; reason: string }>;
}

/** A name already observed in directory/Git/skip metadata, not read permission. */
export interface RootLicensingInput {
  path: string;
  /** Original reason no whole-content licensing text was admitted. */
  unreadReason?: string;
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

/**
 * Wording that limits a root licence's grant to part of the tree, or leaves the
 * rest under other terms. These are scope signals, not a legal reading: they move
 * the verdict out of the unconditional permissive bucket and never clear or grant
 * anything. A bare mention of "proprietary" is not a limit on its own; it only
 * counts when it names a remainder or other files, so "permits use in proprietary
 * applications" is not read as a restriction.
 */
interface ScopeEvidence { restricted: boolean; whole: boolean; unresolved: boolean }

interface ScopePredicate { start: number; end: number; text: string }

/** Partition the supplied text before matching. A match/qualifier belongs to one
 * owned range, not merely to a bounded prefix of an otherwise unbounded regex.
 * Explicit path-only comma/conjunction continuations stay in their grant. */
function scopePredicates(text: string): ScopePredicate[] {
  const normalized = text.replace(/\s*\n\s*/g, " ");
  // Plain quoted path tokens are opaque to punctuation/conjunction splitting.
  // These are lexical path forms, not interpretation of arbitrary quoted prose.
  const quotedPaths = [...normalized.matchAll(/`[^`\s]*[/.][^`\s]*`|"[^"\s]*[/.][^"\s]*"|'[^'\s]*[/.][^'\s]*'/g)]
    .map(match => ({ start: match.index, end: match.index + match[0].length }));
  let quotedAt = 0;
  const boundaries = [...normalized.matchAll(/[,;:!?]|\.(?=\s)|\b(?:and|but|or|yet)\b/gi)].filter(boundary => {
    while (quotedPaths[quotedAt] !== undefined && quotedPaths[quotedAt].end <= boundary.index) quotedAt++;
    const quoted = quotedPaths[quotedAt];
    if (quoted !== undefined && boundary.index >= quoted.start && boundary.index < quoted.end) return false;
    if (/^(?:and|but|or|yet)$/i.test(boundary[0])) {
      const before = normalized[boundary.index - 1] ?? "";
      const after = normalized[boundary.index + boundary[0].length] ?? "";
      if (/[/.\-_]/.test(before) || /[/.\-_]/.test(after)) return false;
    }
    return true;
  });
  const out: ScopePredicate[] = [];
  let start = 0;
  const pathContinuation = /^\s*(?:the\s+)?(?:`[^`\n]*[/.][^`\n]*`|"[^"\n]*[/.][^"\n]*"|'[^'\n]*[/.][^'\n]*'|[A-Za-z0-9_.*@+-]+(?:\/[A-Za-z0-9_.*@+-]*)+|[A-Za-z0-9_@+-]+\.[A-Za-z0-9_*+-]+)(?:\s+(?:files?|sources?|director(?:y|ies)|folders?|modules?|components?|trees?|subtrees?|only|exclusively|solely))*\s*\.?\s*$/i;
  for (let index = 0; index < boundaries.length; index++) {
    const boundary = boundaries[index];
    const at = boundary.index;
    const after = at + boundary[0].length;
    const right = normalized.slice(after, boundaries[index + 1]?.index ?? normalized.length);
    const left = normalized.slice(start, at);
    // Keep a scope label's colon with its value. A genuine later predicate is
    // otherwise separated, including one whose own wording is unsupported.
    if (boundary[0] === ":" && /\b(?:scope|coverage)\s*$/i.test(left)) continue;
    if (/^(?:,|and|but|or|yet)$/i.test(boundary[0]) && pathContinuation.test(right)) continue;
    if (left.trim() !== "") out.push({ start, end: at, text: left });
    start = after;
  }
  const remaining = normalized.slice(start);
  if (remaining.trim() !== "") out.push({ start, end: normalized.length, text: remaining });
  return out;
}

/** Local clauses, not a global keyword override. Every supplied character is
 * eligible; the caller's existing byte/line/file caps still bound this input.
 * Unknown wording/contradictions do not manufacture permission or restriction. */
function rootScopeEvidence(text: string): ScopeEvidence {
  const evidence: ScopeEvidence = { restricted: false, whole: false, unresolved: false };
  let deniedWhole = false;
  for (const predicate of scopePredicates(text)) {
    const local = predicate.text;
    // A bounded local negation window accepts scope modifiers, not arbitrary
    // intervening prose or conjunctions. It cannot cancel another clause.
    const negation = (prefix: string): "positive" | "negated" | "unresolved" => {
      if (/\b(?:not|never)\s+(?:(?:scope|project|licen[cs]e|permission|grant|coverage|narrowly|geographically|territorially|regionally|strictly|necessarily|explicitly|directly|just|merely|only|solely|apply|applies|cover|covers)[ -]+){0,3}$|\bnot\s+(?:require|requires|under|subject\s+to)\s+(?:a\s+)?$/i.test(prefix)) return "negated";
      // A recognised local negation outside that grammar is not a confirmed
      // positive restriction. Carry uncertainty instead of guessing its meaning.
      return /\b(?:not|never)\b/i.test(prefix) ? "unresolved" : "positive";
    };
    const grantContext = (at: number): boolean => {
      const prefix = local.slice(0, at);
      return !/\b(?:liability|liabilities|damages?|warrant(?:y|ies)|responsibility)\b/i.test(prefix);
    };
    // Observe overlapping predicate starts: an earlier liability predicate must
    // not consume a later grant's qualifier and hide its supported scope form.
    const limits = [...local.matchAll(/(?=(\b(?:limited|restricted|solely)\s+to\b|\bappl(?:y|ies)\s+only\s+to\b|\bappl(?:y|ies)\s+to\b.*?\bonly\b|\bcovers?\b.*?\bexclusively\b))/gi)]
      .map(match => ({ index: match.index, text: match[1] ?? "" }));
    const scopeSubject = /\b(?:grant|permission|licen[cs]e|appl(?:y|ies)|covers?)\b/i.test(local);
    const scopeTarget = /\b(?:scope|coverage|files?|paths?|folders?|director(?:y|ies)|subtrees?|modules?|packages?|components?|repository|project|tree|parts?|portions?)\b|\//i.test(local);
    const handled = limits.filter(match => (scopeSubject || scopeTarget) && grantContext(match.index));
    const limit = handled.some(match => negation(local.slice(0, match.index)) === "positive");
    if (handled.some(match => negation(local.slice(0, match.index)) === "unresolved")) evidence.unresolved = true;
    if (limit) evidence.restricted = true;
    if (/\bnot\s+licensed\b|\bno\s+licen[cs]es?\s+(?:is|are)\s+granted\b/i.test(local)) evidence.restricted = true;
    const wholeStarts = [...local.matchAll(/(?=(\b(?:covers?|appl(?:y|ies)\s+to)\b.*?\b(?:entire|whole)\s+(?:repository|project|work|tree)\b))/gi)];
    const wholeHandled = wholeStarts.filter(match => grantContext(match.index));
    for (const whole of wholeHandled) {
      const state = negation(local.slice(0, whole.index));
      if (state === "negated") deniedWhole = true;
      else if (state === "positive") evidence.whole = true;
      else evidence.unresolved = true;
    }
    // Recognised scope cues outside the supported grant grammar are unresolved,
    // not a permissive fallback. Labels alone do not establish a restricted
    // grant. Each qualifier is judged locally, including before its subject.
    const qualifiers = [...local.matchAll(/(?<![\w/.])\b(?:only|exclusive(?:ly)?|limited|restricted|sole(?:ly)?)\b(?![\w/]|\.[\w/])/gi)];
    for (const qualifier of qualifiers) {
      if (!scopeTarget || !scopeSubject && !/\b(?:scope|coverage)\b/i.test(local)) continue;
      if (!grantContext(qualifier.index) || negation(local.slice(0, qualifier.index)) === "negated") continue;
      if (handled.some(match => qualifier.index >= match.index && qualifier.index < match.index + match.text.length)) continue;
      const tail = local.slice(qualifier.index);
      const prefix = local.slice(0, qualifier.index);
      if (/^only\s+(?:requires?|asks?|needs?)\b/i.test(tail) || /\b(?:requires?|asks?|needs?)\s*$/i.test(prefix)) continue;
      if (/^only\s+(?:limits?|restricts?)\s+(?:(?:the|a|an|this|legal)\s+){0,3}(?:liability|liabilities|damages?|warrant(?:y|ies)|responsibility)\b/i.test(tail)) continue;
      evidence.unresolved = true;
    }
    for (const scopeCue of local.matchAll(/(?<![\w-])\b(?:scope|coverage)\b(?![\w-])/gi)) {
      const liabilityScope = /^(?:scope|coverage)\s+(?:of|for|concerning|regarding)\s+(?:(?:the|a|an|this|legal)\s+){0,3}(?:liability|liabilities|damages?|warrant(?:y|ies)|responsibility)\b/i.test(local.slice(scopeCue.index));
      if (!liabilityScope && grantContext(scopeCue.index) && scopeTarget && handled.length === 0 && wholeHandled.length === 0 &&
          !qualifiers.some(qualifier => negation(local.slice(0, qualifier.index)) === "negated") &&
          !/\bunrestricted\b|\bno\s+restrictions?\b/i.test(local)) evidence.unresolved = true;
    }
    if (scopeSubject && /\b(?:except|excludes?|excluding|but\s+not)\b/i.test(local)) evidence.unresolved = true;
    const remainder = /\b(?:remaining|remainder|rest|all\s+other|other\s+files?)\b/i.test(local);
    if (!remainder) continue;
    const restrictions = [...local.matchAll(/\b(?:separate\s+(?:commercial|proprietary|paid|written)|commercial\s+licen[cs]e|proprietary)\b/gi)];
    if (restrictions.some(match => negation(local.slice(0, match.index)) === "unresolved")) evidence.unresolved = true;
    const restrictive = restrictions.some(match => negation(local.slice(0, match.index)) === "positive") || /\bnot\s+licensed\b|\bno\s+licen[cs]e\b/i.test(local);
    const benign = (!restrictive && restrictions.length > 0) || /\b(?:no\s+restrictions?|unrestricted|also\s+under\s+the\s+MIT\s+licen[cs]e|same\s+(?:licen[cs]e|terms))\b/i.test(local) || handled.some(match => negation(local.slice(0, match.index)) === "negated");
    if (restrictive && benign) evidence.unresolved = true;
    else if (restrictive) evidence.restricted = true;
    else if (!benign && !limit) evidence.unresolved = true;
  }
  if (evidence.restricted && evidence.whole) evidence.unresolved = true;
  if (deniedWhole && !evidence.restricted) evidence.unresolved = true;
  return evidence;
}

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
 * Extensions that mean the file's kind is executable source or a component, not
 * a legal document. A basename can carry a licence word and still be code:
 * `tests/license-reader.mjs` and `shared/licensing/notice.ts` are source files
 * whose names happen to spell a licence word. Reading them as licence documents
 * let licence text quoted inside ordinary source set the whole-repo policy. The
 * test is the file's kind, never one path or product. Known source kinds are
 * excluded; unfamiliar root licensing kinds remain explicitly unresolved.
 */
const DOCUMENT_EXTENSIONS = new Set([
  "md", "markdown", "mdown", "mkd", "txt", "text", "rst", "adoc", "asciidoc", "html", "htm",
]);
// Known source kinds are excluded by kind, never by repository/test/path. An
// unfamiliar suffix on a root licensing candidate is NOT proof it is source.
const SOURCE_EXTENSIONS = new Set([
  "js", "mjs", "cjs", "jsx", "ts", "tsx", "mts", "cts", "py", "pyi", "go", "rs",
  "c", "h", "cc", "cpp", "hpp", "cxx", "java", "kt", "kts", "scala", "cs", "fs",
  "rb", "php", "swift", "m", "mm", "zig", "jl", "lua", "sh", "bash", "ps1",
  "r", "ex", "exs", "erl", "hrl", "hs", "ml", "clj", "cljs", "vue", "svelte",
  "css", "scss", "sass", "less", "sql", "dart", "pl", "pm", "nim", "v", "sv",
]);

/**
 * A licence file basename. Repositories spell it every way: `LICENSE`,
 * `LICENSE.md`, `LICENSE-MIT`, `MIT-LICENSE`, `LICENCE`, `COPYING.md`. A basename
 * that is not matched here is read and then thrown away, which loses the licence
 * signal and leaves the finding with no licence path at all.
 * NOTICE is accepted because Apache-2.0 needs its companion file read too.
 *
 * A licence document is a recognised licence basename that is either extensionless
 * or carries a plain document extension; COPYING.LESSER/LIB are conventions too.
 * Known source extensions stay in code/secret lanes, not this lane. Unknown kinds
 * are neither proved code nor silently discarded as absent legal evidence.
 */
function licenseFileKind(path: string): "document" | "source" | "unsupported" | "other" {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  let name = base;
  if (dot > 0) {
    const ext = base.slice(dot + 1).toLowerCase();
    name = base.slice(0, dot);
    const upper = name.toUpperCase();
    const candidate = /^(?:NOTICE|COPYING|LICEN[CS]E)(?:[-.]|$)/.test(upper) || /-LICEN[CS]E$/.test(upper);
    if (!candidate) return "other";
    if (SOURCE_EXTENSIONS.has(ext)) return "source";
    if (upper === "COPYING" && ["lesser", "lib"].includes(ext)) return "document";
    if (!DOCUMENT_EXTENSIONS.has(ext)) return "unsupported";
    if (name.includes(".")) return "unsupported";
  }
  const upper = name.toUpperCase();
  if (upper === "NOTICE" || upper === "COPYING") return "document";
  for (const word of ["LICENSE", "LICENCE"]) {
    if (upper === word) return "document";
    if (upper.startsWith(`${word}-`)) return "document";
    if (upper.endsWith(`-${word}`)) return "document";
  }
  return "other";
}
function isLicenseFile(path: string): boolean { return licenseFileKind(path) === "document"; }

/** Known root licensing kinds only. Never infer a name from a reason or policy. */
export function isRootLicensingCandidate(path: string): boolean {
  if (path.includes("/")) return false;
  const kind = licenseFileKind(path);
  return kind === "document" || kind === "unsupported";
}

/** A licence file at the repo root. NOTICE is a companion file, not the licence. */
function isRootLicenseFile(path: string): boolean {
  if (path.includes("/")) return false;
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  const name = (dot > 0 ? base.slice(0, dot) : base).toUpperCase();
  if (name === "NOTICE") return false;
  return isLicenseFile(path);
}

interface PolicyContext {
  found: string[];
  filesFetched: boolean;
  rootLicenseRead: boolean;
  rootLicenseMatched: boolean;
  rootLicenseRestricted: boolean;
  rootScopeUnresolved: boolean;
  rootInputUnresolved: boolean;
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
      note: "No whole-content licensing inputs were admitted, so licenses could not be examined.",
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
  if (ctx.rootInputUnresolved || ctx.rootScopeUnresolved) {
    return {
      policy: "Unknown",
      note: `Root licensing input or grant scope is unresolved (unsupported, unread or contradictory); a permissive signal elsewhere does not establish whole-project scope.${suffix}`,
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
  // The root licence matched a permissive marker, but its own wording limits the
  // grant to part of the tree or leaves the rest under other terms. That is not
  // one grant for the whole project, so it does not enter the permissive Allowed
  // bucket and it does not permit mirroring the whole project.
  if (ctx.rootLicenseRestricted) {
    return {
      policy: "Review required",
      note: `Scope-limiting wording was found in a root licence file. It does not establish a single grant for the whole project; a person must check the covered paths and terms.${suffix}`,
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
  rootInputs: readonly RootLicensingInput[] = [],
): LicenseResult {
  const unread = new Map<string, Set<string>>();
  for (const input of rootInputs) {
    if (!isRootLicensingCandidate(input.path) || input.unreadReason === undefined) continue;
    const reasons = unread.get(input.path) ?? new Set<string>();
    reasons.add(input.unreadReason);
    unread.set(input.path, reasons);
  }
  const knownPaths = [...new Set([...treeBlobs, ...files.map(file => file.path), ...rootInputs.map(input => input.path)])];
  const licenseFiles = knownPaths.filter(isLicenseFile);
  const detected = new Set<string>();
  const fileDetected = new Set<string>();
  let rootLicenseRead = false;
  let rootLicenseMatched = false;
  let rootLicenseRestricted = false;
  let rootScopeWhole = false;
  let rootScopeUnresolved = false;
  let rootUnmatched = false;
  let rootInputUnresolved = false;
  const unresolved: LicenseResult["unresolved"] = [];
  const admitted = new Set(files.map(file => file.path));
  for (const path of knownPaths) {
    const kind = licenseFileKind(path);
    if (path.includes("/") || kind === "other" || kind === "source") continue;
    const reasons = unread.get(path);
    const provenance = reasons === undefined ? "" : ` Not admitted for licensing: ${[...reasons].join("; ")}`;
    if (kind === "unsupported") {
      rootInputUnresolved = true;
      unresolved.push({ path, reason: `Root licensing file kind is unsupported; its terms and scope remain unresolved.${provenance}` });
    } else if (reasons !== undefined || !admitted.has(path)) {
      rootInputUnresolved = true;
      unresolved.push({ path, reason: `Root licensing candidate was named but no licensing text was admitted; its terms and scope remain unresolved.${provenance}` });
    }
  }

  for (const file of files) {
    if (!isLicenseFile(file.path) || unread.has(file.path)) continue;
    const fromRoot = isRootLicenseFile(file.path);
    if (fromRoot) rootLicenseRead = true;
    // The whole licence text is examined for both markers and scope wording. The
    // earlier fixed window could miss a scope restriction past its edge and still
    // return a whole-project Allowed, which is exactly the overstatement to avoid.
    const text = file.content;
    if (fromRoot) {
      const scope = rootScopeEvidence(text);
      rootLicenseRestricted ||= scope.restricted;
      rootScopeWhole ||= scope.whole;
      rootScopeUnresolved ||= scope.unresolved;
      if (scope.unresolved) unresolved.push({ path: file.path, reason: "Root licence scope wording is unsupported or contradictory; whole-project scope remains unresolved." });
    }
    let matched = false;
    for (const marker of LICENSE_MARKERS) {
      if (marker.pattern.test(text)) {
        detected.add(marker.id);
        fileDetected.add(marker.id);
        if (fromRoot) rootLicenseMatched = true;
        matched = true;
      }
    }
    if (fromRoot && !matched) rootUnmatched = true;
  }
  if (rootLicenseRestricted && rootScopeWhole && !rootScopeUnresolved) {
    rootScopeUnresolved = true;
    for (const file of files.filter((file) => isRootLicenseFile(file.path))) {
      unresolved.push({ path: file.path, reason: "Root licence documents contain contradictory scope signals; whole-project scope remains unresolved." });
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
    rootLicenseMatched: rootLicenseMatched && !rootUnmatched,
    rootLicenseRestricted,
    rootScopeUnresolved: rootScopeUnresolved || (rootLicenseRestricted && rootScopeWhole),
    rootInputUnresolved,
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
    unresolved,
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
