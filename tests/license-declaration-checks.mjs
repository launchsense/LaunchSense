import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  noLockfileInventory,
  readNpmDependencyLicenses,
} from "../shared/licensing/dependencies.ts";
import { licenseObligation, OBLIGATION_TABLE_NOTE } from "../shared/licensing/obligations.ts";
import { buildNoticeArtifact } from "../shared/licensing/notice.ts";
import {
  componentObligations,
  componentSeverity,
  licenseEvidenceRows,
  licenseFindingRows,
  DEPENDENCY_FINDING_CAP,
} from "../shared/licensing/report.ts";
import { UNKNOWN_LICENSE } from "../shared/licensing/spdx.ts";
import { promptIsWhitelisted } from "../shared/licensing/lookup.ts";
import { severityFor, reviewRequired } from "../shared/policies/severity.ts";

// Wave 7: the declaration lane. Before this, a licence scan read one story per
// repository and named no dependency. These read the same modules the scan
// reads, with a small fixture lockfile rather than the real one.

/** A small lockfile fixture. It is written out so every entry is inspectable. */
const LOCK = JSON.stringify({
  name: "fixture",
  lockfileVersion: 3,
  packages: {
    "": { name: "fixture", dependencies: { leftpad: "^1.0.0" } },
    "node_modules/left-pad": { version: "1.3.0", license: "MIT" },
    "node_modules/@scope/apache-thing": { version: "2.0.0", license: "Apache-2.0", dev: true },
    "node_modules/bsd-thing": { version: "0.4.0", license: "BSD-3-Clause" },
    "node_modules/weak-thing": { version: "1.0.0", license: "MPL-2.0" },
    "node_modules/copyleft-thing": { version: "3.1.4", license: "AGPL-3.0-only" },
    "node_modules/proprietary-thing": { version: "0.0.1", license: "UNLICENSED" },
    "node_modules/dual-thing": { version: "2.0.0", license: "MIT OR Apache-2.0" },
    "node_modules/plus-thing": { version: "1.0.0", license: "GPL-2.0+" },
    "node_modules/unnamed-thing": { version: "0.0.2" },
    "node_modules/slash-thing": { version: "1.0.0", license: "MIT/X11" },
    "node_modules/a/node_modules/nested-thing": { version: "9.9.9", license: "ISC" },
  },
});

const DIRECT = new Set(["left-pad", "@scope/apache-thing", "copyleft-thing", "dual-thing"]);

const read = (lock = LOCK, options = {}) =>
  readNpmDependencyLicenses(lock, { directNames: DIRECT, ...options });

const byName = (inventory, name) => inventory.components.find((c) => c.name === name);

