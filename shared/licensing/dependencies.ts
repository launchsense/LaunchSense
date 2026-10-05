// Per-dependency licence reading for npm, from the lockfile the repository
// already commits.
//
// The lockfile is the declaration the repository made. What the registry says
// today is a different fact, and reading it would be a network call, so this
// module never makes one. A lockfile entry with no `license` field falls back to
// the package's own package.json when the caller can read one, and to Unknown
// when it cannot.
//
// Unknown is the answer whenever a licence cannot be determined. It is never
// filled in from what a package of that name is usually published under, from a
// sibling component, or from a model.

import { normalizeDeclaration, normalizeSpdxId } from "./spdx.ts";
import type { NormalizedDeclaration } from "./spdx.ts";
import { UNKNOWN_LICENSE } from "./spdx.ts";

export type DependencyDepth = "direct" | "transitive";

export interface DependencyLicense {
  name: string;
  version: string;
  depth: DependencyDepth;
  dev: boolean;
  /** The string as declared, or null when nothing was declared. */
  declared: string | null;
  /** Canonical SPDX id, or `Unknown`. */
  spdx: string;
  /** Why it is Unknown, or null. */
  unknownReason: string | null;
  /** True when the declared id is on the SPDX deprecated list. */
  deprecated: boolean;
  /** `single`, `and`, or `or`. An OR set attaches no obligation to either id. */
  operator: "single" | "and" | "or";
  /** Exceptions named after WITH. An exception changes the terms. */
  exceptions: string[];
  /** Which declaration was read. */
  source: "lockfile" | "installed-manifest" | "none";
}

export interface DependencyLicenseInventory {
  components: DependencyLicense[];
  /** True when the lockfile carried a packages map that was read in full. */
  complete: boolean;
  /** How many installed packages the lockfile listed. */
  counted: number;
  /** How many of those read as Unknown. */
  unknown: number;
  note: string;
  /** Named gaps. Every one of these is something this module did not read. */
  notCovered: string[];
}

export interface DependencyLicenseOptions {
  /** Names the manifests declare directly, so direct and transitive stay apart. */
  directNames?: ReadonlySet<string>;
  /**
   * Reads the installed package.json for a component, as text. Injected rather
   * than read from disk here, so this module stays pure and the hosted scan
   * passes nothing when it has no node_modules to read.
   */
  readInstalledManifest?: (name: string) => string | null;
  /** Ceiling on installed-manifest reads, named in the note when it binds. */
  fallbackLimit?: number;
}

const FALLBACK_LIMIT = 50;

/**
 * Ecosystems and lockfiles this module does not read, named by name.
 *
 * Named as ecosystems rather than as file paths on purpose. A line that named
 * go.sum would read like a claim about a Go module in the review, and this
 * module never saw one.
 */
const NOT_COVERED = [
  "yarn.lock and pnpm-lock.yaml dependency licences",
  "Cargo, Go and PyPI dependency licences",
  "a vendored tree such as vendor/, third_party/, 3rdparty/ or deps/",
  "a per-file SPDX header or REUSE.toml",
  "what a registry says today, which can differ from the lockfile",
];

/**
 * The package name from a lockfile key.
 *
 * The last `node_modules/` wins, so a nested copy reads as its own name. A
 * scoped name such as `@auth/core` keeps its slash: the remainder is a name, not
 * a path, and dropping the scope would merge two different packages under one
 * id. What is refused is a remainder that is itself a path.
 */
function nameFromPath(pathKey: string): string | null {
  const marker = "node_modules/";
  const at = pathKey.lastIndexOf(marker);
  if (at < 0) return null;
  const name = pathKey.slice(at + marker.length);
  if (name.length === 0 || name.includes(marker)) return null;
  return name;
}

function emptyInventory(note: string): DependencyLicenseInventory {
  return { components: [], complete: false, counted: 0, unknown: 0, note, notCovered: [...NOT_COVERED] };
}

/** npm's own licence field, in the shape a manifest actually declares it. */
function npmLicenseField(content: string): string | null {
  try {
    const data = JSON.parse(content) as unknown;
    if (typeof data === "object" && data !== null) {
      const lic = (data as Record<string, unknown>)["license"];
      if (typeof lic === "string" && lic.trim().length > 0) return lic.trim();
    }
  } catch {
    // An unreadable installed manifest declares nothing that can be measured.
  }
  return null;
}

