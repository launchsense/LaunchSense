// Only validated published npm identities and exact versions are queryable.
// Installed paths, alias declarations and incomplete counts stay separate.
import { isRecord, npmEntryIdentity } from "./npmIdentity.ts";
import type { NpmDeclaration } from "./npmIdentity.ts";

export interface LockPackage {
  name: string;
  version: string;
  installedPath: string;
  depth: "direct" | "transitive";
  dev: boolean;
}

export interface LockInventory {
  packages: LockPackage[];
  complete: boolean;
  note: string;
}

export function inventoryNpmLock(
  text: string,
  directNames: ReadonlySet<string>,
  declarations: readonly NpmDeclaration[] = [],
): LockInventory {
  let data: unknown;
  try { data = JSON.parse(text) as unknown; } catch {
    return { packages: [], complete: false, note: "The npm lockfile did not parse. The inventory is incomplete." };
  }
  if (!isRecord(data) || !isRecord(data["packages"])) {
    return { packages: [], complete: false, note: "This lockfile has no valid packages map. The inventory is incomplete." };
  }
  const packages = data["packages"];
  const out: LockPackage[] = [];
  let unresolved = 0;
  let links = 0;
  for (const [pathKey, raw] of Object.entries(packages)) {
    if (pathKey === "") {
      if (!isRecord(raw)) unresolved += 1;
      continue;
    }
    // Workspace source entries and links are not a supported installed format.
    // Disclose their omission rather than claiming workspace coverage.
    if (!pathKey.includes("node_modules") || (isRecord(raw) && raw["link"] === true)) {
      links += 1;
      continue;
    }
    const identity = npmEntryIdentity(pathKey, raw, packages, declarations);
    if (identity.reason !== null) { unresolved += 1; continue; }
    out.push({ name: identity.name, version: identity.version, installedPath: pathKey,
      depth: !identity.nested && directNames.has(identity.installedName) ? "direct" : "transitive",
      dev: isRecord(raw) && raw["dev"] === true });
  }
  const omissions = links > 0 ? ` ${links} workspace/source link entry(s) are not inventoried; workspace dependency coverage is not provided.` : "";
  return {
    packages: out,
    complete: unresolved === 0 && links === 0,
    note: `Lockfile lists ${out.length} packages with validated queryable coordinates.` +
      (unresolved > 0 ? ` ${unresolved} entry(s) have an unresolved identity, path, record or exact version and are not offered as coordinates. The inventory is incomplete.` : "") + omissions,
  };
}
