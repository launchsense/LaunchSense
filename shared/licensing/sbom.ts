// CycloneDX 1.7 SBOM, generated from the same inventory the notice file reads.
//
// Adoption by reference. CycloneDX is ECMA-424, the format other tools already
// read, and it asks for almost nothing: only `bomFormat` and `specVersion` are
// required. Everything else here is what this repository can honestly fill.
//
// Four refusals, each one a place where a plausible-looking value was available
// and writing it would have been a lie:
//
//   No clock. `metadata.timestamp` is only emitted when the caller passes a real
//   build time. A generator that stamped Date.now() would produce a different
//   document every run, and "same lockfile in, same bytes out" is the property the
//   notice file already has. Without a timestamp the field is absent, which is
//   legal, and `launchsense:sbom.timestamp` says why it is absent.
//
//   No hashes. A hash is a statement about a specific artefact. This document is
//   built from the lockfile's declared metadata, and no package tarball was
//   downloaded or hashed, so there is no artefact and no hash. The lockfile does
//   carry an `integrity` value per entry, and emitting it as a CycloneDX `hashes`
//   entry would claim we verified a tarball we never fetched.
//
//   No dependency graph. The licence inventory carries name, version, depth, dev,
//   and licence. It carries no edges, so a `dependencies` array would have to say
//   "depends on nothing" for 324 packages, which is false. The array is omitted
//   and `launchsense:sbom.dependency_graph` names the omission.
//
//   No random serial number. `serialNumber` is derived from the content, so the
//   same lockfile gives the same document. It is a content-derived UUID, not a
//   random v4, and the version nibble says so.
//
// Unknown is not a licence, so it is never written as one. A component whose
// licence could not be read gets a named licence of "Unknown" plus a property
// giving the reason, and never an invented id.

import { canonicalJson, derivedUuid } from "../consent/digest.ts";
import { UNKNOWN_LICENSE } from "./spdx.ts";
import type { DependencyLicense, DependencyLicenseInventory } from "./dependencies.ts";

/** The document shape. Exactly the fields CycloneDX 1.7 defines, no private keys. */
export interface CycloneDxLicensing {
  license?: { id?: string; name?: string };
  expression?: string;
}

export interface CycloneDxProperty {
  name: string;
  value: string;
}

export interface CycloneDxComponent {
  type: "library";
  "bom-ref": string;
  name: string;
  version: string;
  purl: string;
  licenses: CycloneDxLicensing[];
  properties: CycloneDxProperty[];
}

export interface CycloneDxDocument {
  $schema: string;
  bomFormat: "CycloneDX";
  specVersion: "1.7";
  serialNumber: string | null;
  version: number;
  metadata: {
    timestamp?: string;
    tools: { components: Array<{ type: "application"; name: string; version: string }> };
    component: {
      type: "application";
      "bom-ref": string;
      name: string;
      version: string;
      purl: string;
      description: string;
    };
    properties: CycloneDxProperty[];
  };
  components: CycloneDxComponent[];
  compositions: Array<{
    aggregate: "incomplete" | "complete" | "unknown";
    assemblies: string[];
    dependencies: string[];
  }>;
}

export interface SbomOptions {
  project: { name: string; version: string };
  /** A real build timestamp in ISO 8601. Omitted when there is not one. */
  generatedAt?: string;
  /** The tool that produced this document. Named so a consumer can tell it apart. */
  toolVersion?: string;
}

const SCHEMA_URI =
  "http://cyclonedx.org/schema/bom-1.7.schema.json";

/**
 * The package URL for one npm coordinate.
 *
 * A scoped name keeps its scope, percent-encoded, because dropping it would merge
 * two different packages under one coordinate. Nothing else is invented: no
 * registry host, because this document names npm coordinates and no other.
 */
export function npmPurl(name: string, version: string): string {
  const encoded = name.startsWith("@") ? name.replace("@", "%40") : name;
  return `pkg:npm/${encoded}@${version}`;
}

/**
 * The licences for one component, in the shape CycloneDX defines.
 *
 * The OR case is checked before the Unknown case on purpose. The inventory reads an
 * OR set as Unknown, because no id applies until a person chooses, and an Unknown
 * licence is written as a name. But a choice is not a gap: the package declared
 * both options, so the document records the choice as the expression it is and says
 * that the applicable licence is unresolved.
 */
