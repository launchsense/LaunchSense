"use node";

// Fetch-only live site check. No browser, no screenshots: plain HTTP reads
// with manual redirect handling. Every hop passes through the SSRF guard.
// Redirect loops, oversized bodies, and timeouts resolve to Unknown states,
// never to a pass.

import { validateLiveUrl } from "../../shared/ssrf.ts";
import { resolvePublicAddress } from "./dnsGuard.ts";

export const LIVE_TIMEOUT_MS = 15000;
export const LIVE_MAX_HOPS = 3;
export const LIVE_MAX_BYTES = 500000;

const PHONE_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36 LaunchSense/1.0";

export interface LiveResult {
  finalUrl: string | null;
  https: boolean;
  reaches: boolean;
  httpStatus: number | null;
  nonBlank: boolean | null;
  mainActionFound: boolean | null;
  viewportMeta: boolean | null;
  hops: number;
  tooLarge: boolean;
  error: string | null;
}

// Pure hop resolver so redirect-to-metadata cases are unit testable.
export function nextHopUrl(current: string, location: string | null): string | null {
  if (location === null || location.length === 0) return null;
  let next: string;
  try {
    next = new URL(location, current).href;
  } catch {
    return null;
  }
  const checked = validateLiveUrl(next);
  return checked.ok ? checked.url : null;
}

function visibleTextLength(html: string): number {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const text = withoutScripts.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text.length;
}

function mainActionWords(mainAction: string): string[] {
  return mainAction
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
}

export interface PinnedResponse {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

// Node's request modules are loaded lazily and typed locally. A top-level import
// would pull the node types into the browser typecheck, which has none. The Convex
// runtime provides require; under the ES module loader the tests use it does not
// exist, so process.getBuiltinModule is the fallback.
declare function require(name: string): {
  request(options: unknown, onResponse: (res: PinnedIncoming) => void): PinnedRequest;
};
declare const process: { getBuiltinModule?: (id: string) => unknown };

function loadRequestModule(name: string): {
  request(options: unknown, onResponse: (res: PinnedIncoming) => void): PinnedRequest;
} {
  if (typeof require === "function") return require(name);
  const getBuiltinModule = process.getBuiltinModule;
  if (typeof getBuiltinModule === "function") {
    return getBuiltinModule(name) as ReturnType<typeof require>;
  }
  throw new Error(`Cannot load ${name} in this runtime.`);
}

interface PinnedIncoming {
  statusCode: number | undefined;
  headers: Record<string, string | string[] | undefined>;
  on(event: "data", listener: (chunk: Uint8Array) => void): PinnedIncoming;
  on(event: "end", listener: () => void): PinnedIncoming;
  on(event: "error", listener: (error: unknown) => void): PinnedIncoming;
}

interface PinnedRequest {
  on(event: "timeout", listener: () => void): PinnedRequest;
  on(event: "error", listener: (error: Error) => void): PinnedRequest;
  destroy(error?: Error): void;
  end(): void;
}

function decodeChunks(chunks: Uint8Array[]): string {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const body = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    body.set(chunk, at);
    at += chunk.length;
  }
  return new TextDecoder("utf-8").decode(body);
}

// Requests the URL but connects to the address the DNS guard already approved.
// A resolver that answers public for the check and private for the connection can
// no longer win, because there is no second lookup: the lookup callback always
// returns the pinned address. Redirects are not followed, so every hop still goes
// back through the guard.
export async function pinnedFetch(
  rawUrl: string,
  address: string,
  timeoutMs: number,
): Promise<PinnedResponse> {
  const url = new URL(rawUrl);
  const secure = url.protocol === "https:";
  const family = address.includes(":") ? 6 : 4;
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const requestModule = loadRequestModule(secure ? "node:https" : "node:http");

  return await new Promise<PinnedResponse>((resolve, reject) => {
    const req = requestModule.request(
      {
        protocol: url.protocol,
        hostname,
        port: url.port.length > 0 ? Number(url.port) : secure ? 443 : 80,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        // The socket goes to the pinned address; TLS still certifies the name.
        ...(secure ? { servername: hostname } : {}),
        headers: {
          Host: url.host,
          "User-Agent": PHONE_UA,
          Accept: "text/html",
        },
        // Node asks for every answer when the connection may be happy-eyeballed,
        // so the pinned address has to be returned in whichever shape it asked for.
        lookup: (
          _name: string,
          opts: { all?: boolean } | number | undefined,
          cb: (
            error: null,
            address: string | { address: string; family: number }[],
            family?: number,
          ) => void,
        ) => {
          if (typeof opts === "object" && opts !== null && opts.all === true) {
            cb(null, [{ address, family }]);
            return;
          }
          cb(null, address, family);
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Uint8Array[] = [];
        let read = 0;
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve({
            status: res.statusCode ?? 0,
            headers: {
              get(name: string): string | null {
                const value = res.headers[name.toLowerCase()];
                if (value === undefined) return null;
                return Array.isArray(value) ? (value[0] ?? null) : value;
              },
            },
            text: async () => decodeChunks(chunks),
          });
        };
        res.on("data", (chunk) => {
          // Give up past the read cap so a hostile server cannot stream without
          // bound. What arrived is still returned, and the caller already treats
          // an oversized page as too large rather than as a pass.
          read += chunk.length;
          if (read <= LIVE_MAX_BYTES * 2) {
            chunks.push(chunk);
            return;
          }
          req.destroy();
          finish();
        });
        res.on("error", (error: unknown) => {
          if (settled) return;
          settled = true;
          reject(error instanceof Error ? error : new Error("The response failed."));
        });
        res.on("end", finish);
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error("The site did not respond in time."));
    });
    req.on("error", reject);
    req.end();
  });
}

