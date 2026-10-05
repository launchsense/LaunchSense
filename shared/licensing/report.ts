// The rows a licence declaration produces: one info row for the inventory, and
// one row per component whose terms a person has to read.
//
// The rows live here rather than in the scan action so the hosted path, the
// local review and the tests all emit the same thing. A row that was written
// twice is two definitions of what a licence finding is.
//
// An Unknown licence never produces a row. It is counted in the inventory row,
// and it stays Unknown. A row would give an unknown a severity, and a severity
// on a licence nobody read is the failure this whole lane exists to prevent.

import { licenseObligation } from "./obligations.ts";
import type { LicenseFamily, LicenseObligation } from "./obligations.ts";
import { UNKNOWN_LICENSE } from "./spdx.ts";
import type { DependencyLicense, DependencyLicenseInventory } from "./dependencies.ts";
import type { Severity } from "../policies/severity.ts";

export interface LicenseEvidenceRow {
  ruleId: string;
  path: string;
  line: number;
  severity: Severity;
  snippet: string;
}

export interface LicenseFindingRow extends LicenseEvidenceRow {
  title: string;
  why: string;
  bucket: "actionable" | "info";
}

/**
 * How many per-component rows one scan names. A cap that is not named reads as
 * a complete list, so the count of what was left out is stated in the inventory
 * row and in the coverage note.
 */
export const DEPENDENCY_FINDING_CAP = 25;

/** Families where the terms need a person before anything ships. */
const FAMILY_SEVERITY: Record<LicenseFamily, Severity | null> = {
  permissive: null,
  "public-domain": null,
  // An unknown licence is not a family that gets a row. See the header note.
  unknown: null,
  "file-copyleft": "low",
  "library-copyleft": "medium",
  "strong-copyleft": "medium",
  "source-available": "medium",
  proprietary: "medium",
};

/** The obligations that apply to one component's declaration. */
export function componentObligations(component: DependencyLicense): LicenseObligation[] {
  // An OR expression is a choice the reader makes. It attaches no obligation
  // from either id: reading both would make a choice look like a set of duties,
  // and would give a copyleft option a severity the person never accepted.
  if (component.operator === "or") return [];
  if (component.spdx === UNKNOWN_LICENSE) return [];
  if (component.spdx.includes(" AND ")) {
    return component.spdx.split(" AND ").map((id) => licenseObligation(id.trim()));
  }
  return [licenseObligation(component.spdx)];
}

/** Null means no row, and the reason is that no obligation was read. */
export function componentSeverity(component: DependencyLicense): Severity | null {
  const families = componentObligations(component).map((obligation) => obligation.family);
  if (families.length === 0) return null;
  let worst: Severity | null = null;
  for (const family of families) {
    const severity = FAMILY_SEVERITY[family];
    if (severity === null) continue;
    if (worst === null || severity === "medium") worst = severity;
  }
  return worst;
}

function perIdCounts(inventory: DependencyLicenseInventory): string {
  const counts = new Map<string, number>();
  for (const component of inventory.components) {
    const key = component.spdx === UNKNOWN_LICENSE ? UNKNOWN_LICENSE : component.spdx;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => {
      if (a[0] === UNKNOWN_LICENSE) return 1;
      if (b[0] === UNKNOWN_LICENSE) return -1;
      return b[1] - a[1] || a[0].localeCompare(b[0]);
    })
    .map(([id, count]) => `${id} ${count}`)
    .join(", ");
}

/**
 * The inventory row. One per scan, always, even when nothing was read, because
 * a licence read that found nothing and a licence read that never ran are
 * different facts and only one of them is a pass.
 */
