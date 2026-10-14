// One bounded identity check for npm coordinates and installed locations. No
// trimming, range resolution, filesystem walk or registry inference takes place.
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validNpmName(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 214) return false;
  if (value === "node_modules" || value === "favicon.ico") return false;
  const part = "[a-z0-9-][a-z0-9._-]*";
  return new RegExp(`^(?:${part}|@${part}/${part})$`).test(value);
}

export function validNpmVersion(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 256) return false;
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
  if (match === null || match.slice(1, 4).some(part => !Number.isSafeInteger(Number(part)))) return false;
  return match[4] === undefined || match[4].split(".").every(part => !/^[0-9]+$/.test(part) || part === "0" || !part.startsWith("0"));
}

export interface InstalledNpmPath {
  name: string;
  parentPath: string;
  nested: boolean;
}

export function installedNpmPath(path: string): InstalledNpmPath | null {
  if (path.length > 4096 || path.includes("\\")) return null;
  const parts = path.split("/");
  let name = "";
  let last = 0;
  let count = 0;
  for (let at = 0; at < parts.length;) {
    last = at;
    if (parts[at++] !== "node_modules") return null;
    name = parts[at++] ?? "";
    if (name.startsWith("@")) name += `/${parts[at++] ?? ""}`;
    if (!validNpmName(name) || ++count > 32) return null;
  }
  return count === 0 ? null : { name, parentPath: parts.slice(0, last).join("/"), nested: count > 1 };
}

export interface NpmDeclaration {
  parentPath: string;
  name: string;
  spec: unknown;
}

const GROUPS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

export function npmManifestDeclarations(
  files: readonly { path: string; content: string }[],
  lockPath: string,
): NpmDeclaration[] {
  const slash = lockPath.lastIndexOf("/");
  const base = slash < 0 ? "" : lockPath.slice(0, slash + 1);
  const out: NpmDeclaration[] = [];
  for (const file of files) {
    if (!file.path.startsWith(base) || !/(^|\/)package\.json$/.test(file.path)) continue;
    const relative = file.path.slice(base.length);
    const parentPath = relative === "package.json" ? "" : relative.slice(0, -"/package.json".length);
    let data: unknown;
    try { data = JSON.parse(file.content) as unknown; } catch { continue; }
    if (!isRecord(data)) continue;
    for (const group of GROUPS) {
      const values = data[group];
      if (!isRecord(values)) continue;
      for (const [name, spec] of Object.entries(values)) out.push({ parentPath, name, spec });
    }
  }
  return out;
}

export interface NpmEntryIdentity {
  name: string;
  version: string;
  installedName: string;
  nested: boolean;
  reason: string | null;
}

export function npmEntryIdentity(
  path: string,
  raw: unknown,
  packages: Record<string, unknown>,
  declarations: readonly NpmDeclaration[] = [],
): NpmEntryIdentity {
  const location = installedNpmPath(path);
  const record = isRecord(raw) ? raw : {};
  const version = validNpmVersion(record["version"]) ? record["version"] : "Unknown";
  const installedName = location?.name ?? "(unresolved npm package)";
  const declared = Object.prototype.hasOwnProperty.call(record, "name");
  const name = declared && validNpmName(record["name"]) ? record["name"] : installedName;
  let reason: string | null = null;
  if (location === null) reason = "the installed relative path is invalid, so the package identity is unresolved";
  else if (!isRecord(raw)) reason = "the installed entry is not a package record, so its identity and version are unresolved";
  else if (declared && !validNpmName(record["name"])) reason = "the declared npm package name is invalid, so its published identity is unresolved";
  else if (version === "Unknown") reason = "the npm version is not a validated exact version, so this component is unresolved";
  if (reason === null && location !== null) {
    const owner = packages[location.parentPath];
    const specs: unknown[] = declarations.filter(row => row.parentPath === location.parentPath && row.name === location.name).map(row => row.spec);
    if (isRecord(owner)) {
      for (const group of GROUPS) {
        const values = owner[group];
        if (isRecord(values) && Object.prototype.hasOwnProperty.call(values, location.name)) specs.push(values[location.name]);
      }
    }
    for (const spec of specs) {
      if (typeof spec !== "string" || !spec.startsWith("npm:")) continue;
      if (spec.length > 1024) {
        reason = "the npm alias declaration exceeds the bounded input limit, so its published identity is unresolved";
        continue;
      }
      const at = spec.lastIndexOf("@");
      const target = at > 4 ? spec.slice(4, at) : "";
      const range = at > 4 ? spec.slice(at + 1) : "";
      const unsafeRange = [...range].some(char => char.charCodeAt(0) < 32 || char === "\\" || char === "/");
      if (!validNpmName(target) || range.trim().length === 0 || unsafeRange) {
        reason = "the npm alias declaration is malformed, so its published identity is unresolved";
      } else if (!declared || name !== target) {
        reason = "the declared npm alias target is not proven by the installed entry name, so its published identity is unresolved";
      } else if (validNpmVersion(range) && range !== version) {
        // Two exact declarations can be compared without a range solver. Ranges
        // remain opaque; no version is guessed or substituted for the lock entry.
        reason = "the npm alias declares a conflicting exact version, so its installed identity and terms are unresolved";
      }
    }
  }
  return { name, version, installedName, nested: location?.nested ?? true, reason };
}