export async function fetchLiveSite(startUrl: string, mainAction: string): Promise<LiveResult> {
  const first = validateLiveUrl(startUrl);
  if (!first.ok) {
    return {
      finalUrl: null,
      https: startUrl.trim().toLowerCase().startsWith("https:"),
      reaches: false,
      httpStatus: null,
      nonBlank: null,
      mainActionFound: null,
      viewportMeta: null,
      hops: 0,
      tooLarge: false,
      error: first.error,
    };
  }

  let current = first.url;
  let hops = 0;
  let attempts = 0;
  for (;;) {
    attempts++;
    // DNS guard. The literal-host check in shared/ssrf.ts cannot see behind a
    // public hostname that encodes a private target, so resolve first and reject
    // if any answer is loopback, link-local, private, CGNAT, or reserved.
    const target = await resolvePublicAddress(new URL(current).hostname);
    if (!target.ok) {
      return {
        finalUrl: null,
        https: current.startsWith("https:"),
        reaches: false,
        httpStatus: null,
        nonBlank: null,
        mainActionFound: null,
        viewportMeta: null,
        hops,
        tooLarge: false,
        error: `Refused to check this address: ${target.reason}.`,
      };
    }
    let response: PinnedResponse;
    try {
      if (target.address === null) throw new Error("No approved address to connect to.");
      response = await pinnedFetch(current, target.address, LIVE_TIMEOUT_MS);
    } catch {
      if (attempts < 3) continue;
      return {
        finalUrl: null,
        https: current.startsWith("https:"),
        reaches: false,
        httpStatus: null,
        nonBlank: null,
        mainActionFound: null,
        viewportMeta: null,
        hops,
        tooLarge: false,
        error: "The site did not respond in time. Tried 3 times.",
      };
    }

    if (response.status >= 300 && response.status < 400) {
      if (hops >= LIVE_MAX_HOPS) {
        return {
          finalUrl: current,
          https: current.startsWith("https:"),
          reaches: true,
          httpStatus: response.status,
          nonBlank: null,
          mainActionFound: null,
          viewportMeta: null,
          hops,
          tooLarge: false,
          error: "Too many redirects. Stopped after 3 hops.",
        };
      }
      const next = nextHopUrl(current, response.headers.get("location"));
      if (next === null) {
        return {
          finalUrl: current,
          https: current.startsWith("https:"),
          reaches: true,
          httpStatus: response.status,
          nonBlank: null,
          mainActionFound: null,
          viewportMeta: null,
          hops,
          tooLarge: false,
          error: "A redirect pointed somewhere unsafe, so it was not followed.",
        };
      }
      current = next;
      hops++;
      continue;
    }

    if (response.status >= 500 && attempts < 3) continue;

    const lengthHeader = response.headers.get("content-length");
    const declared = lengthHeader !== null ? Number(lengthHeader) : null;
    if (declared !== null && Number.isFinite(declared) && declared > LIVE_MAX_BYTES * 2) {
      return {
        finalUrl: current,
        https: current.startsWith("https:"),
        reaches: true,
        httpStatus: response.status,
        nonBlank: null,
        mainActionFound: null,
        viewportMeta: null,
        hops,
        tooLarge: true,
        error: "The page is too large to check. Only the start was read.",
      };
    }
    let html = "";
    try {
      html = await response.text();
    } catch {
      return {
        finalUrl: current,
        https: current.startsWith("https:"),
        reaches: true,
        httpStatus: response.status,
        nonBlank: null,
        mainActionFound: null,
        viewportMeta: null,
        hops,
        tooLarge: false,
        error: "The page could not be read.",
      };
    }
    const tooLarge = html.length > LIVE_MAX_BYTES;
    const head = html.slice(0, LIVE_MAX_BYTES);
    const words = mainActionWords(mainAction);
    const lower = head.toLowerCase();
    const hits = words.filter((w) => lower.includes(w)).length;
    return {
      finalUrl: current,
      https: current.startsWith("https:"),
      reaches: true,
      httpStatus: response.status,
      nonBlank: response.status < 400 ? visibleTextLength(head) > 50 : null,
      mainActionFound: words.length === 0 ? null : hits >= Math.max(1, Math.ceil(words.length / 2)),
      viewportMeta: /<meta[^>]*name=["']viewport["']/i.test(head),
      hops,
      tooLarge,
      error: response.status >= 400 ? `The site answered HTTP ${response.status}.` : null,
    };
  }
}
