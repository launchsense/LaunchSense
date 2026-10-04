// Full npm lockfile inventory. Direct and transitive stay apart.
// This is not run by the website scan.

export interface LockPackage {
  name: string;
  version: string;
  depth: "direct" | "transitive";
  dev: boolean;
}

export interface LockInventory {
  packages: LockPackage[];
  complete: boolean;
  note: string;
}

function nameFromPath(pathKey: string): string | null {
  const marker = "node_modules/";
  const at = pathKey.lastIndexOf(marker);
  if (at < 0) return null;
  const name = pathKey.slice(at + marker.length);
  if (name.length === 0 || name.includes("/node_modules/")) return null;
  return name;
}

export function inventoryNpmLock(text: string, directNames: ReadonlySet<string>): LockInventory {
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    return { packages: [], complete: false, note: "The npm lockfile did not parse. The inventory is incomplete." };
  }
  if (typeof data !== "object" || data === null) {
    return { packages: [], complete: false, note: "The npm lockfile did not parse. The inventory is incomplete." };
  }
  const packages = (data as Record<string, unknown>)["packages"];
  if (typeof packages !== "object" || packages === null) {
    return {
      packages: [],
      complete: false,
      note: "This lockfile has no packages map. The inventory is incomplete.",
    };
  }
  const out: LockPackage[] = [];
  for (const [pathKey, raw] of Object.entries(packages as Record<string, unknown>)) {
    if (pathKey === "") continue;
    if (typeof raw !== "object" || raw === null) continue;
    const version = (raw as Record<string, unknown>)["version"];
    const name = nameFromPath(pathKey);
    if (name === null || typeof version !== "string" || version.length === 0) continue;
    const dev = (raw as Record<string, unknown>)["dev"] === true;
    const nested = pathKey.split("node_modules/").length > 2;
    out.push({
      name,
      version,
      depth: !nested && directNames.has(name) ? "direct" : "transitive",
      dev,
    });
  }
  return {
    packages: out,
    complete: true,
    note: out.length === 0 ? "The lockfile listed no packages." : `Lockfile lists ${out.length} packages.`,
  };
}