export function licenseEvidenceRows(
  inventory: DependencyLicenseInventory,
  path: string,
): LicenseEvidenceRow[] {
  const rows: LicenseEvidenceRow[] = [
    {
      ruleId: "license.inventory",
      path,
      line: 0,
      severity: "info",
      snippet: inventory.complete
        ? `dependency licences read: ${perIdCounts(inventory)}`
        : `dependency licences not read: ${inventory.note}`,
    },
  ];
  const actionable = inventory.components.filter(
    (component) => componentSeverity(component) !== null,
  );
  if (actionable.length > DEPENDENCY_FINDING_CAP) {
    rows.push({
      ruleId: "license.inventory",
      path,
      line: 0,
      severity: "info",
      snippet: `dependency licence rows stop at ${DEPENDENCY_FINDING_CAP}; ${actionable.length - DEPENDENCY_FINDING_CAP} more component(s) needing a decision are not named here`,
    });
  }
  if (inventory.unknown > 0) {
    rows.push({
      ruleId: "license.inventory",
      path,
      line: 0,
      severity: "info",
      snippet: `${inventory.unknown} component(s) read as ${UNKNOWN_LICENSE}; unknown is not a permissive licence and gets no severity`,
    });
  }
  for (const item of inventory.notCovered) {
    rows.push({
      ruleId: "license.inventory",
      path,
      line: 0,
      severity: "info",
      snippet: `dependency licences not read: ${item}`,
    });
  }
  return rows;
}

/**
 * One row per component whose terms need a person, capped and named.
 *
 * The title carries the coordinate and the declared id, so the row can be matched
 * to the same component on the next scan. That is what makes a licence change
 * visible on a rescan rather than only when the tree was first read.
 */
export function licenseFindingRows(
  inventory: DependencyLicenseInventory,
  path: string,
): LicenseFindingRow[] {
  if (!inventory.complete) return [];
  const rows: LicenseFindingRow[] = [
    {
      ruleId: "license.declaration",
      path,
      line: 0,
      severity: "info",
      title: "Dependency licence declaration",
      why:
        `The committed lockfile declares ${inventory.counted} installed npm packages. This row is the mix: ${perIdCounts(inventory)}. ` +
        "A per-dependency row appears only when the terms need a person, so this row is how a change between two permissive licences still shows up on a rescan. " +
        "It is a count, not a verdict, and not legal advice.",
      snippet: `dependency licence mix: ${perIdCounts(inventory)}`,
      bucket: "info",
    },
  ];
  const ranked = [...inventory.components].sort((a, b) => {
    const rankA = componentSeverity(a) === null ? 2 : componentSeverity(a) === "medium" ? 0 : 1;
    const rankB = componentSeverity(b) === null ? 2 : componentSeverity(b) === "medium" ? 0 : 1;
    if (rankA !== rankB) return rankA - rankB;
    return a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name);
  });
  let componentRows = 0;
  for (const component of ranked) {
    // The declaration row above is not a component, so the cap counts component
    // rows only and that one row always survives.
    if (componentRows >= DEPENDENCY_FINDING_CAP) break;
    const severity = componentSeverity(component);
    if (severity === null) continue;
    const obligations = componentObligations(component);
    const declared = component.spdx === UNKNOWN_LICENSE ? component.declared ?? UNKNOWN_LICENSE : component.spdx;
    const title = `${component.name}@${component.version} is ${declared}`;
    const parts: string[] = [];
    for (const obligation of obligations) {
      parts.push(`${obligation.id}: ${obligation.notices.join(" ")} Cited: ${obligation.cite}`);
    }
    if (component.operator === "or") {
      parts.push("This package offers a choice. The licence that applies is the one you pick, so read the one you pick.");
    }
    if (component.exceptions.length > 0) {
      parts.push(`An exception is named (${component.exceptions.join(", ")}), so the terms are not the base licence on its own.`);
    }
    if (component.deprecated) {
      parts.push("This id is deprecated in the SPDX list. The current form says whether only or or-later was meant, and this one does not.");
    }
    parts.push("This is what the licence text asks for. It is not a decision about how you ship it, and it is not legal advice.");
    rows.push({
      ruleId: "license.dependency",
      path,
      line: 0,
      severity,
      title,
      why: parts.join(" "),
      snippet: `dependency licence: ${component.name}@${component.version} ${declared} ${component.source}`,
      bucket: severity === "info" ? "info" : "actionable",
    });
    componentRows += 1;
  }
  return rows;
}