describe("every installed dependency reads a licence, and an unread one is Unknown", () => {
  it("maps every lockfile entry to a licence, direct and transitive", () => {
    const inventory = read();
    assert.equal(inventory.complete, true, "a lockfile with a packages map is a complete read");
    assert.equal(inventory.counted, 11);
    assert.equal(
      inventory.components.length,
      Object.keys(JSON.parse(LOCK).packages).length - 1,
      "every entry the lockfile lists must appear, not only the direct ones",
    );
    assert.equal(byName(inventory, "left-pad").spdx, "MIT");
    assert.equal(byName(inventory, "left-pad").depth, "direct");
    assert.equal(byName(inventory, "bsd-thing").depth, "transitive");
    assert.equal(byName(inventory, "@scope/apache-thing").spdx, "Apache-2.0");
    assert.equal(byName(inventory, "@scope/apache-thing").dev, true, "a dev entry is marked dev");
    assert.equal(
      byName(inventory, "nested-thing").version,
      "9.9.9",
      "a nested copy reads as its own entry",
    );
  });

  it("reads an entry with no licence field as Unknown and says why", () => {
    const inventory = read();
    const unnamed = byName(inventory, "unnamed-thing");
    assert.equal(unnamed.spdx, UNKNOWN_LICENSE, "a missing licence field is Unknown");
    assert.equal(unnamed.declared, null);
    assert.match(unnamed.unknownReason, /no licence field/);
    assert.equal(inventory.unknown, 3, "no field, a non-expression, and a choice all read as Unknown");
  });

  it("reads a declaration that is not an SPDX expression as Unknown, not as a guess", () => {
    // MIT/X11 is a real npm string. `/` is not an SPDX operator, so the honest
    // answer is Unknown. Reading it as MIT because it looks like MIT is the
    // guess this lane exists to refuse.
    const component = byName(read(), "slash-thing");
    assert.equal(component.spdx, UNKNOWN_LICENSE);
    assert.equal(component.declared, "MIT/X11", "the declared string is kept as written");
    assert.match(component.unknownReason, /not an SPDX expression/);
  });

  it("normalizes a deprecated id without inventing an or-later it did not declare", () => {
    const component = byName(read(), "plus-thing");
    assert.equal(component.spdx, "GPL-2.0-or-later", "the plus form is unambiguous, so it normalizes");
    assert.equal(component.deprecated, false);
  });

  it("reads a proprietary UNLICENSED marker as a claim, not as Unknown", () => {
    const component = byName(read(), "proprietary-thing");
    assert.equal(component.spdx, "LicenseRef-Proprietary-UNLICENSED");
    assert.notEqual(component.spdx, UNKNOWN_LICENSE, "UNLICENSED grants nothing; it is not unknown");
  });

  it("keeps an OR expression as a choice and attaches no licence from it", () => {
    const component = byName(read(), "dual-thing");
    assert.equal(component.operator, "or");
    assert.equal(component.declared, "MIT OR Apache-2.0", "the exact declaration is kept");
    assert.match(component.unknownReason, /choice/);
  });

  it("keeps an AND expression as both licences, so both obligations survive", () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: { "": {}, "node_modules/both-thing": { version: "1.0.0", license: "MIT AND Apache-2.0" } },
    });
    const component = byName(read(lock), "both-thing");
    assert.equal(component.operator, "and");
    assert.equal(component.spdx, "MIT AND Apache-2.0");
    assert.equal(component.declared, "MIT AND Apache-2.0");
    const obligations = componentObligations(component);
    assert.deepEqual(obligations.map((o) => o.id), ["MIT", "Apache-2.0"], "both apply, so both are owed");
    assert.equal(
      obligations.find((o) => o.id === "Apache-2.0").requiresNoticeFile,
      true,
      "an AND set keeps the Apache NOTICE duty that reading the string as one id lost",
    );
  });

  it("reads a WITH expression as the licence plus its exception, never as the licence alone", () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": {},
        "node_modules/llvm-thing": { version: "1.0.0", license: "Apache-2.0 WITH LLVM-exception" },
        "node_modules/bison-thing": { version: "1.0.0", license: "GPL-3.0-or-later WITH Bison-exception-2.2" },
      },
    });
    const inventory = read(lock);
    const apache = byName(inventory, "llvm-thing");
    assert.equal(apache.spdx, "Apache-2.0", "the base id is what obligations are written against");
    assert.deepEqual(apache.exceptions, ["LLVM-exception"]);

    const bison = byName(inventory, "bison-thing");
    assert.deepEqual(bison.exceptions, ["Bison-exception-2.2"]);
    const row = licenseFindingRows(inventory, "package-lock.json").find((r) => r.title.includes("bison-thing"));
    assert.match(row.why, /exception is named \(Bison-exception-2\.2\)/);
    assert.match(row.why, /not the base licence on its own/);

    const text = buildNoticeArtifact(inventory).markdown;
    assert.match(text, /## Exceptions named by a package/);
    assert.match(text, /- LLVM-exception/);
    assert.match(text, /- Bison-exception-2\.2/);
  });

  it("falls back to the installed package.json when the lock omits the licence", () => {
    const withoutLockLicence = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": {},
        "node_modules/left-pad": { version: "1.3.0" },
      },
    });
    const blind = read(withoutLockLicence);
    assert.equal(byName(blind, "left-pad").spdx, UNKNOWN_LICENSE, "with nothing to read it is Unknown");

    const withManifest = read(withoutLockLicence, {
      readInstalledManifest: (name) =>
        name === "left-pad" ? JSON.stringify({ name: "left-pad", license: "MIT" }) : null,
    });
    const component = byName(withManifest, "left-pad");
    assert.equal(component.spdx, "MIT", "the installed manifest is the fallback the brief asks for");
    assert.equal(component.source, "installed-manifest");
  });

  it("reads Unknown when the lock and the installed manifest disagree", () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: { "": {}, "node_modules/left-pad": { version: "1.3.0", license: "MIT" } },
    });
    const inventory = read(lock, {
      readInstalledManifest: () => JSON.stringify({ license: "ISC" }),
    });
    const component = byName(inventory, "left-pad");
    assert.equal(component.spdx, UNKNOWN_LICENSE, "two declarations that disagree leave no answer");
    assert.match(component.unknownReason, /lockfile says MIT/);
    assert.match(component.unknownReason, /package\.json says ISC/);
  });

  it("does not call a capital letter a disagreement", () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: { "": {}, "node_modules/left-pad": { version: "1.3.0", license: "mit" } },
    });
    const inventory = read(lock, {
      readInstalledManifest: () => JSON.stringify({ license: "MIT" }),
    });
    assert.equal(byName(inventory, "left-pad").spdx, "MIT", "one licence written two ways is one licence");
  });

  it("reads a lockfile with no packages map as incomplete, not as zero licences", () => {
    const v1 = JSON.stringify({ lockfileVersion: 1, dependencies: { "left-pad": { version: "1.3.0" } } });
    const inventory = read(v1);
    assert.equal(inventory.complete, false, "a v1 lockfile has no packages map, so the read is not complete");
    assert.equal(inventory.counted, 0);
    assert.match(inventory.note, /no packages map/);
    assert.ok(inventory.notCovered.length > 0, "a read that did not run still names its gaps");
  });

  it("names the gaps it did not read, so an empty list is never read as complete", () => {
    const gaps = read().notCovered.join(" ");
    for (const gap of ["yarn.lock", "pnpm-lock.yaml", "Cargo", "vendored", "SPDX header"]) {
      assert.ok(gaps.includes(gap), `the not-covered list must name ${gap}`);
    }
    assert.match(noLockfileInventory().note, /not a project with no dependencies/);
  });
});