function licenseFor(component: DependencyLicense): {
  licenses: CycloneDxLicensing[];
  properties: CycloneDxProperty[];
} {
  const properties: CycloneDxProperty[] = [];
  const declared = component.declared;

  if (component.operator === "or") {
    // An OR set is a choice. The declaration is recorded as the expression it is,
    // and no id is asserted as the one that applies.
    const expression = (declared ?? "").trim();
    const isExpression = /^[A-Za-z0-9.\-+()]+\s+OR\s+[A-Za-z0-9.\-+()]+$/.test(expression);
    if (isExpression) {
      properties.push({
        name: "launchsense:license:choice_unresolved",
        value: `the package offers a choice, so the licence that applies is the one you choose: ${expression}`,
      });
      return { licenses: [{ expression }], properties };
    }
  }

  if (component.spdx === UNKNOWN_LICENSE) {
    // The standard's own way of saying nothing is known is to name it rather
    // than to assert an id, so that is what happens here.
    properties.push({
      name: "launchsense:license:declared",
      value: declared ?? "no licence field declared",
    });
    properties.push({
      name: "launchsense:license:unknown_reason",
      value: component.unknownReason ?? "the licence could not be read",
    });
    return { licenses: [{ license: { name: UNKNOWN_LICENSE } }], properties };
  }

  if (component.operator === "or") {
    // An OR set is a choice, and it is not an expression this module will write, so
    // the record falls through to the Unknown branch below and says why.
    properties.push({
      name: "launchsense:license:choice_unresolved",
      value: `the package offers a choice (${declared ?? component.spdx}), and this document will not record an expression it has not read`,
    });
  }

  if (component.spdx.includes(" AND ")) {
    return { licenses: [{ expression: component.spdx }], properties };
  }

  if (component.spdx.startsWith("LicenseRef-")) {
    // A LicenseRef is a real SPDX document identifier, but it is not in the SPDX
    // id list, so it is carried as a name. Writing it as an id would name an id
    // that does not exist.
    properties.push({
      name: "launchsense:license:declared",
      value: declared ?? component.spdx,
    });
    return { licenses: [{ license: { name: component.spdx } }], properties };
  }

  if (component.deprecated) {
    properties.push({
      name: "launchsense:license:deprecated",
      value: `${component.spdx} is a deprecated SPDX identifier. It names which licence text was meant. The identifier does not carry the only-versus-or-later distinction the current form does.`,
    });
  }
  return { licenses: [{ license: { id: component.spdx } }], properties };
}

/** The component record for one entry, with the coordinates a consumer needs. */
function componentFor(item: DependencyLicense): CycloneDxComponent {
  const { licenses, properties } = licenseFor(item);
  return {
    type: "library",
    "bom-ref": npmPurl(item.name, item.version),
    name: item.name,
    version: item.version,
    purl: npmPurl(item.name, item.version),
    licenses,
    properties: [
      ...properties,
      { name: "launchsense:dependency:depth", value: item.depth },
      { name: "launchsense:dependency:dev", value: item.dev ? "true" : "false" },
      { name: "launchsense:dependency:source", value: item.source },
    ],
  };
}

/**
 * One component per name and version.
 *
 * A lockfile lists one entry per install path, so the same package appears twice
 * when two packages depend on it. CycloneDX requires every bom-ref to be unique,
 * and a person reading the document needs a component once, not once per path.
 *
 * The input is sorted to a total order first, including depth, because two entries
 * for the same package can differ in whether they are direct or nested. Without the
 * depth in the order, which of the two survived would depend on the order the
 * lockfile happened to be written in, and two runs over the same lockfile could
 * produce two different documents.
 */
function uniqueComponents(components: DependencyLicense[]): {
  components: DependencyLicense[];
  duplicates: number;
} {
  const rank = { direct: 0, transitive: 1 } as const;
  const ordered = [...components].sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      a.version.localeCompare(b.version) ||
      Number(a.dev) - Number(b.dev) ||
      rank[a.depth] - rank[b.depth] ||
      a.spdx.localeCompare(b.spdx),
  );
  const seen = new Set<string>();
  const out: DependencyLicense[] = [];
  let duplicates = 0;
  for (const item of ordered) {
    const key = `${item.name}@${item.version}:${item.spdx}:${item.dev ? "dev" : "prod"}`;
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    out.push(item);
  }
  return { components: out, duplicates };
}

/**
 * Build the document.
 *
 * Deterministic in the input: same inventory, same project version, same bytes.
 * The only value that is not derived from the inventory is `generatedAt`, which the
 * caller supplies or does not.
 */
