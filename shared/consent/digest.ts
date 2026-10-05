// SHA-256 over the one primitive every consent record needs, and no more.
//
// The record has to carry a hash of the notice wording the person agreed to, a
// hash of the ledger line the decision sits on, and a hash of the receipt body.
// Those three are the whole integrity story, and all three are SHA-256.
//
// Why not node:crypto: this module is imported by the browser bundle through
// shared/, and a node-only import would break the hosted scan. `globalThis.crypto`
// is present in every runtime this product runs on (Node 19 and later, and every
// browser we support, where it exists on https and on localhost). Where it is
// missing the functions return null and the caller records that the digest was
// not computed, rather than emitting a field that looks measured and is not.
//
// This is content addressing, not a security boundary. A SHA-256 of a public
// notice text is not a secret and not a key. Nothing here signs anything and
// nothing here authenticates a person.

/** Hex SHA-256 of the UTF-8 bytes of `text`, or null when the runtime has none. */
export async function sha256Hex(text: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) return null;
  try {
    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
    let out = "";
    for (const byte of new Uint8Array(digest)) out += byte.toString(16).padStart(2, "0");
    return out;
  } catch {
    return null;
  }
}

/** `sha256:<hex>`, the prefix the consent vocabulary uses everywhere. Null-safe. */
export async function sha256Prefixed(text: string): Promise<string | null> {
  const hex = await sha256Hex(text);
  return hex === null ? null : `sha256:${hex}`;
}

/**
 * A UUID derived from content, for `record_id`.
 *
 * TS 27560 Table 1 calls for a record id and recommends a UUID-4. A random v4 is
 * the wrong shape here: the person keeps the receipt, so running the generator
 * twice over the same ledger has to produce the same id, or the receipt cannot be
 * checked against anything. So the id is derived from the values that make the
 * record unique, and the version nibble is 8, which RFC 9562 reserves for a custom
 * layout. It is not a v4 and not a v5, and calling it one would be wrong.
 *
 * The variant bits are set to the RFC 4122 layout, so the value is a well-formed
 * UUID and a `urn:uuid:` reference resolves.
 */
export async function derivedUuid(...parts: string[]): Promise<string | null> {
  const hex = await sha256Hex(parts.join("\u0000"));
  if (hex === null) return null;
  const bytes = Uint8Array.from(hex.slice(0, 32).match(/.{2}/g) ?? [], (pair) => parseInt(pair, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const out = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${out.slice(0, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}-${out.slice(16, 20)}-${out.slice(20)}`;
}

/**
 * Canonical JSON: keys in sorted order, no whitespace.
 *
 * Two records with the same facts must hash to the same digest, and JSON object
 * key order is not a fact. So every hash in this lane runs over canonical JSON
 * rather than over whatever order a builder happened to write its keys in.
 * Arrays keep their order, because an array order is a decision we made.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}