describe("the obligations table says what a licence text asks for", () => {
  it("states the table is not a legal engine, in the artifact as well as the source", () => {
    assert.match(OBLIGATION_TABLE_NOTE, /not legal advice/);
    assert.match(OBLIGATION_TABLE_NOTE, /question for a person/);
    assert.ok(buildNoticeArtifact(read()).markdown.includes(OBLIGATION_TABLE_NOTE));
  });

  it("gives MIT attribution and nothing else", () => {
    const mit = licenseObligation("MIT");
    assert.equal(mit.family, "permissive");
    assert.equal(mit.requiresLicenseText, true);
    assert.equal(mit.requiresCopyrightNotice, true);
    assert.equal(mit.requiresNoticeFile, false, "MIT has no NOTICE file concept");
    assert.equal(mit.requiresStateOfChanges, false);
    assert.equal(mit.requiresSourceDisclosure, false);
    assert.match(mit.cite, /copyright notice/);
  });

  it("gives Apache-2.0 the NOTICE file, the change markers and the licence copy", () => {
    const apache = licenseObligation("Apache-2.0");
    assert.equal(apache.family, "permissive");
    assert.equal(apache.requiresNoticeFile, true, "section 4d is the whole reason a NOTICE file exists");
    assert.equal(apache.requiresStateOfChanges, true, "section 4b is an editing obligation");
    assert.equal(apache.requiresLicenseText, true, "section 4a");
    assert.equal(apache.requiresSourceDisclosure, false, "Apache-2.0 has no copyleft");
    assert.match(apache.cite, /4d/);
    assert.ok(apache.notices.some((n) => /NOTICE file/i.test(n)));
  });

  it("gives BSD-3-Clause the endorsement clause, which is the reason it is not BSD-2", () => {
    const bsd = licenseObligation("BSD-3-Clause");
    assert.equal(bsd.requiresNoticeFile, false);
    assert.equal(bsd.requiresSourceDisclosure, false);
    assert.ok(bsd.notices.some((n) => /endorse/i.test(n)), "clause 3 is a marketing restriction, not a notice");
    assert.match(bsd.cite, /Neither the name of the copyright holder/);
    assert.notEqual(
      licenseObligation("BSD-2-Clause").notices.join(" "),
      bsd.notices.join(" "),
      "normalising BSD-2 into BSD-3 would lose clause 3",
    );
  });

  it("gives a strong copyleft id source disclosure and the distribution clash", () => {
    for (const id of ["AGPL-3.0-only", "GPL-3.0-or-later", "GPL-2.0-only"]) {
      const copyleft = licenseObligation(id);
      assert.equal(copyleft.family, "strong-copyleft", `${id} is strong copyleft`);
      assert.equal(copyleft.requiresSourceDisclosure, true, `${id} requires source disclosure`);
      assert.equal(copyleft.requiresDistributionReview, true, `${id} collides with permissive terms`);
      assert.match(copyleft.cite, /GPL|AGPL/);
    }
    const agpl = licenseObligation("AGPL-3.0-only");
    assert.ok(agpl.notices.some((n) => /network/i.test(n)), "AGPL section 13 is the network clause");
    assert.match(agpl.cite, /section 13/);
  });

  it("reads an id it has no row for as Unknown, asserting nothing", () => {
    const unknown = licenseObligation("Something-We-Do-Not-Read-1.0");
    assert.equal(unknown.family, "unknown");
    assert.equal(unknown.requiresLicenseText, false);
    assert.equal(unknown.requiresSourceDisclosure, false);
    assert.match(unknown.cite, /No licence text was read/);
  });
});

