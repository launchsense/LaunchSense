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

function pickSeverity(vuln: Record<string, unknown>): string {
  const severities = vuln["severity"];
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
      return score.slice(0, 40);
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
    data = (await response.json()) as unknown;
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
  return { timedOut: false, results };
}
