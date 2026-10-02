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
    let response: Response;
    try {
      response = await fetch(current, {
        headers: { "User-Agent": PHONE_UA, Accept: "text/html" },
        redirect: "manual",
        signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
      });
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
