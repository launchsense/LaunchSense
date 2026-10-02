"use node";

// Local process shape so Convex Node actions typecheck without ambient Node
// types. GITHUB_TOKEN stays server-only and is never returned to a client.
declare const process: { env: Record<string, string | undefined> };

// One request per repo instead of one per file. GitHub serves a tarball for a
// ref; we decompress it in memory and read every text file from it. This is
// what makes an unauthenticated quota workable: a full scan drops from roughly
// 203 GitHub requests to about 4.

import { extractTar } from "../../shared/tar";
import type { TarEntry } from "../../shared/tar";
import { FETCH_TIMEOUT_MS, MAX_BYTES_PER_FILE } from "./github";

// Convex Node actions have zlib available; the convex tsconfig has no ambient
// node module types, so the import is declared locally.
declare function require(name: string): { gunzipSync: (data: Uint8Array) => Uint8Array };
const { gunzipSync } = require("node:zlib");

export const MAX_TOTAL_BYTES = 2000000;
export const MAX_FILES = 200;

export interface TarballResult {
  status: "ok" | "too-large" | "error";
  entries: TarEntry[];
  truncated: boolean;
  rawBytes: number;
}

function isRateLimitStatus(status: number, remaining: string | null): boolean {
  if (status === 429) return true;
  return status === 403 && remaining === "0";
}

export async function fetchRepoTarball(
  owner: string,
  repo: string,
  sha: string,
): Promise<TarballResult> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "LaunchSense/1.0",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token !== undefined && token.length > 0) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/tarball/${sha}`,
      { headers, redirect: "follow", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
  } catch {
    return { status: "error", entries: [], truncated: false, rawBytes: 0 };
  }

  const remaining = response.headers.get("x-ratelimit-remaining");
  if (isRateLimitStatus(response.status, remaining)) {
    return { status: "error", entries: [], truncated: false, rawBytes: 0 };
  }
  if (response.status !== 200) {
    return { status: "error", entries: [], truncated: false, rawBytes: 0 };
  }

  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > 20_000_000) {
    return { status: "too-large", entries: [], truncated: false, rawBytes: declared };
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    return { status: "error", entries: [], truncated: false, rawBytes: 0 };
  }
  if (bytes.length > 20_000_000) {
    return { status: "too-large", entries: [], truncated: false, rawBytes: bytes.length };
  }

  const result = extractTar(bytes, gunzipSync, {
    maxEntries: MAX_FILES,
    maxBytesPerFile: MAX_BYTES_PER_FILE,
    maxTotalBytes: MAX_TOTAL_BYTES,
  });
  return {
    status: "ok",
    entries: result.entries,
    truncated: result.truncated,
    rawBytes: bytes.length,
  };
}