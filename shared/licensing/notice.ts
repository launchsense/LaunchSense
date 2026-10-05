// The declaration artifact. Third-party components, their licences, and the
// notices those licences require, as one deterministic text a person can commit
// next to their code.
//
// Deterministic is the point. The same inventory must produce byte-identical
// bytes, so there is no clock, no run id, and no iteration order left to chance.
// A record that changes when nothing changed is not a record.
//
// What this file does not do: it does not decide whether the obligations are
// met, it does not merge licence texts, and it does not read anything the
// inventory did not already read.

import { licenseObligation, OBLIGATION_TABLE_NOTE } from "./obligations.ts";
import type { LicenseObligation } from "./obligations.ts";
import { UNKNOWN_LICENSE } from "./spdx.ts";
import type { DependencyLicense, DependencyLicenseInventory } from "./dependencies.ts";

export interface NoticeArtifact {
  filename: string;
  markdown: string;
  componentCount: number;
  unknownCount: number;
  /** The not-covered lines this artifact carries verbatim. */
  notCovered: string[];
  note: string;
}

export interface NoticeOptions {
  /** Project name, used only in the header line. */
  project?: string;
}

const NOT_A_LEGAL_ENGINE =
  "This file is a declaration of what each dependency says its licence is. It is not legal advice, " +
  "and it is not a clearance. A person decides whether any obligation applies to how you ship.";

/** The ids a family key is written under, so one section covers one licence. */
function sectionKey(component: DependencyLicense): string {
  return component.spdx;
}

/** The ids an OR choice offers, read as a choice and not as a licence. */
function choiceIds(component: DependencyLicense): string[] {
  if (component.operator !== "or") return [];
  const fromDeclaration = component.declared ?? "";
  return fromDeclaration
    .split(/\s+OR\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function componentLine(component: DependencyLicense): string {
  const depth = component.depth === "direct" ? "direct" : "transitive";
  const dev = component.dev ? ", dev" : "";
  const declared = component.declared === null ? "no licence field declared" : component.declared;
  const deprecated = component.deprecated ? " (deprecated SPDX id)" : "";
  return `- ${component.name}@${component.version} (${depth}${dev}) declares ${declared}${deprecated}`;
}

/** The notices that apply to one component, in the order the table states them. */
function noticesFor(component: DependencyLicense): LicenseObligation[] {
  if (component.operator === "or") {
    return choiceIds(component).map((id) => licenseObligation(id));
  }
  if (component.spdx === UNKNOWN_LICENSE) return [];
  if (component.spdx.includes(" AND ")) {
    return component.spdx.split(" AND ").map((id) => licenseObligation(id.trim()));
  }
  return [licenseObligation(component.spdx)];
}

function obligationBlock(obligations: LicenseObligation[]): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const obligation of obligations) {
    if (seen.has(obligation.id)) continue;
    seen.add(obligation.id);
    lines.push(`- ${obligation.id}: ${obligation.notices.join(" ")}`);
    lines.push(`  Cited: ${obligation.cite}`);
  }
  return lines;
}

/**
 * Build the notice artifact.
 *
 * Components are grouped by licence and sorted by name, so a reader can find a
 * component and so two runs of the same input match byte for byte. An Unknown
 * licence gets its own section that says nothing was read, because folding it
 * into a permissive group is the one thing this artifact must never do.
 */
export function buildNoticeArtifact(
  inventory: DependencyLicenseInventory,
  options: NoticeOptions = {},
): NoticeArtifact {
  const project = options.project ?? "This project";
  const lines: string[] = [];
  lines.push(`# Third-party notices for ${project}`);
  lines.push("");
  lines.push(
    "Generated from the npm lockfile this repository commits, so it lists what the lockfile " +
      "declares, not what a registry says today. Same lockfile in, same file out.",
  );
  lines.push("");
  lines.push(NOT_A_LEGAL_ENGINE);
  lines.push("");
  lines.push(OBLIGATION_TABLE_NOTE);
  lines.push("");

  const noticeFileFamilies = inventory.components
    .map((component) => licenseObligation(component.spdx))
    .filter((obligation) => obligation.requiresNoticeFile)
    .map((obligation) => obligation.id);
  const uniqueNoticeFamilies = [...new Set(noticeFileFamilies)].sort();

  lines.push(`## Summary`);
  lines.push("");
  lines.push(inventory.note);
  lines.push("");
  lines.push(
    `${uniqueNoticeFamilies.length === 0
      ? "No licence in this list asks for a NOTICE file."
      : `${uniqueNoticeFamilies.join(", ")} in this list ask(s) for a NOTICE file. The notices their components carry are listed under each licence below.`}`,
  );
  lines.push("");

  if (!inventory.complete) {
    lines.push("## Not complete");
    lines.push("");
    lines.push(inventory.note);
    lines.push("");
  }

  const groups = new Map<string, DependencyLicense[]>();
  const seenComponents = new Set<string>();
  for (const component of inventory.components) {
    // A lockfile lists one entry per install path, so the same name and version
    // can appear several times when several packages depend on it. A person
    // reading this file needs the component once, not once per path.
    const componentKey = `${component.name}@${component.version}:${component.spdx}`;
    if (seenComponents.has(componentKey)) continue;
    seenComponents.add(componentKey);
    const key = sectionKey(component);
    const bucket = groups.get(key) ?? [];
    bucket.push(component);
    groups.set(key, bucket);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    // Unknown last, so the parts that were read come first.
    if (a === UNKNOWN_LICENSE) return 1;
    if (b === UNKNOWN_LICENSE) return -1;
    return a.localeCompare(b);
  });

  for (const key of keys) {
    const bucket = groups.get(key) ?? [];
    lines.push(`## ${key}`);
    lines.push("");
    for (const component of bucket) lines.push(componentLine(component));
    lines.push("");
    const obligations = bucket.flatMap(noticesFor);
    if (key === UNKNOWN_LICENSE) {
      lines.push(
        `- ${UNKNOWN_LICENSE}: no licence text was read for these components, so no notice can be written and none is claimed. ` +
          "An unknown licence is not a permissive licence.",
      );
      const reasons = [...new Set(bucket.map((c) => c.unknownReason).filter((r): r is string => r !== null))].sort();
      for (const reason of reasons) lines.push(`  Reason: ${reason}`);
    } else {
      const block = obligationBlock(obligations);
      if (block.length === 0) lines.push("- No obligation is stated for this id.");
      else lines.push(...block);
    }
    lines.push("");
  }

  const exceptions = new Set<string>();
  for (const component of inventory.components) {
    for (const ex of component.exceptions) exceptions.add(ex);
  }
  if (exceptions.size > 0) {
    lines.push("## Exceptions named by a package");
    lines.push("");
    lines.push(
      "A WITH expression is that licence plus its exception, so the terms differ from the base licence. " +
        "Read the exception before relying on the row above.",
    );
    lines.push("");
    for (const ex of [...exceptions].sort()) lines.push(`- ${ex}`);
    lines.push("");
  }

  lines.push("## Not covered");
  lines.push("");
  for (const item of inventory.notCovered) lines.push(`- ${item}`);
  lines.push("");
  lines.push(
    "These are the gaps this file has. A component in one of them is not in the list above, " +
      "because nothing was read about it, not because it has no obligations.",
  );
  lines.push("");

  return {
    filename: "THIRD-PARTY-NOTICES.generated.md",
    markdown: lines.join("\n"),
    componentCount: inventory.components.length,
    unknownCount: inventory.unknown,
    notCovered: [...inventory.notCovered],
    note: inventory.note,
  };
}