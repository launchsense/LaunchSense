"use node";

// Local process shape so Convex Node actions typecheck without relying on
// ambient Node types. GITHUB_TOKEN stays server-only.
declare const process: { env: Record<string, string | undefined> };

// The pin used by every blob read. Imported from the pure snapshot module so a
// blob read cannot silently become a read of whatever a branch points at now.
import { blobRefQuery } from "../scans/snapshot";

export const FETCH_TIMEOUT_MS = 25000;
export const MAX_STORED_ENTRIES = 5000;
export const MAX_BYTES_PER_FILE = 100000;

export interface RateLimitInfo {
  remaining: number | null;
  limit: number | null;
  resetAtMs: number | null;
  retryAfterMs: number | null;
}

export function parseRateLimitHeaders(headers: Headers): RateLimitInfo {
  const remainingRaw = headers.get("x-ratelimit-remaining");
  const limitRaw = headers.get("x-ratelimit-limit");
  const resetRaw = headers.get("x-ratelimit-reset");
  const retryRaw = headers.get("retry-after");
  const remaining = remainingRaw !== null && remainingRaw !== "" ? Number(remainingRaw) : null;
  const limit = limitRaw !== null && limitRaw !== "" ? Number(limitRaw) : null;
  const resetSeconds = resetRaw !== null && resetRaw !== "" ? Number(resetRaw) : null;
  const retrySeconds = retryRaw !== null && retryRaw !== "" ? Number(retryRaw) : null;
  return {
    remaining: remaining !== null && Number.isFinite(remaining) ? remaining : null,
    limit: limit !== null && Number.isFinite(limit) ? limit : null,
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

function authHeaders(userToken?: string | null): Record<string, string> {
  const base: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "LaunchSense/1.0",
  };
  // A signed-in scan uses that person's token. A guest scan uses the server
  // token when one is set. Neither value is returned, logged, or sent to the client.
  const token =
    userToken !== undefined && userToken !== null && userToken.length > 0
      ? userToken
      : process.env.GITHUB_TOKEN;
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

export async function fetchGitHubJson(url: string, userToken?: string | null): Promise<GitHubFetchResult> {
  const response = await fetch(url, {
    headers: authHeaders(userToken),
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

export interface BlobResult {
  status: "ok" | "too-large" | "binary" | "missing" | "rate-limited" | "error";
  content: string;
  size: number;
  contentSha: string;
  resetAtMs: number | null;
}

// Bounded single-file fetch through the contents API. Anything over the byte
// cap or with binary content is reported, never stored.
export async function fetchBlobContent(
  owner: string,
  repo: string,
  sha: string,
  path: string,
  maxBytes = MAX_BYTES_PER_FILE,
  userToken?: string | null,
): Promise<BlobResult> {
  // Every blob read is pinned to a full 40-character commit sha. An unpinned
  // value is refused here rather than sent, so a blob read cannot become a read
  // of whatever a branch points at now.
  const ref = blobRefQuery(sha);
  if (ref === null) {
    return { status: "error", content: "", size: 0, contentSha: "", resetAtMs: null };
  }
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}${ref}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: authHeaders(userToken),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return { status: "error", content: "", size: 0, contentSha: "", resetAtMs: null };
  }
  const rate = parseRateLimitHeaders(response.headers);
  if (isRateLimitStatus(response.status, rate)) {
    return { status: "rate-limited", content: "", size: 0, contentSha: "", resetAtMs: rate.resetAtMs };
  }
  if (response.status === 404) {
    return { status: "missing", content: "", size: 0, contentSha: "", resetAtMs: null };
  }
  if (response.status !== 200) {
    return { status: "error", content: "", size: 0, contentSha: "", resetAtMs: null };
  }
  let data: unknown = null;
  try {
    data = (await response.json()) as unknown;
  } catch {
    return { status: "error", content: "", size: 0, contentSha: "", resetAtMs: null };
  }
  const record = asRecord(data);
  const rawContent: unknown = record?.["content"];
  if (record === null || record["encoding"] !== "base64" || typeof rawContent !== "string") {
    return { status: "error", content: "", size: 0, contentSha: "", resetAtMs: null };
  }
  const size = typeof record["size"] === "number" ? record["size"] : 0;
  const contentSha = typeof record["sha"] === "string" ? record["sha"] : "";
  if (size > maxBytes) {
    return { status: "too-large", content: "", size, contentSha, resetAtMs: null };
  }
  const clean = rawContent.replace(/\s+/g, "");
  let bytes: Uint8Array;
  try {
    const binary = atob(clean);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } catch {
    return { status: "error", content: "", size, contentSha, resetAtMs: null };
  }
  if (bytes.length > maxBytes) {
    return { status: "too-large", content: "", size: bytes.length, contentSha, resetAtMs: null };
  }
  for (let i = 0; i < Math.min(bytes.length, 8000); i++) {
    if (bytes[i] === 0) {
      return { status: "binary", content: "", size: bytes.length, contentSha, resetAtMs: null };
    }
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { status: "ok", content: text, size: bytes.length, contentSha, resetAtMs: null };
  } catch {
    return { status: "binary", content: "", size: bytes.length, contentSha, resetAtMs: null };
  }
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
