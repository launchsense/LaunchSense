// Deterministic dependency manifest parsing. Local signals only: pinned vs
// ranged versions, duplicates, install scripts. Vulnerability freshness comes
// from the OSV adapter in the action layer; registry freshness (outdated
// versions) is Unknown in this stage and listed as not checked.

export interface DepEntry {
  ecosystem: string;
  name: string;
  version: string;
  pinned: boolean;
  dev: boolean;
  manifest: string;
}

export interface DepsResult {
  deps: DepEntry[];
  installScripts: Array<{ manifest: string; script: string }>;
  duplicates: string[];
  manifests: string[];
  // Internal lookup across manifests, not part of the reported result.
  byName: Map<string, DepEntry>;
}

const EXACT_NPM = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/;

function isPinnedNpm(version: string): boolean {
  const v = version.trim();
  if (EXACT_NPM.test(v)) return true;
  // An alias specifier `npm:<pkg>@<version>` is pinned exactly when its inner
  // version is exact. The alias itself is not a range; only the tail after the
  // last `@` is. `npm:@scope/pkg@^1.2.3` is still floating.
  const alias = /^npm:(?:@[^/@]+\/)?[^@/]+@(.+)$/.exec(v);
  if (alias !== null) return EXACT_NPM.test(alias[1].trim());
  // Workspace protocol refs (`workspace:1.2.3`, `workspace:^1.2.3`, `workspace:*`)
  // follow the same exact-versions rule as a plain specifier.
  const workspace = /^workspace:(.+)$/.exec(v);
  if (workspace !== null) return EXACT_NPM.test(workspace[1].trim());
  return false;
}

function parsePackageJson(path: string, text: string, out: DepsResult): void {
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    return;
  }
  if (typeof data !== "object" || data === null) return;
  const record = data as Record<string, unknown>;
  const groups: Array<[string, boolean]> = [
    ["dependencies", false],
    ["devDependencies", true],
  ];
  // Duplicates are tracked across the whole repo, not per manifest. Scoping
  // `seen` to one manifest missed the real case (the same package at two
  // versions in two files) and fired on the harmless one (same package in
  // dependencies and devDependencies at one version).
  for (const [group, dev] of groups) {
    const values = record[group];
    if (typeof values !== "object" || values === null) continue;
    for (const [name, version] of Object.entries(values as Record<string, unknown>)) {
      if (typeof version !== "string" || version.length === 0) continue;
      const entry: DepEntry = {
        ecosystem: "npm",
        name,
        version,
        pinned: isPinnedNpm(version),
        dev,
        manifest: path,
      };
      const key = `${entry.ecosystem}:${name}`;
      const prev = out.byName.get(key);
      if (prev !== undefined && prev.version !== entry.version) {
        const signature = `${name} (${[prev.version, entry.version].sort().join(" vs ")})`;
        if (!out.duplicates.includes(signature)) out.duplicates.push(signature);
      }
      if (prev === undefined) out.byName.set(key, entry);
      out.deps.push(entry);
    }
  }
  const scripts = record["scripts"];
  if (typeof scripts === "object" && scripts !== null) {
    for (const name of ["postinstall", "preinstall", "prepublish", "prepublishOnly"]) {
      if (typeof (scripts as Record<string, unknown>)[name] === "string") {
        out.installScripts.push({ manifest: path, script: name });
      }
    }
  }
}

function parseRequirements(path: string, text: string, out: DepsResult): void {
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const pin = line.match(/^([A-Za-z0-9_.-]+)==([^;\s]+)/);
    if (pin !== null) {
      out.deps.push({
        ecosystem: "PyPI",
        name: pin[1] ?? line,
        version: pin[2] ?? "",
        pinned: true,
        dev: false,
        manifest: path,
      });
      continue;
    }
    const loose = line.match(/^([A-Za-z0-9_.-]+)/);
    if (loose !== null) {
      out.deps.push({
        ecosystem: "PyPI",
        name: loose[1] ?? line,
        version: "",
        pinned: false,
        dev: false,
        manifest: path,
      });
    }
  }
}

function parseGoMod(path: string, text: string, out: DepsResult): void {
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    const req = line.match(/^([A-Za-z0-9_./-]+)\s+v([0-9][^\s]*)/);
    if (req !== null) {
      out.deps.push({
        ecosystem: "Go",
        name: req[1] ?? line,
        version: req[2] ?? "",
        pinned: true,
        dev: false,
        manifest: path,
      });
    }
  }
}

function parsePackageLock(path: string, text: string, out: DepsResult): void {
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    return;
  }
  if (typeof data !== "object" || data === null) return;
  const record = data as Record<string, unknown>;
  const packages = record["packages"];
  if (typeof packages !== "object" || packages === null) return;
  const installed = new Map<string, string>();
  for (const [pathKey, values] of Object.entries(packages as Record<string, unknown>)) {
    if (pathKey === "" || typeof values !== "object" || values === null) continue;
    const version = (values as Record<string, unknown>)["version"];
    if (typeof version !== "string" || version.length === 0) continue;
    const name = pathKey.split("node_modules/").pop();
    if (typeof name === "string" && name.length > 0) installed.set(name, version);
  }
  for (const entry of out.deps) {
    if (entry.ecosystem !== "npm") continue;
    const resolved = installed.get(entry.name);
    if (resolved === undefined) continue;
    entry.version = resolved;
    entry.pinned = true;
    entry.manifest = path;
  }
}

export function parseManifests(
  files: Array<{ path: string; content: string }>,
): DepsResult {
  const out: DepsResult = {
    deps: [],
    installScripts: [],
    duplicates: [],
    manifests: [],
    byName: new Map(),
  };
  // Parse order matters: parsePackageLock only rewrites deps that already exist, so
  // a lockfile parsed before its package.json is ignored. The hosted path sorts
  // package.json first; the local review parses in caller order. Ordering here makes
  // both paths agree and keeps a lockfile-first caller correct.
  const isLock = (file: { path: string }): boolean =>
    (file.path.split("/").pop() ?? file.path) === "package-lock.json";
  const ordered = [...files.filter((file) => !isLock(file)), ...files.filter(isLock)];
  for (const file of ordered) {
    const base = file.path.split("/").pop() ?? file.path;
    if (base === "package.json") {
      out.manifests.push(file.path);
      parsePackageJson(file.path, file.content, out);
    } else if (base === "requirements.txt") {
      out.manifests.push(file.path);
      parseRequirements(file.path, file.content, out);
    } else if (base === "go.mod") {
      out.manifests.push(file.path);
      parseGoMod(file.path, file.content, out);
    } else if (base === "Cargo.toml" || base === "package-lock.json") {
      if (!out.manifests.includes(file.path)) out.manifests.push(file.path);
      if (base === "package-lock.json") parsePackageLock(file.path, file.content, out);
    }
  }
  return out;
}
