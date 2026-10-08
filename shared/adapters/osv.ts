"use node";

// Minimal OSV batch client. Vulnerability freshness only: any failure or
// timeout resolves to Unknown, never to a pass. Results are cached per
// ecosystem/name/version by the caller.

export const OSV_TIMEOUT_MS = 15000;
export const OSV_BATCH_CAP = 50;

export interface OsvVuln {
  id: string;
  summary: string;
  severity: string;
}

export interface OsvQuery {
  ecosystem: string;
  name: string;
  version: string;
}

// Textual severities OSV reporters use, mapped to the scan's
// severity bands. Anything outside these words is not a
// severity, so it stays unread rather than becoming a guess.
const TEXT_SEVERITY = new Map<string, string>([
  ["CRITICAL", "high"],
  ["HIGH", "high"],
  ["MODERATE", "medium"],
  ["MEDIUM", "medium"],
  ["LOW", "low"],
]);

function textSeverity(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return TEXT_SEVERITY.get(value.trim().toUpperCase()) ?? null;
}

// CVSS v3 base metric values from the FIRST.org v3.1 spec.
const CVSS_V3_AV = new Map([["N", 0.85], ["A", 0.62], ["L", 0.55], ["P", 0.2]]);
const CVSS_V3_AC = new Map([["L", 0.77], ["H", 0.44]]);
const CVSS_V3_PR_UNCHANGED = new Map([["N", 0.85], ["L", 0.62], ["H", 0.27]]);
const CVSS_V3_PR_CHANGED = new Map([["N", 0.85], ["L", 0.68], ["H", 0.5]]);
const CVSS_V3_UI = new Map([["N", 0.85], ["R", 0.62]]);
const CVSS_V3_CIA = new Map([["N", 0], ["L", 0.22], ["H", 0.56]]);

// Computes the CVSS v3 base score of a vector such as
// CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N. Returns null
// when the vector is not a complete v3 base vector, so an
// unreadable score stays unknown instead of becoming a guess.
export function cvssV3BaseScore(vector: string): number | null {
  const parts = vector.split("/");
  if (!parts[0].startsWith("CVSS:3")) return null;
  const metrics = new Map<string, string>();
  for (const part of parts.slice(1)) {
    const colon = part.indexOf(":");
    if (colon < 0) return null;
    metrics.set(part.slice(0, colon), part.slice(colon + 1));
  }
  const av = CVSS_V3_AV.get(metrics.get("AV") ?? "");
  const ac = CVSS_V3_AC.get(metrics.get("AC") ?? "");
  const scope = metrics.get("S");
  if (scope !== "U" && scope !== "C") return null;
  const prTable = scope === "C" ? CVSS_V3_PR_CHANGED : CVSS_V3_PR_UNCHANGED;
  const pr = prTable.get(metrics.get("PR") ?? "");
  const ui = CVSS_V3_UI.get(metrics.get("UI") ?? "");
  const c = CVSS_V3_CIA.get(metrics.get("C") ?? "");
  const i = CVSS_V3_CIA.get(metrics.get("I") ?? "");
  const a = CVSS_V3_CIA.get(metrics.get("A") ?? "");
  if (
    av === undefined || ac === undefined || pr === undefined || ui === undefined ||
    c === undefined || i === undefined || a === undefined
  ) {
    return null;
  }
  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  const impact = scope === "C"
    ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15)
    : 6.42 * iss;
  if (impact <= 0) return 0;
  const exploitability = 8.22 * av * ac * pr * ui;
  const base = Math.min(impact + exploitability, 10);
  // The spec rounds up to the nearest tenth. The epsilon keeps a
  // value that is already a tenth from floating up to the next one.
  return Math.ceil(base * 10 - 1e-9) / 10;
}

