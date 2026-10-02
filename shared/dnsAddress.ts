// Address classification for the DNS guard. Pure: no imports, no Node APIs, so
// it is testable in isolation and can run in any runtime.

function ipv4Blocked(a: number, b: number, c: number): string | null {
  if (a === 0) return "unspecified address";
  if (a === 10) return "private network";
  if (a === 127) return "loopback";
  if (a === 169 && b === 254) return "link-local and cloud metadata";
  if (a === 172 && b >= 16 && b <= 31) return "private network";
  if (a === 192 && b === 168) return "private network";
  if (a === 192 && b === 0 && c === 0) return "reserved address";
  if (a === 192 && b === 0 && c === 2) return "documentation address";
  if (a === 192 && b === 88 && c === 99) return "reserved address";
  if (a === 100 && b >= 64 && b <= 127) return "carrier grade NAT";
  if (a === 198 && (b === 18 || b === 19)) return "benchmarking address";
  if (a === 198 && b === 51 && c === 100) return "documentation address";
  if (a === 203 && b === 0 && c === 113) return "documentation address";
  if (a >= 224) return "multicast or reserved address";
  return null;
}

// Returns a reason string when the address must not be contacted, else null.
export function classifyAddress(address: string): string | null {
  const trimmed = address.trim().toLowerCase();
  if (trimmed.length === 0) return "empty address";

  if (!trimmed.includes(":")) {
    const parts = trimmed.split(".").map((p) => Number(p));
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
      return "unparseable address";
    }
    return ipv4Blocked(parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0);
  }

  if (trimmed === "::" || trimmed === "::0") return "unspecified address";
  if (trimmed === "::1") return "loopback";
  if (trimmed.startsWith("fe80")) return "link-local address";
  if (/^f[cd]/.test(trimmed)) return "unique local address";
  if (trimmed.startsWith("ff")) return "multicast address";

  // IPv4-mapped and IPv4-translated forms carry a v4 target in the tail.
  const mapped = trimmed.match(/::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped !== null) return classifyAddress(mapped[1] ?? "");
  const nat64 = trimmed.match(/^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/);
  if (nat64 !== null) return classifyAddress(nat64[1] ?? "");

  return null;
}