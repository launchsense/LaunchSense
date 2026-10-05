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

function groupValue(text: string): number | null {
  if (!/^[0-9a-f]{1,4}$/.test(text)) return null;
  const value = Number.parseInt(text, 16);
  return Number.isInteger(value) && value >= 0 && value <= 0xffff ? value : null;
}

// Expands any IPv6 form into 16 bytes, or null when it is not a valid address.
// Handles "::" compression, a dotted IPv4 tail, and a hex tail alike, so a
// mapped address is read the same way whether it is written ::ffff:127.0.0.1 or
// ::ffff:7f00:1. A prefix or zone id makes it null.
function expandIpv6(address: string): number[] | null {
  const zone = address.indexOf("%");
  if (zone !== -1) return null;

  const halves = address.split("::");
  if (halves.length > 2) return null;

  // A dotted tail is two hextets, so convert it to groups before counting.
  function toGroups(part: string): number[] | null {
    if (part.length === 0) return [];
    const groups: number[] = [];
    for (const piece of part.split(":")) {
      if (piece.includes(".")) {
        const octets = piece.split(".").map((p) => Number(p));
        if (
          octets.length !== 4 ||
          octets.some((p) => !Number.isInteger(p) || p < 0 || p > 255)
        ) {
          return null;
        }
        groups.push((((octets[0] ?? 0) << 8) | (octets[1] ?? 0)) & 0xffff);
        groups.push((((octets[2] ?? 0) << 8) | (octets[3] ?? 0)) & 0xffff);
        continue;
      }
      const value = groupValue(piece);
      if (value === null) return null;
      groups.push(value);
    }
    return groups;
  }

  const head = toGroups(halves[0] ?? "");
  const tail = toGroups(halves.length === 2 ? (halves[1] ?? "") : "");
  if (head === null || tail === null) return null;

  if (halves.length === 1) {
    if (head.length !== 8) return null;
  } else if (head.length + tail.length > 7) {
    return null;
  } else {
    const fill = 8 - head.length - tail.length;
    return [...head, ...new Array<number>(fill).fill(0), ...tail].flatMap(groupToBytes);
  }

  return head.flatMap(groupToBytes);
}

function groupToBytes(group: number): number[] {
  return [(group >> 8) & 0xff, group & 0xff];
}

function isNat64(bytes: number[]): boolean {
  return (
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    bytes.slice(4, 12).every((b) => b === 0)
  );
}

function firstBytesZero(bytes: number[], upTo: number): boolean {
  return bytes.slice(0, upTo).every((b) => b === 0);
}

function classifyIpv6(bytes: number[]): string | null {
  if (bytes.every((b) => b === 0)) return "unspecified address";
  if (bytes[15] === 1 && firstBytesZero(bytes, 15)) return "loopback";

  // ::ffff:a.b.c.d and ::ffff:aabb:ccdd are the same address, so read the last
  // 32 bits rather than a dotted tail that a hex form does not contain.
  const mappedV4 = firstBytesZero(bytes, 10) && bytes[10] === 0xff && bytes[11] === 0xff;
  const compatV4 = firstBytesZero(bytes, 12) && bytes.slice(12).some((b) => b !== 0);
  if (mappedV4 || compatV4 || isNat64(bytes)) {
    return ipv4Blocked(bytes[12] ?? 0, bytes[13] ?? 0, bytes[14] ?? 0);
  }

  const first = ((bytes[0] ?? 0) << 8) | (bytes[1] ?? 0);
  // fe80::/10 covers fe80 through febf, not only the fe80 prefix.
  if (first >= 0xfe80 && first <= 0xfebf) return "link-local address";
  // fc00::/7 covers fc00 through fdff.
  if (first >= 0xfc00 && first <= 0xfdff) return "unique local address";
  if ((bytes[0] ?? 0) === 0xff) return "multicast address";
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

  const bytes = expandIpv6(trimmed);
  if (bytes === null) return "unparseable address";
  return classifyIpv6(bytes);
}