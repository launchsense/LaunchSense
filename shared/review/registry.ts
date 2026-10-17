// Registry lookups send a package name and version only.
// An empty answer stays unknown. This module is for the harness.

/**
 * The most package coordinates one run queries for licence terms. Coordinates
 * past this cap are withheld and disclosed by a sentence that names this cap,
 * so the registry lane's small answer can never read as a full sweep.
 */
export const REGISTRY_TERMS_QUERY_CAP = 15;

import type { RegistryFact } from "./buildReport.ts";
import { isRecord, validNpmName, validNpmVersion } from "./npmIdentity.ts";

const TIMEOUT_MS = 8000;

async function readJson(url: string): Promise<unknown> {
  try {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (response.status !== 200 || response.redirected === true) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function licenseFromDepsDev(data: unknown): string | null {
  if (!isRecord(data)) return null;
  const licenses = data["licenses"];
  if (!Array.isArray(licenses) || licenses.length === 0) return null;
  if (licenses.some(item => typeof item === "string" ? item.trim().length === 0 :
    !isRecord(item) || typeof item["license"] !== "string" || item["license"].trim().length === 0)) return null;
  const first = licenses[0];
  if (typeof first === "string" && first.trim().length > 0) return first.trim();
  if (isRecord(first)) {
    const id = first["license"];
    if (typeof id === "string" && id.trim().length > 0) return id.trim();
  }
  return null;
}

interface Maintainer {
  publishedAt: string | null;
  isDefault: boolean;
  deprecated: boolean;
  deprecatedReason: string | null;
}

function maintainerFromDeps(data: unknown): Maintainer | null {
  if (!isRecord(data)) return null;
  const record = data;
  const published = record["publishedAt"];
  const reason = record["deprecatedReason"];
  return {
    publishedAt: typeof published === "string" ? published.slice(0, 10) : null,
    isDefault: record["isDefault"] === true,
    deprecated: record["isDeprecated"] === true,
    deprecatedReason: typeof reason === "string" && reason.length > 0 ? reason.slice(0, 180) : null,
  };
}

function withMaintainer(fact: RegistryFact, maintainer: Maintainer | null): RegistryFact {
  if (maintainer === null) {
    return { ...fact, publishedAt: null, isDefault: false, deprecated: null, deprecatedReason: null };
  }
  const published = maintainer.publishedAt === null
    ? "This version has no publish date in the registry record."
    : maintainer.isDefault
      ? `The default version was published ${maintainer.publishedAt}.`
      : `This version was published ${maintainer.publishedAt}. The last release date of other versions was not read.`;
  const deprecated = maintainer.deprecated
    ? "The registry marks this version deprecated."
    : "The registry does not mark this version deprecated.";
  return {
    ...fact,
    publishedAt: maintainer.publishedAt,
    isDefault: maintainer.isDefault,
    deprecated: maintainer.deprecated,
    deprecatedReason: maintainer.deprecatedReason,
    note: `${fact.note} ${published} ${deprecated} Archived status was not in this record.`,
  };
}

function licenseFromClearlyDefined(data: unknown): string | null {
  if (!isRecord(data)) return null;
  const licensed = data["licensed"];
  if (!isRecord(licensed)) return null;
  const declared = licensed["declared"];
  return typeof declared === "string" && declared.trim().length > 0 ? declared.trim() : null;
}

/**
 * The ClearlyDefined coordinate path for an npm package.
 *
 * A definition is addressed as `<type>/<provider>/<namespace>/<name>/<revision>`.
 * For npm the namespace is `-` when the name is unscoped and the scope when it is
 * scoped, so the namespace segment is part of the address and cannot be dropped:
 * the shipped two-segment path returned HTTP 502 while this canonical path
 * returned HTTP 200 for the same coordinates.
 */
function clearlyDefinedPath(name: string): string {
  if (name.startsWith("@")) {
    const slash = name.indexOf("/");
    if (slash > 1 && slash < name.length - 1) {
      return `${name.slice(0, slash)}/${name.slice(slash + 1)}`;
    }
  }
  return `-/${name}`;
}

export async function lookupOne(name: string, version: string): Promise<RegistryFact> {
  if (!validNpmName(name) || !validNpmVersion(version)) {
    return withMaintainer({ name, version, license: null, source: "unknown",
      note: "Invalid npm identity or non-exact version. No registry request was made. Unknown stays unknown." }, null);
  }
  const depsUrl = `https://api.deps.dev/v3/systems/npm/packages/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`;
  const depsData = await readJson(depsUrl);
  const maintainer = maintainerFromDeps(depsData);
  const fromDeps = licenseFromDepsDev(depsData);
  if (fromDeps !== null) {
    return withMaintainer(
      { name, version, license: fromDeps, source: "deps.dev", note: "Declared by deps.dev. Not a legal source." },
      maintainer,
    );
  }
  const clearUrl = `https://api.clearlydefined.io/definitions/npm/npmjs/${clearlyDefinedPath(name)}/${encodeURIComponent(version)}`;
  const fromClear = licenseFromClearlyDefined(await readJson(clearUrl));
  if (fromClear !== null) {
    return withMaintainer(
      { name, version, license: fromClear, source: "clearlydefined", note: "deps.dev was empty. ClearlyDefined declared this. Not a legal source." },
      maintainer,
    );
  }
  return withMaintainer(
    {
      name,
      version,
      license: null,
      source: "unknown",
      note: "No reliable terms from deps.dev or ClearlyDefined. Unknown stays unknown.",
    },
    maintainer,
  );
}

export async function lookupPackages(
  packages: Array<{ name: string; version: string }>,
): Promise<RegistryFact[]> {
  const capped = packages.slice(0, REGISTRY_TERMS_QUERY_CAP);
  const facts: RegistryFact[] = [];
  for (const pkg of capped) {
    facts.push(await lookupOne(pkg.name, pkg.version));
  }
  return facts;
}

export async function scorecardFact(repo: string): Promise<string | null> {
  const data = await readJson(`https://api.securityscorecards.dev/projects/${repo}`);
  if (typeof data !== "object" || data === null) return null;
  const date = (data as Record<string, unknown>)["date"];
  if (typeof date !== "string") return null;
  return `Scorecard has a record dated ${date.slice(0, 10)} for ${repo}. That date is a fact, not a LaunchSense score.`;
}
