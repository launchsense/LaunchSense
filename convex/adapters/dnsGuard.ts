"use node";

// DNS guard for the live-URL check.
//
// The literal-host guard in shared/ssrf.ts cannot see behind a public hostname.
// `169.254.169.254.nip.io` and `localtest.me` are public DNS services whose
// subdomain *is* a private target, so the literal check passes them. This
// module resolves the hostname and rejects if any answer lands in a private,
// loopback, link-local, CGNAT, or reserved range.
//
// Every answer must be public, not just the first. A rebinding resolver can
// hand back a different answer on the next lookup, so accepting a hostname that
// has ever answered privately would be unsafe.

import { classifyAddress } from "../../shared/dnsAddress.ts";

export interface ResolvedTarget {
  ok: boolean;
  address: string | null;
  reason: string | null;
}

// Loaded lazily inside the function. A top-level require would run on import
// and break under the ES module loader the tests use.
declare function require(name: string): {
  resolve4(host: string): Promise<string[]>;
  resolve6(host: string): Promise<string[]>;
};

export async function resolvePublicAddress(hostname: string): Promise<ResolvedTarget> {
  const resolver = require("node:dns/promises");
  const literal = hostname.replace(/^\[|\]$/g, "");

  // An IP literal needs no DNS but must still be classified.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(literal) || literal.includes(":")) {
    const reason = classifyAddress(literal);
    if (reason !== null) return { ok: false, address: null, reason };
    return { ok: true, address: literal, reason: null };
  }

  const answers: string[] = [];
  try {
    answers.push(...(await resolver.resolve4(hostname)));
  } catch {
    // No A record. Try the next family.
  }
  try {
    answers.push(...(await resolver.resolve6(hostname)));
  } catch {
    // No AAAA record either.
  }
  if (answers.length === 0) {
    return { ok: false, address: null, reason: "hostname did not resolve" };
  }
  for (const answer of answers) {
    const reason = classifyAddress(answer);
    if (reason !== null) {
      return { ok: false, address: null, reason: `hostname resolves to a ${reason}` };
    }
  }
  return { ok: true, address: answers[0] ?? null, reason: null };
}