/**
 * Whether two declarations of the same component say the same thing.
 *
 * Compared after normalization, not as raw strings. `mit` and `MIT` are one
 * licence written two ways, and calling that a disagreement would turn a capital
 * letter into an Unknown.
 */
function sameDeclaration(a: string, b: string): boolean {
  const left = normalizeDeclaration(a);
  const right = normalizeDeclaration(b);
  if (left.operator !== right.operator) return false;
  const leftIds = [...left.licenses].sort().join(" AND ");
  const rightIds = [...right.licenses].sort().join(" AND ");
  if (leftIds !== rightIds) return false;
  return [...left.exceptions].sort().join(", ") === [...right.exceptions].sort().join(", ");
}

/**
 * The record for one component.
 *
 * When the lockfile and the installed manifest both declare something and they
 * disagree, the result is Unknown, not one of the two. Two declarations that
 * disagree do not average into an answer, and choosing one is choosing a licence
 * for a person who has not looked.
 */
function resolve(
  name: string,
  version: string,
  depth: DependencyDepth,
  dev: boolean,
  lockDeclared: string | null,
  manifestDeclared: string | null,
  source: DependencyLicense["source"],
): DependencyLicense {
  const out: DependencyLicense = {
    name,
    version,
    depth,
    dev,
    declared: lockDeclared ?? manifestDeclared,
    spdx: UNKNOWN_LICENSE,
    unknownReason: null,
    deprecated: false,
    operator: "single",
    exceptions: [],
    source,
  };
  if (lockDeclared !== null && manifestDeclared !== null && !sameDeclaration(lockDeclared, manifestDeclared)) {
    out.unknownReason = `the lockfile says ${lockDeclared} and the installed package.json says ${manifestDeclared}`;
    return out;
  }
  const declaration: NormalizedDeclaration = normalizeDeclaration(out.declared);
  out.operator = declaration.operator;
  out.exceptions = declaration.exceptions;
  if (out.declared === null) {
    out.unknownReason = `no licence field was declared by ${source === "none" ? "the lockfile" : "the lockfile or the installed manifest"}`;
    return out;
  }
  if (declaration.operator === "or") {
    // A choice, not a set. The ids stay in the record and the notice names both,
    // but nothing here asserts which one the author picked.
    out.spdx = UNKNOWN_LICENSE;
    out.unknownReason = `the package offers a choice (${declaration.licenses.join(" OR ")}), so the licence that applies is the one you choose`;
    return out;
  }
  if (declaration.licenses.length === 1) {
    const declaredId = declaration.expression.licenses[0] ?? null;
    const normalized = normalizeSpdxId(declaredId);
    out.spdx = normalized.id;
    out.deprecated = normalized.deprecated;
    if (!declaration.resolved) out.unknownReason = declaration.reasons.join("; ");
    return out;
  }
  // An AND set states two licences that both apply. The record keeps the
  // expression and the notice names both obligations, so nothing is dropped.
  // If any id in the set cannot be read, the set is not fully known: read it as
  // Unknown rather than fabricating "X AND Unknown" and claiming a complete read.
  if (declaration.licenses.length > 1) {
    const normalized = declaration.licenses.map((id) => normalizeSpdxId(id).id);
    if (normalized.some((id) => id === UNKNOWN_LICENSE)) {
      out.spdx = UNKNOWN_LICENSE;
      out.unknownReason = `one id in ${declaration.licenses.join(" AND ")} could not be read, so the set is not fully known`;
      return out;
    }
    out.spdx = normalized.join(" AND ");
    return out;
  }
  out.unknownReason = declaration.reasons.join("; ");
  return out;
}

function sortComponents(components: DependencyLicense[]): DependencyLicense[] {
  return [...components].sort((a, b) =>
    a.name === b.name
      ? a.version.localeCompare(b.version)
      : a.name.localeCompare(b.name),
  );
}

/**
 * Read the licence every installed npm package declares.
 *
 * The lockfile lists direct and transitive packages, so the inventory does too.
 * Direct means the manifests name it; transitive means the lockfile reached it
 * through another package. That distinction is the one a person needs, because
 * the transitive ones are the ones nobody chose.
 */
