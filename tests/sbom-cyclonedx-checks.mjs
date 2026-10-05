import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readNpmDependencyLicenses } from "../shared/licensing/dependencies.ts";
import { buildSbom, npmPurl, renderSbom, requiredFieldsPresent } from "../shared/licensing/sbom.ts";
import { UNKNOWN_LICENSE } from "../shared/licensing/spdx.ts";

// Wave 8, the SBOM. CycloneDX 1.7 is the format other tools already read, and it
// asks for two required fields. Everything below is about the four places a
// generated SBOM usually starts lying: the timestamp, the hashes, the dependency
// graph, and the unknown licence.
//
// The fixture lockfile is written out in full and covers every shape the licence
// inventory can produce: a plain id, a scoped package, a dev entry, a choice, an
// AND set, a deprecated id, a proprietary marker, a missing field, and a nested
// copy installed at two paths.

const LOCK = JSON.stringify({
  name: "fixture",
  lockfileVersion: 3,
  packages: {
    "": { name: "fixture", dependencies: { "left-pad": "^1.0.0" } },
    "node_modules/left-pad": { version: "1.3.0", license: "MIT" },
    "node_modules/@scope/apache-thing": { version: "2.0.0", license: "Apache-2.0", dev: true },
    "node_modules/bsd-thing": { version: "0.4.0", license: "BSD-3-Clause" },
    "node_modules/copyleft-thing": { version: "3.1.4", license: "AGPL-3.0-only" },
    "node_modules/proprietary-thing": { version: "0.0.1", license: "UNLICENSED" },
    "node_modules/dual-thing": { version: "2.0.0", license: "MIT OR Apache-2.0" },
    "node_modules/both-thing": { version: "1.0.0", license: "MIT AND Apache-2.0" },
    "node_modules/old-thing": { version: "1.0.0", license: "GPL-2.0" },
    "node_modules/unnamed-thing": { version: "0.0.2" },
    "node_modules/left-pad/node_modules/left-pad": { version: "1.3.0", license: "MIT" },
  },
});

const DIRECT = new Set(["left-pad", "@scope/apache-thing", "copyleft-thing"]);

const inventoryFor = (lock = LOCK) =>
  readNpmDependencyLicenses(lock, { directNames: DIRECT });

const PROJECT = { name: "fixture-app", version: "1.2.3" };

const build = (lock = LOCK, options = {}) => buildSbom(inventoryFor(lock), { project: PROJECT, ...options });

const componentNamed = (document, name) =>
  document.components.find((component) => component.name === name);

const propertyNamed = (component, name) =>
  component.properties.find((property) => property.name === name)?.value;