export async function buildSbom(
  inventory: DependencyLicenseInventory,
  options: SbomOptions,
): Promise<CycloneDxDocument> {
  const { components: unique, duplicates } = uniqueComponents(inventory.components);
  const sorted = [...unique].sort((a, b) =>
    a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name),
  );
  const built = sorted.map((item) => componentFor(item));
  const refs = built.map((item) => item["bom-ref"]);

  // The serial number is derived from the content, so the same lockfile gives the
  // same document. A random v4 would change on every run and be useless for
  // comparing two builds of the same commit.
  const serial = await derivedUuid(
    options.project.name,
    options.project.version,
    canonicalJson(built),
  );

  const metadataProperties: CycloneDxProperty[] = [
    { name: "launchsense:sbom:source", value: "package-lock.json, read through shared/licensing/dependencies.ts" },
    {
      name: "launchsense:sbom:license_read",
      value:
        `${inventory.counted} lockfile entries read, ${inventory.unknown} of them ${UNKNOWN_LICENSE}. ` +
        inventory.note,
    },
    {
      name: "launchsense:sbom:timestamp",
      value:
        options.generatedAt === undefined
          ? "not asserted. This document carries no build time, because a generator that stamped a clock would produce different bytes for the same lockfile."
          : `build time supplied by the caller: ${options.generatedAt}`,
    },
    {
      name: "launchsense:sbom:hashes",
      value:
        "none emitted. No package tarball was downloaded or hashed, so there is no artefact to hash. The lockfile's own integrity field is not emitted as a CycloneDX hash, because that would claim a verification that did not happen.",
    },
    {
      name: "launchsense:sbom:dependency_graph",
      value:
        "not emitted. The licence inventory carries no dependency edges, so a dependencies array would state that each transitive package depends on nothing, which is false.",
    },
    {
      name: "launchsense:sbom:duplicate_paths",
      value: `${duplicates} lockfile path(s) collapsed into an existing component, because a package installed at two paths is one component.`,
    },
    {
      name: "launchsense:sbom:ecosystem_coverage",
      value:
        "npm only, from this repository's own lockfile. " +
        inventory.notCovered.join(" ") +
        " A component in one of those is absent from this document because nothing was read about it, not because it has no obligations.",
    },
    {
      name: "launchsense:sbom:not_a_clearance",
      value:
        "This document states what each dependency declares. It is not legal advice and it is not a clearance. A person decides whether any obligation applies to how they ship.",
    },
  ];

  const document: CycloneDxDocument = {
    $schema: SCHEMA_URI,
    bomFormat: "CycloneDX",
    specVersion: "1.7",
    serialNumber: serial === null ? null : `urn:uuid:${serial}`,
    version: 1,
    metadata: {
      tools: {
        components: [
          {
            type: "application",
            name: "launchsense",
            version: options.toolVersion ?? options.project.version,
          },
        ],
      },
      component: {
        type: "application",
        "bom-ref": npmPurl(options.project.name, options.project.version),
        name: options.project.name,
        version: options.project.version,
        // `generic`, not `npm`: this project is private and unpublished, so an npm
        // coordinate would name a registry entry that does not exist.
        purl: `pkg:generic/${options.project.name}@${options.project.version}`,
        description: "The application this SBOM was generated for. The document describes its dependencies, not its source.",
      },
      properties: metadataProperties,
    },
    components: built,
    compositions: [
      {
        aggregate: "incomplete",
        assemblies: [npmPurl(options.project.name, options.project.version)],
        dependencies: refs,
      },
    ],
  };
  if (options.generatedAt !== undefined) document.metadata.timestamp = options.generatedAt;
  return document;
}

/** The document as JSON text, with the two-space indent a consumer reads well. */
export function renderSbom(document: CycloneDxDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

/** The fields CycloneDX 1.7 requires, checked here so a reader need not know them. */
export function requiredFieldsPresent(document: CycloneDxDocument): string[] {
  const missing: string[] = [];
  if (document.bomFormat !== "CycloneDX") missing.push("bomFormat");
  if (document.specVersion !== "1.7") missing.push("specVersion");
  if (document.serialNumber !== null && !document.serialNumber.startsWith("urn:uuid:")) {
    missing.push("serialNumber as a urn:uuid");
  }
  if (typeof document.version !== "number") missing.push("version");
  return missing;
}