export function readNpmDependencyLicenses(
  lockText: string,
  options: DependencyLicenseOptions = {},
): DependencyLicenseInventory {
  let data: unknown;
  try {
    data = JSON.parse(lockText) as unknown;
  } catch {
    return emptyInventory("The npm lockfile did not parse, so no dependency licence was read.");
  }
  if (typeof data !== "object" || data === null) {
    return emptyInventory("The npm lockfile did not parse, so no dependency licence was read.");
  }
  const packages = (data as Record<string, unknown>)["packages"];
  if (typeof packages !== "object" || packages === null) {
    // A lockfile with no packages map is incomplete, not a project with zero
    // dependencies. Saying zero would be a pass nobody measured.
    return emptyInventory(
      "This npm lockfile has no packages map, so no installed dependency was read for a licence. A v1 lockfile does not carry one.",
    );
  }

  const directNames = options.directNames ?? new Set<string>();
  const fallbackLimit = options.fallbackLimit ?? FALLBACK_LIMIT;
  const components: DependencyLicense[] = [];
  let fallbackReads = 0;
  let fallbackSkipped = 0;
  let linkEntries = 0;

  for (const [pathKey, raw] of Object.entries(packages as Record<string, unknown>)) {
    if (pathKey === "" || typeof raw !== "object" || raw === null) continue;
    const name = nameFromPath(pathKey);
    if (name === null) continue;
    const record = raw as Record<string, unknown>;
    // A workspace link has no version and is not an installed npm dependency, so
    // there is no licence to read. Count it and name it rather than dropping it,
    // or a workspace lockfile reads as a complete project with zero packages.
    if (record["link"] === true) {
      linkEntries += 1;
      continue;
    }
    const version = record["version"];
    if (typeof version !== "string" || version.length === 0) continue;
    const nested = pathKey.split("node_modules/").length > 2;
    const depth: DependencyDepth = !nested && directNames.has(name) ? "direct" : "transitive";
    const dev = record["dev"] === true;

    const rawLockLicense = record["license"];
    const lockDeclared =
      typeof rawLockLicense === "string" && rawLockLicense.trim().length > 0
        ? rawLockLicense.trim()
        : null;

    let manifestDeclared: string | null = null;
    // Read the installed manifest whenever a reader is supplied, not only when
    // the lockfile is silent. It is the cross-check that catches a lockfile
    // whose licence field and the shipped package's own licence field disagree,
    // which is only detectable if both are read. The lockfile still wins when
    // they agree, so this is a second opinion rather than a replacement.
    if (options.readInstalledManifest !== undefined) {
      if (fallbackReads < fallbackLimit) {
        fallbackReads += 1;
        const text = options.readInstalledManifest(name);
        manifestDeclared = text === null ? null : npmLicenseField(text);
      } else {
        // The cross-check is capped, so an entry past the cap was not checked at
        // all. Count it whether or not the lockfile declared a licence, because
        // the point of the note is that these entries were not cross-checked, not
        // that they were blank.
        fallbackSkipped += 1;
      }
    }

    const source: DependencyLicense["source"] =
      lockDeclared !== null ? "lockfile" : manifestDeclared !== null ? "installed-manifest" : "none";
    components.push(resolve(name, version, depth, dev, lockDeclared, manifestDeclared, source));
  }

  const sorted = sortComponents(components);
  const unknown = sorted.filter((item) => item.spdx === UNKNOWN_LICENSE).length;
  const direct = sorted.filter((item) => item.depth === "direct").length;
  const capped =
    fallbackSkipped > 0
      ? ` ${fallbackSkipped} entry(s) were not checked against an installed manifest, because the cross-check stops at ${fallbackLimit} per lockfile.`
      : "";
  const note =
    `The npm lockfile lists ${sorted.length} installed packages: ${direct} direct and ${sorted.length - direct} transitive. ` +
    (unknown === 0
      ? "Every one declared a licence this product reads."
      : `${unknown} of them read as ${UNKNOWN_LICENSE}, and an unknown licence is not a licence.`) +
    capped;
  return {
    components: sorted,
    complete: true,
    counted: sorted.length,
    unknown,
    note,
    notCovered: [
      ...NOT_COVERED,
      ...(linkEntries > 0
        ? [
            `${linkEntries} workspace link(s) in the lockfile are not installed npm dependencies and carry no version, so no licence was read for them.`,
          ]
        : []),
    ],
  };
}

/** The not-covered lines for a read that never opened a lockfile. */
export function noLockfileInventory(): DependencyLicenseInventory {
  return emptyInventory(
    "No npm lockfile was read, so no installed dependency was read for a licence. This is not a project with no dependencies.",
  );
}