describe("the CycloneDX document carries the fields the specification requires", () => {
  it("names the format and the version, and nothing is missing", async () => {
    const document = await build();
    assert.deepEqual(
      requiredFieldsPresent(document),
      [],
      "CycloneDX 1.7 requires bomFormat and specVersion, and recommends a urn:uuid serial and a version",
    );
    assert.equal(document.bomFormat, "CycloneDX");
    assert.equal(document.specVersion, "1.7");
    assert.equal(document.version, 1);
    assert.match(document.serialNumber, /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.match(document.$schema, /bom-1\.7\.schema\.json$/);
  });

  it("names the tool that produced it and the application it describes", async () => {
    const document = await build();
    assert.equal(document.metadata.tools.components[0].type, "application");
    assert.equal(document.metadata.tools.components[0].name, "launchsense");
    assert.equal(document.metadata.component.name, "fixture-app");
    assert.equal(document.metadata.component.version, "1.2.3");
    assert.equal(
      document.metadata.component.purl,
      "pkg:generic/fixture-app@1.2.3",
      "a private, unpublished project gets a generic coordinate, not an npm one that does not exist",
    );
  });

  it("states its own completeness, because the lockfile covers npm only", async () => {
    const document = await build();
    assert.equal(document.compositions.length, 1);
    assert.equal(document.compositions[0].aggregate, "incomplete");
    assert.ok(propertyNamed(document.metadata, "launchsense:sbom:ecosystem_coverage"));
    assert.match(propertyNamed(document.metadata, "launchsense:sbom:ecosystem_coverage"), /npm only/);
    assert.match(propertyNamed(document.metadata, "launchsense:sbom:ecosystem_coverage"), /yarn\.lock/);
    assert.match(
      propertyNamed(document.metadata, "launchsense:sbom:ecosystem_coverage"),
      /absent from this document because nothing was read/,
    );
  });
});

describe("the document is deterministic, so two runs can be compared", () => {
  it("produces byte-identical text for the same inventory", async () => {
    const first = renderSbom(await build());
    const second = renderSbom(await build());
    assert.equal(first, second);
  });

  it("does not depend on the order the lockfile happens to list entries", async () => {
    const parsed = JSON.parse(LOCK);
    const reversed = JSON.stringify({
      lockfileVersion: 3,
      packages: Object.fromEntries(Object.entries(parsed.packages).reverse()),
    });
    assert.equal(renderSbom(await build(reversed)), renderSbom(await build()));
  });

  it("derives the serial number from the content, not from a random or a clock", async () => {
    const first = await build();
    const second = await build();
    assert.equal(first.serialNumber, second.serialNumber);
    const other = await build(LOCK.replace("1.3.0", "1.3.1"));
    assert.notEqual(
      other.serialNumber,
      first.serialNumber,
      "a different dependency set must give a different document identity",
    );
  });
});

describe("every component carries coordinates and an SPDX id, or says why it has neither", () => {
  it("matches the licence inventory component for component", async () => {
    const inventory = inventoryFor();
    const document = await build();
    for (const item of inventory.components) {
      const component = componentNamed(document, item.name);
      assert.ok(
        component === undefined || component.version === item.version,
        `the inventory has ${item.name}@${item.version} and the document disagrees`,
      );
    }
    // Every inventory entry appears exactly once per name and version.
    const pairs = document.components.map((component) => `${component.name}@${component.version}`);
    assert.equal(new Set(pairs).size, pairs.length, "every component appears once");
    assert.equal(
      document.components.length,
      new Set(inventory.components.map((item) => `${item.name}@${item.version}:${item.spdx}`)).size,
      "the same package installed at two paths is one component",
    );
  });

  it("writes a resolved licence as an SPDX id", async () => {
    const document = await build();
    assert.deepEqual(componentNamed(document, "left-pad").licenses, [{ license: { id: "MIT" } }]);
    assert.deepEqual(componentNamed(document, "bsd-thing").licenses, [{ license: { id: "BSD-3-Clause" } }]);
    assert.deepEqual(componentNamed(document, "copyleft-thing").licenses, [
      { license: { id: "AGPL-3.0-only" } },
    ]);
  });

  it("uses the SPDX id for a deprecated one and marks the deprecation", async () => {
    const document = await build();
    const old = componentNamed(document, "old-thing");
    assert.deepEqual(old.licenses, [{ license: { id: "GPL-2.0" } }]);
    assert.match(
      propertyNamed(old, "launchsense:license:deprecated"),
      /deprecated SPDX identifier/,
      "a deprecated id still names a licence text, and the reader must be told",
    );
  });

  it("keeps a choice as an expression and asserts no id", async () => {
    const document = await build();
    const dual = componentNamed(document, "dual-thing");
    assert.deepEqual(dual.licenses, [{ expression: "MIT OR Apache-2.0" }]);
    assert.equal(dual.licenses[0].license, undefined, "a choice must not become one licence");
    assert.match(propertyNamed(dual, "launchsense:license:choice_unresolved"), /offers a choice/);
  });

  it("keeps an AND set as one expression, so both licences survive", async () => {
    const document = await build();
    assert.deepEqual(componentNamed(document, "both-thing").licenses, [
      { expression: "MIT AND Apache-2.0" },
    ]);
  });

  it("writes a proprietary marker as a name, because it is not an SPDX id", async () => {
    const document = await build();
    const proprietary = componentNamed(document, "proprietary-thing");
    assert.deepEqual(proprietary.licenses, [
      { license: { name: "LicenseRef-Proprietary-UNLICENSED" } },
    ]);
    assert.equal(proprietary.licenses[0].license.id, undefined, "there is no such SPDX id");
  });

  it("writes an unknown licence as a name with its reason, never as an id", async () => {
    const document = await build();
    const unnamed = componentNamed(document, "unnamed-thing");
    assert.deepEqual(unnamed.licenses, [{ license: { name: UNKNOWN_LICENSE } }]);
    assert.equal(unnamed.licenses[0].license.id, undefined, "Unknown is not a licence id");
    assert.match(propertyNamed(unnamed, "launchsense:license:unknown_reason"), /no licence field/);
    for (const component of document.components) {
      assert.notEqual(component.licenses[0]?.license?.id, UNKNOWN_LICENSE);
    }
  });

  it("percent-encodes a scoped name and keeps it whole", async () => {
    const document = await build();
    const scoped = componentNamed(document, "@scope/apache-thing");
    assert.equal(scoped.purl, "pkg:npm/%40scope/apache-thing@2.0.0");
    assert.equal(scoped["bom-ref"], scoped.purl, "the bom-ref is the coordinate, so it is unique");
    assert.equal(npmPurl("react", "19.2.0"), "pkg:npm/react@19.2.0");
  });

  it("carries depth, dev, and the source each licence was read from", async () => {
    const document = await build();
    assert.equal(propertyNamed(componentNamed(document, "left-pad"), "launchsense:dependency:depth"), "direct");
    assert.equal(
      propertyNamed(componentNamed(document, "bsd-thing"), "launchsense:dependency:depth"),
      "transitive",
    );
    assert.equal(propertyNamed(componentNamed(document, "@scope/apache-thing"), "launchsense:dependency:dev"), "true");
    assert.equal(propertyNamed(componentNamed(document, "left-pad"), "launchsense:dependency:source"), "lockfile");
  });

  it("counts the paths it collapsed, rather than losing them quietly", async () => {
    const document = await build();
    const inventory = inventoryFor();
    assert.equal(inventory.counted, 10, "the fixture lockfile lists ten installed entries");
    assert.equal(document.components.length, 9, "and the nested copy is one component, not two");
    assert.match(propertyNamed(document.metadata, "launchsense:sbom:duplicate_paths"), /^1 lockfile path/);
  });
});

describe("the four places a generated SBOM would lie are left empty and named", () => {
  it("emits no hash, and says there is no artefact to hash", async () => {
    const document = await build();
    assert.equal(
      JSON.stringify(document).includes('"hashes"'),
      false,
      "no artefact was hashed, so no hashes array may exist",
    );
    assert.match(propertyNamed(document.metadata, "launchsense:sbom:hashes"), /^none emitted/);
    assert.match(propertyNamed(document.metadata, "launchsense:sbom:hashes"), /integrity field is not emitted/);
  });

  it("emits no dependency graph, because the inventory carries no edges", async () => {
    const document = await build();
    assert.equal(
      JSON.stringify(document).includes('"dependsOn"'),
      false,
      "an empty graph would claim each package depends on nothing",
    );
    assert.match(propertyNamed(document.metadata, "launchsense:sbom:dependency_graph"), /not emitted/);
  });

  it("stamps no timestamp unless a real build time was supplied", async () => {
    const plain = await build();
    assert.equal(plain.metadata.timestamp, undefined, "a generator must not read a clock");
    assert.match(propertyNamed(plain.metadata, "launchsense:sbom:timestamp"), /not asserted/);
    const stamped = await build(LOCK, { generatedAt: "2026-10-06T00:00:00Z" });
    assert.equal(stamped.metadata.timestamp, "2026-10-06T00:00:00Z");
    assert.match(propertyNamed(stamped.metadata, "launchsense:sbom:timestamp"), /2026-10-06T00:00:00Z/);
    // Same inventory, different input, so a different document. That is the point.
    assert.notEqual(renderSbom(stamped), renderSbom(plain));
  });

  it("says it is not a clearance, in the document itself", async () => {
    const document = await build();
    assert.match(propertyNamed(document.metadata, "launchsense:sbom:not_a_clearance"), /not legal advice/);
    assert.match(propertyNamed(document.metadata, "launchsense:sbom:not_a_clearance"), /A person decides/);
  });
});

describe("the document round-trips as JSON and keeps its shape", () => {
  it("parses back to the same value", async () => {
    const text = renderSbom(await build());
    const parsed = JSON.parse(text);
    assert.equal(parsed.bomFormat, "CycloneDX");
    assert.ok(text.endsWith("\n"), "a generated file ends with a newline");
    assert.deepEqual(requiredFieldsPresent(parsed), []);
  });

  it("has no field the format does not define", async () => {
    const document = await build();
    for (const key of Object.keys(document)) {
      assert.ok(
        ["$schema", "bomFormat", "specVersion", "serialNumber", "version", "metadata", "components", "compositions"].includes(key),
        `${key} is not a CycloneDX 1.7 top-level field`,
      );
    }
    for (const key of Object.keys(document.metadata)) {
      assert.ok(
        ["timestamp", "tools", "component", "properties"].includes(key),
        `metadata.${key} is not a CycloneDX 1.7 metadata field`,
      );
    }
    for (const key of Object.keys(document.components[0])) {
      assert.ok(
        ["type", "bom-ref", "name", "version", "purl", "licenses", "properties"].includes(key),
        `components[].${key} is not a CycloneDX 1.7 component field`,
      );
    }
  });
});