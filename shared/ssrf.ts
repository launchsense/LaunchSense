// SSRF guard for the optional live-URL check. Pure and strict: anything that
// is not clearly a public website is rejected. Redirect targets pass through
// the same check on every hop. Fail closed, no DNS claims.

export function validateLiveUrl(
  input: string,
): { ok: true; url: string } | { ok: false; error: string } {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, error: "Enter a live site URL." };
  if (trimmed.length > 500) return { ok: false, error: "That URL is too long." };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: "That does not look like a URL. Use https://example.com." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "Only http and https sites can be checked." };
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return { ok: false, error: "URLs with credentials are not allowed." };
  }

  let host = url.hostname.toLowerCase();
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (host.length === 0 || host.length > 253) {
    return { ok: false, error: "That hostname is not allowed." };
  }
  if (host.includes("%") || host.includes(":")) {
    // Percent-encoded hosts and IPv6 zone IDs can hide local targets.
    const mapped = parseIpv6(host);
    if (mapped.blocked) return { ok: false, error: "That address is not allowed." };
    if (mapped.isIp) {
      const bad = checkIpv4(mapped.octets);
      if (bad !== null) return { ok: false, error: bad };
    } else {
      return { ok: false, error: "IPv6 addresses are not allowed for live checks." };
    }
  } else {
    const v4 = parseIpv4(host);
    if (v4 !== null) {
      const bad = checkIpv4(v4);
      if (bad !== null) return { ok: false, error: bad };
    } else {
      const bad = checkHostname(host);
      if (bad !== null) return { ok: false, error: bad };
    }
  }

  url.hostname = host;
  return { ok: true, url: url.href };
}

function checkHostname(host: string): string | null {
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    host.endsWith(".home") ||
    host.endsWith(".invalid") ||
    host.endsWith(".example") ||
    host.endsWith(".test")
  ) {
    return "Local and test hostnames are not allowed.";
  }
  if (!host.includes(".")) return "Single-word hostnames are not allowed.";
  if (/[^a-z0-9.-]/.test(host)) return "That hostname is not allowed.";
  return null;
}

// Parses decimal, octal (leading 0), and hex (0x) IPv4 forms, 1 to 4 parts.
// Returns null when the host is not an IP form at all.
function parseIpv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length < 1 || parts.length > 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (part.length === 0) return null;
    let value: number;
    if (/^0x[0-9a-f]+$/i.test(part)) {
      value = parseInt(part, 16);
    } else if (/^0[0-7]*$/.test(part) && part.length > 1) {
      value = parseInt(part, 8);
    } else if (/^[0-9]+$/.test(part)) {
      value = parseInt(part, 10);
    } else {
      return null;
    }
    if (!Number.isSafeInteger(value) || value < 0 || value > 4294967295) return null;
    nums.push(value);
  }
  let octets: number[];
  if (nums.length === 1) {
    const n = nums[0] ?? 0;
    octets = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  } else if (nums.length === 2) {
    const a = nums[0] ?? 0;
    const b = nums[1] ?? 0;
    if (a > 255 || b > 16777215) return null;
    octets = [a, (b >>> 16) & 255, (b >>> 8) & 255, b & 255];
  } else if (nums.length === 3) {
    const a = nums[0] ?? 0;
    const b = nums[1] ?? 0;
    const c = nums[2] ?? 0;
    if (a > 255 || b > 255 || c > 65535) return null;
    octets = [a, b, (c >>> 8) & 255, c & 255];
  } else {
    if (nums.some((n) => n > 255)) return null;
    octets = nums;
  }
  return octets;
}

function parseIpv6(host: string): { isIp: boolean; blocked: boolean; octets: number[] } {
  // IPv4-mapped IPv6 carries an IPv4 target in the tail.
  const mapped = host.match(/^(?:0*:)*:ffff:(.+)$/);
  if (mapped !== null) {
    const tail = parseIpv4(mapped[1] ?? "");
    if (tail === null) return { isIp: false, blocked: true, octets: [] };
    return { isIp: true, blocked: false, octets: tail };
  }
  return { isIp: false, blocked: true, octets: [] };
}

function checkIpv4(o: number[]): string | null {
  const [a = 0, b = 0, c = 0, d = 0] = o;
  const msg = "That address is not allowed.";
  if (a === 0) return msg;
  if (a === 10) return msg;
  if (a === 100 && b >= 64 && b <= 127) return msg;
  if (a === 127) return msg;
  if (a === 169 && b === 254) return msg;
  if (a === 172 && b >= 16 && b <= 31) return msg;
  if (a === 192 && b === 0 && c === 0) return msg;
  if (a === 192 && b === 0 && c === 2) return msg;
  if (a === 192 && b === 88 && c === 99) return msg;
  if (a === 192 && b === 168) return msg;
  if (a === 198 && (b === 18 || b === 19)) return msg;
  if (a === 198 && b === 51 && c === 100) return msg;
  if (a === 203 && b === 0 && c === 113) return msg;
  if (a >= 224) return msg;
  void d;
  return null;
}