// Derives the scan severity of one OSV advisory record: a numeric
// base score first, then a textual severity (database or ecosystem
// specific), then the computed base score of a CVSS v3 vector. A
// record with nothing readable is unknown, which the caller maps to
// info, never to an invented medium.
export function pickSeverity(vuln: Record<string, unknown>): string {
  const severities = vuln["severity"];
  let vector: string | null = null;
  if (Array.isArray(severities)) {
    for (const entry of severities) {
      if (typeof entry !== "object" || entry === null) continue;
      const score = (entry as Record<string, unknown>)["score"];
      if (typeof score !== "string") continue;
      const numeric = Number(score);
      if (Number.isFinite(numeric)) {
        if (numeric >= 7) return "high";
        if (numeric >= 4) return "medium";
        return "low";
      }
      const text = textSeverity(score);
      if (text !== null) return text;
      if (vector === null && score.startsWith("CVSS:")) vector = score;
    }
  }
  for (const section of ["database_specific", "ecosystem_specific"]) {
    const record = vuln[section];
    if (typeof record !== "object" || record === null) continue;
    const severity = textSeverity((record as Record<string, unknown>)["severity"]);
    if (severity !== null) return severity;
  }
  if (vector !== null) {
    const base = cvssV3BaseScore(vector);
    if (base !== null) {
      if (base >= 7) return "high";
      if (base >= 4) return "medium";
      return "low";
    }
  }
  return "unknown";
}

export async function queryOsvBatch(
  queries: OsvQuery[],
): Promise<{ timedOut: boolean; results: OsvVuln[][] }> {
  const empty = queries.map(() => []);
  if (queries.length === 0) return { timedOut: false, results: empty };
  const capped = queries.slice(0, OSV_BATCH_CAP);
  let response: Response;
  try {
    response = await fetch("https://api.osv.dev/v1/querybatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        queries: capped.map((q) => ({
          package: { name: q.name, ecosystem: q.ecosystem },
          version: q.version,
        })),
      }),
      signal: AbortSignal.timeout(OSV_TIMEOUT_MS),
    });
  } catch {
    return { timedOut: true, results: capped.map(() => []) };
  }
  if (response.status !== 200) {
    return { timedOut: true, results: capped.map(() => []) };
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { timedOut: true, results: capped.map(() => []) };
  }
  if (typeof data !== "object" || data === null) {
    return { timedOut: true, results: capped.map(() => []) };
  }
  const list = (data as Record<string, unknown>)["results"];
  if (!Array.isArray(list)) {
    return { timedOut: true, results: capped.map(() => []) };
  }
  const results: OsvVuln[][] = capped.map((_, i) => {
    const entry = list[i];
    if (typeof entry !== "object" || entry === null) return [];
    const vulns = (entry as Record<string, unknown>)["vulns"];
    if (!Array.isArray(vulns)) return [];
    return vulns.slice(0, 20).flatMap((v): OsvVuln[] => {
      if (typeof v !== "object" || v === null) return [];
      const record = v as Record<string, unknown>;
      const id: unknown = record["id"];
      if (typeof id !== "string") return [];
      const summary = typeof record["summary"] === "string" ? record["summary"] : "";
      return [{
        id,
        summary: summary.slice(0, 200),
        severity: pickSeverity(record),
      }];
    });
  });
  await fillEmptySummaries(results);
  return { timedOut: false, results };
}

async function fillEmptySummaries(results: OsvVuln[][]): Promise<void> {
  const missing: OsvVuln[] = [];
  for (const group of results) {
    for (const vuln of group) {
      if (vuln.summary.length === 0) missing.push(vuln);
    }
  }
  const batch = missing.slice(0, 8);
  await Promise.all(batch.map(async (vuln) => {
    try {
      const response = await fetch(`https://api.osv.dev/v1/vulns/${encodeURIComponent(vuln.id)}`, {
        signal: AbortSignal.timeout(OSV_TIMEOUT_MS),
      });
      if (response.status !== 200) return;
      const data = await response.json();
      if (typeof data !== "object" || data === null) return;
      const summary = (data as Record<string, unknown>)["summary"];
      if (typeof summary === "string" && summary.length > 0) vuln.summary = summary.slice(0, 200);
    } catch {
      // An id without a fetched record stays an id. It is not a pass.
    }
  }));
}
