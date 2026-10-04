// Registry lookups send a package name and version only.
// An empty answer stays unknown. This module is for the harness.

import type { RegistryFact } from "./buildReport.ts";

const TIMEOUT_MS = 8000;

async function readJson(url: string): Promise<unknown> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (response.status !== 200) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function licenseFromDepsDev(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const licenses = (data as Record<string, unknown>)["licenses"];
  if (!Array.isArray(licenses) || licenses.length === 0) return null;
  const first = licenses[0];
  if (typeof first === "string") return first;
  if (typeof first === "object" && first !== null) {
    const id = (first as Record<string, unknown>)["license"];
    if (typeof id === "string" && id.length > 0) return id;
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
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
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
  if (typeof data !== "object" || data === null) return null;
  const licensed = (data as Record<string, unknown>)["licensed"];
  if (typeof licensed !== "object" || licensed === null) return null;
  const declared = (licensed as Record<string, unknown>)["declared"];
  return typeof declared === "string" && declared.length > 0 ? declared : null;
}

export async function lookupOne(name: string, version: string): Promise<RegistryFact> {
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
  const clearUrl = `https://api.clearlydefined.io/definitions/npm/npmjs/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
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
  const capped = packages.slice(0, 15);
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
