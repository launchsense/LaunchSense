"use node";

// Local process shape so Convex Node actions typecheck without relying on
// ambient Node types. GITHUB_TOKEN stays server-only.
declare const process: { env: Record<string, string | undefined> };

export const FETCH_TIMEOUT_MS = 25000;
export const MAX_STORED_ENTRIES = 5000;

export interface RateLimitInfo {
  remaining: number | null;
  resetAtMs: number | null;
  retryAfterMs: number | null;
}

export function parseRateLimitHeaders(headers: Headers): RateLimitInfo {
  const remainingRaw = headers.get("x-ratelimit-remaining");
  const resetRaw = headers.get("x-ratelimit-reset");
  const retryRaw = headers.get("retry-after");
  const remaining = remainingRaw !== null && remainingRaw !== "" ? Number(remainingRaw) : null;
  const resetSeconds = resetRaw !== null && resetRaw !== "" ? Number(resetRaw) : null;
  const retrySeconds = retryRaw !== null && retryRaw !== "" ? Number(retryRaw) : null;
  return {
    remaining: remaining !== null && Number.isFinite(remaining) ? remaining : null,
    resetAtMs:
      resetSeconds !== null && Number.isFinite(resetSeconds) ? resetSeconds * 1000 : null,
    retryAfterMs:
      retrySeconds !== null && Number.isFinite(retrySeconds) ? retrySeconds * 1000 : null,
  };
}

export function isRateLimitStatus(status: number, rate: RateLimitInfo): boolean {
  if (status === 429) return true;
  if (status === 403 && rate.remaining === 0) return true;
  return false;
}

function authHeaders(): Record<string, string> {
  const base: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "LaunchSense/1.0",
  };
  // Server-only quota token. Never returned, logged, or sent to the client.
  const token = process.env.GITHUB_TOKEN;
  if (token !== undefined && token.length > 0) {
    base.Authorization = `Bearer ${token}`;
  }
  return base;
}

export interface GitHubFetchResult {
  status: number;
  data: unknown;
  rate: RateLimitInfo;
  etag: string | null;
}

export async function fetchGitHubJson(url: string): Promise<GitHubFetchResult> {
  const response = await fetch(url, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const rate = parseRateLimitHeaders(response.headers);
  const etag = response.headers.get("etag");
  let data: unknown = null;
  const text = await response.text();
  if (text.length > 0) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = null;
    }
  }
  return { status: response.status, data, rate, etag };
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null) return value as Record<string, unknown>;
  return null;
}

export interface TreeEntry {
  path: string;
  type: string;
}

export function normalizeTreeEntries(rawTree: unknown): { entries: TreeEntry[]; truncated: boolean } {
  const record = asRecord(rawTree);
  if (record === null) return { entries: [], truncated: false };
  const truncated = record["truncated"] === true;
  const rawEntries = record["tree"];
  if (!Array.isArray(rawEntries)) return { entries: [], truncated };
  const entries: TreeEntry[] = [];
  for (const item of rawEntries) {
    const entry = asRecord(item);
    if (entry === null) continue;
    const path = entry["path"];
    const type = entry["type"];
    if (typeof path !== "string" || typeof type !== "string") continue;
    if (path.length === 0 || path.length > 512) continue;
    if (type !== "blob" && type !== "tree" && type !== "commit") continue;
    entries.push({ path, type });
    if (entries.length >= MAX_STORED_ENTRIES) break;
  }
  return { entries, truncated };
}