describe("the generated NOTICE is a deterministic record a person can commit", () => {
  it("produces byte-identical output for the same input", () => {
    const first = buildNoticeArtifact(read(), { project: "fixture" });
    const second = buildNoticeArtifact(read(), { project: "fixture" });
    assert.equal(first.markdown, second.markdown);
    assert.equal(first.markdown.length, second.markdown.length);
  });

  it("does not depend on the order the lockfile happens to list its entries", () => {
    const parsed = JSON.parse(LOCK);
    const reversed = JSON.stringify({
      lockfileVersion: 3,
      packages: Object.fromEntries(Object.entries(parsed.packages).reverse()),
    });
    assert.equal(
      buildNoticeArtifact(read(reversed), { project: "fixture" }).markdown,
      buildNoticeArtifact(read(), { project: "fixture" }).markdown,
    );
  });

  it("names every component with its licence, and an unknown one as unknown", () => {
    const text = buildNoticeArtifact(read(), { project: "fixture" }).markdown;
    assert.match(text, /# Third-party notices for fixture/);
    assert.match(text, /left-pad@1\.3\.0 \(direct\) declares MIT/);
    assert.match(text, /@scope\/apache-thing@2\.0\.0 \(direct, dev\) declares Apache-2\.0/);
    assert.match(text, /copyleft-thing@3\.1\.4 \(direct\) declares AGPL-3\.0-only/);
    assert.match(text, /- unnamed-thing@0\.0\.2 \(transitive\) declares no licence field declared/);
    assert.match(text, /## Unknown/);
    assert.match(text, /An unknown licence is not a permissive licence/);
  });

  it("states the notice each licence requires, with the clause it came from", () => {
    const text = buildNoticeArtifact(read(), { project: "fixture" }).markdown;
    assert.match(text, /Apache-2\.0: Give every recipient a copy of the licence \(section 4a\)/);
    assert.match(text, /Cited: Apache License 2\.0 sections 4a, 4b, 4c and 4d/);
    assert.match(text, /MPL-2\.0: .*Keep the covered files under MPL-2\.0/);
    assert.match(text, /The copyleft is per file, not per project/);
    assert.match(text, /BSD-3-Clause: .*endorse or promote/);
  });

  it("says which families ask for a NOTICE file, because that is the hard requirement", () => {
    const text = buildNoticeArtifact(read(), { project: "fixture" }).markdown;
    assert.match(text, /Apache-2\.0 in this list ask\(s\) for a NOTICE file/);
  });

  it("carries the not-covered lines into the file, so the record has its gaps in it", () => {
    const text = buildNoticeArtifact(read(), { project: "fixture" }).markdown;
    assert.match(text, /## Not covered/);
    assert.match(text, /vendored tree such as vendor\//);
    assert.match(text, /not because it has no obligations/);
    assert.match(text, /not legal advice/);
  });

  it("names an unlisted component as absent from the record, not as clean", () => {
    const noLock = buildNoticeArtifact(noLockfileInventory(), { project: "fixture" });
    assert.match(noLock.markdown, /## Not complete/);
    assert.match(noLock.markdown, /No npm lockfile was read/);
    assert.match(noLock.markdown, /not a project with no dependencies/);
  });
});

describe("an unknown licence never becomes a finding and never gets a severity", () => {
  it("gives an Unknown component no severity at all", () => {
    const inventory = read();
    for (const name of ["unnamed-thing", "slash-thing", "dual-thing"]) {
      assert.equal(
        componentSeverity(byName(inventory, name)),
        null,
        `${name} reads as Unknown, so no severity may be attached to it`,
      );
    }
  });

  it("emits no per-component row for an Unknown licence", () => {
    const rows = licenseFindingRows(read(), "package-lock.json").filter(
      (row) => row.ruleId === "license.dependency",
    );
    const titles = rows.map((row) => row.title).join("\n");
    assert.ok(!titles.includes("unnamed-thing"), "an unknown licence must not be a finding");
    assert.ok(!titles.includes("slash-thing"));
    assert.ok(!titles.includes("dual-thing"), "a choice is not a licence fact yet");
    for (const row of rows) {
      assert.notEqual(row.severity, "high", "no licence row is high; the terms are not a threat claim");
    }
  });

  it("counts an Unknown licence in the declaration mix rather than leaving it out", () => {
    const declaration = licenseFindingRows(read(), "package-lock.json").find(
      (row) => row.ruleId === "license.declaration",
    );
    assert.equal(declaration.severity, "info");
    assert.match(declaration.snippet, new RegExp(`mix: .*${UNKNOWN_LICENSE} 3`), "the unknown count is in the mix");
    assert.match(declaration.why, /not a verdict/);
  });

  it("counts the unknown in the inventory row instead, at info", () => {
    const rows = licenseEvidenceRows(read(), "package-lock.json");
    const counted = rows.find((row) => row.snippet.includes("read as Unknown"));
    assert.ok(counted, "the unknown count must be stated somewhere");
    assert.equal(counted.ruleId, "license.inventory");
    assert.equal(counted.severity, "info");
    assert.equal(severityFor("license.inventory"), "info");
    assert.equal(reviewRequired(severityFor("license.inventory")), false);
    assert.match(counted.snippet, /unknown is not a permissive licence and gets no severity/);
  });

  it("rows the licences that do need a person, at the band their family names", () => {
    const rows = licenseFindingRows(read(), "package-lock.json").filter(
      (row) => row.ruleId === "license.dependency",
    );
    const at = (name) => rows.find((row) => row.title.startsWith(`${name}@`));
    assert.equal(at("copyleft-thing").severity, "medium", "strong copyleft needs a person");
    assert.equal(at("proprietary-thing").severity, "medium", "a proprietary claim needs a person");
    assert.equal(at("weak-thing").severity, "low", "file-level copyleft is advisory");
    assert.equal(severityFor("license.dependency"), "medium");
    assert.equal(reviewRequired(severityFor("license.dependency")), true);
    assert.match(at("copyleft-thing").why, /question|person|advice/i);
    assert.match(at("copyleft-thing").why, /not legal advice/);
  });

  it("names the cap when it binds, so a truncated list is never read as complete", () => {
    const many = JSON.stringify({
      lockfileVersion: 3,
      packages: Object.fromEntries([
        ["", {}],
        ...Array.from({ length: DEPENDENCY_FINDING_CAP + 5 }, (_unused, index) => [
          `node_modules/copy-${index}`,
          { version: "1.0.0", license: "AGPL-3.0-only" },
        ]),
      ]),
    });
    const inventory = read(many);
    const componentRows = licenseFindingRows(inventory, "package-lock.json").filter(
      (row) => row.ruleId === "license.dependency",
    );
    assert.equal(componentRows.length, DEPENDENCY_FINDING_CAP);
    const declaration = licenseFindingRows(inventory, "package-lock.json").find(
      (row) => row.ruleId === "license.declaration",
    );
    assert.ok(declaration, "the declaration row survives the component cap, or a capped scan has no record at all");
    assert.equal(declaration.severity, "info");
    const capped = licenseEvidenceRows(inventory, "package-lock.json").find((row) =>
      row.snippet.includes("stop at"),
    );
    assert.ok(capped, "a cap that is not named reads as a complete list");
    assert.match(capped.snippet, /5 more component/);
  });

  it("emits no row at all when no lockfile was read", () => {
    assert.deepEqual(licenseFindingRows(noLockfileInventory(), "(repo)"), []);
    const rows = licenseEvidenceRows(noLockfileInventory(), "(repo)");
    assert.ok(rows.every((row) => row.severity === "info"));
    assert.ok(rows.some((row) => row.snippet.includes("No npm lockfile was read")));
  });
});
// The red/blue pass found that an OR choice attached obligations from both
// options, so a copyleft option gave a choice a severity, and that an AND set
// with an unreadable id fabricated "X AND Unknown" while reading as complete.
describe("an Unknown or a choice never becomes a row, even beside a copyleft option", () => {
  const withLicense = (license) =>
    read(
      JSON.stringify({
        lockfileVersion: 3,
        packages: { "": {}, "node_modules/x": { version: "1.0.0", license } },
      }),
    );

  it("gives an OR choice no obligation and no severity, answering a copyleft option too", () => {
    const inventory = withLicense("MIT OR GPL-3.0");
    const component = byName(inventory, "x");
    assert.equal(component.operator, "or");
    assert.deepEqual(componentObligations(component), [], "a choice attaches nothing from either id");
    assert.equal(componentSeverity(component), null, "a choice gets no severity");
    const rows = licenseFindingRows(inventory, "(repo)").filter((row) => row.title.includes("x@1.0.0"));
    assert.deepEqual(rows, [], "a choice is not a licence fact, so it gets no per-component row");
  });

  it("reads an AND set with an unreadable id as Unknown, not as a fabricated id", () => {
    const inventory = withLicense("AGPL-3.0 AND Bogus-1.0");
    const component = byName(inventory, "x");
    assert.equal(component.spdx, UNKNOWN_LICENSE, "one unreadable id makes the set not fully known");
    assert.ok(inventory.unknown >= 1, "an unreadable id must count as unknown, not as a complete read");
    assert.deepEqual(componentObligations(component), [], "Unknown attaches no obligation");
    assert.equal(componentSeverity(component), null);
    const rows = licenseFindingRows(inventory, "(repo)").filter((row) => row.title.includes("x@1.0.0"));
    assert.deepEqual(rows, [], "an Unknown gets no per-component row");
  });
});

describe("the notice does not contradict itself about NOTICE files", () => {
  it("counts a component whose AND set needs a NOTICE file", () => {
    const inventory = read(
      JSON.stringify({
        lockfileVersion: 3,
        packages: { "": {}, "node_modules/both": { version: "1.0.0", license: "MIT AND Apache-2.0" } },
      }),
    );
    const artifact = buildNoticeArtifact(inventory, {});
    assert.ok(
      !artifact.markdown.includes("No licence in this list asks for a NOTICE file"),
      "an Apache-2.0 component needs a NOTICE file, so the summary must not deny one",
    );
    assert.match(artifact.markdown, /Apache-2\.0/, "the summary must name the family that asks for it");
  });
});

describe("a workspace lockfile names what it did not read", () => {
  it("counts a link entry and says so, instead of vanishing behind a complete read", () => {
    const inventory = read(
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": {},
          "node_modules/local": { link: true },
          "node_modules/dep": { version: "1.0.0", license: "MIT" },
        },
      }),
    );
    assert.ok(
      inventory.notCovered.some((line) => /workspace link/i.test(line)),
      "a skipped workspace link must be named in notCovered, not dropped",
    );
  });
});

describe("the licence prompt whitelist verifies its result, not itself", () => {
  const TEMPLATE =
    "Name the SPDX licence id for the npm package NAME at version VERSION. " +
    "The lockfile did not read a licence for it. " +
    "Answer with one SPDX id or the word Unknown. " +
    "Do not add words. Do not explain.";

  it("refuses a prompt that still carries a placeholder", () => {
    assert.equal(
      promptIsWhitelisted(TEMPLATE, { name: "x", version: "1.0.0" }),
      false,
      "an unsubstituted placeholder must be refused",
    );
  });

  it("refuses a name that swaps the two placeholders", () => {
    // A package named VERSIONfoo used to make the rebuilt template match itself.
    const swapped = TEMPLATE.replace("NAME", "VERSIONfoo").replace("VERSION", "1.0.0");
    assert.equal(
      promptIsWhitelisted(swapped, { name: "VERSIONfoo", version: "1.0.0" }),
      false,
      "the request's own name must be present, or the guard is tautological",
    );
  });
});
