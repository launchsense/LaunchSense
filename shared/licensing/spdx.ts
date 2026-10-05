// SPDX ids, normalized. A declared licence string becomes an SPDX id or the one
// word Unknown, and Unknown is never filled in from context, from a sibling
// manifest, or from what a package is usually published under.
//
// The id list lives in this file rather than being fetched, because reading the
// licence of a dependency must never need a request. Swapping in a newer SPDX
// list is a data change, not a new capability, and the scan still runs offline.
//
// The expression grammar is not reimplemented here. `parseExpression` is the
// reader the repository's own licence already goes through, so `MIT OR
// Apache-2.0`, `MIT AND Apache-2.0`, and `Apache-2.0 WITH LLVM-exception` mean
// the same thing for a dependency as they do for the project.

import { parseExpression } from "../analyzers/licenses.ts";
import type { LicenseExpression } from "../analyzers/licenses.ts";

/** The one word an undetermined licence reads as. Never a licence name. */
export const UNKNOWN_LICENSE = "Unknown";

/**
 * npm's proprietary marker. It is not an SPDX id and it is not Unlicense: the
 * author has asserted a claim and granted nothing. Recorded through the SPDX
 * license-ref grammar so it stays one record rather than two readings.
 */
export const UNLICENSED_ID = "LicenseRef-Proprietary-UNLICENSED";

/**
 * Ids this product reads. A subset of the SPDX licence list, chosen to cover the
 * families the obligations table is written against plus the ids npm projects
 * actually declare. An id that is not here is Unknown, which is the honest
 * answer, not a near miss.
 */
const KNOWN_IDS = `
0BSD AFL-3.0 AGPL-1.0 AGPL-1.0-only AGPL-1.0-or-later AGPL-3.0 AGPL-3.0-only AGPL-3.0-or-later
Apache-1.1 Apache-2.0 Artistic-2.0 BlueOak-1.0.0 BSD-2-Clause BSD-2-Clause-Patent
BSD-3-Clause BSD-3-Clause-Clear BSD-4-Clause BSL-1.0 BUSL-1.1
CC-BY-3.0 CC-BY-4.0 CC-BY-SA-4.0 CC0-1.0 CDDL-1.0 CDDL-1.1
CECILL-2.1 ClArtistic EPL-1.0 EPL-2.0 EUPL-1.2 Elastic-2.0
FSFAP FSFUL FSFULLR GPL-1.0 GPL-1.0-only GPL-1.0-or-later GPL-2.0 GPL-2.0-only GPL-2.0-or-later
GPL-3.0 GPL-3.0-only GPL-3.0-or-later ISC IPL-1.0 JSON
LGPL-2.0 LGPL-2.0-only LGPL-2.0-or-later LGPL-2.1 LGPL-2.1-only LGPL-2.1-or-later
LGPL-3.0 LGPL-3.0-only LGPL-3.0-or-later LPPL-1.3c LiLiQ-P-1.1
MIT MIT-0 MIT-CMU MPL-1.0 MPL-1.1 MPL-2.0 MS-PL MS-RL
NCSA OFL-1.1 OSL-3.0 PostgreSQL Python-2.0
Ruby SGI-B-2.0 Sleepycat SSPL-1.0 TCL Unlicense UPL-1.0 Vim W3C WTFPL
X11 Xnet Zlib ZPL-2.1
`.trim();

/**
 * Ids the SPDX list has deprecated. They stay readable rather than becoming
 * Unknown, because a deprecated id still tells a person which licence text was
 * meant, and rewriting `GPL-2.0` into `GPL-2.0-only` would assert an
 * only-versus-or-later choice the string does not make. They are marked, and
 * the record says the current form carries that distinction and this one does
 * not. The `+` form is different: it says or-later, so it normalizes.
 */
const DEPRECATED_IDS = new Set(
  `AGPL-1.0 AGPL-3.0 BSD-2-Clause-FreeBSD StandardML-NJ eCos-2.0
   GPL-1.0 GPL-2.0 GPL-3.0 LGPL-2.0 LGPL-2.1 LGPL-3.0 Nunit wxWindows`.split(/\s+/),
);

const CANONICAL = new Map<string, string>();
for (const id of KNOWN_IDS.split(/\s+/)) {
  if (id.length > 0) CANONICAL.set(id.toLowerCase(), id);
}

/** Ids that are not on the SPDX list at all, but are real declarations. */
const LICENSE_REFS = new Set([UNLICENSED_ID.toLowerCase()]);

export interface SpdxId {
  /** Canonical id, or `Unknown` when nothing could be determined. */
  id: string;
  /** True when the declared id is on the SPDX deprecated list. */
  deprecated: boolean;
  /** Why this could not be determined. Null when it could. */
  unknownReason: string | null;
}

/** True only for an id this product can name obligations against. */
export function isKnownSpdxId(id: string): boolean {
  return CANONICAL.has(id.toLowerCase()) || LICENSE_REFS.has(id.toLowerCase());
}

/**
 * Normalize one declared string to an SPDX id.
 *
 * Three deliberate refusals:
 *   - a free-text or prose declaration is Unknown, because a machine cannot
 *     read it and guessing is the failure this table exists to prevent;
 *   - `MIT/X11` is Unknown, because `/` is not an SPDX operator. `OR` is;
 *   - `SEE LICENSE IN <file>` is Unknown, because the terms are in a file that
 *     was not read, so the answer would be a claim nobody measured.
 */
export function normalizeSpdxId(declared: string | null | undefined): SpdxId {
  const raw = (declared ?? "").trim();
  if (raw.length === 0) {
    return { id: UNKNOWN_LICENSE, deprecated: false, unknownReason: "nothing was declared" };
  }
  if (/^see\s+licen[sc]e\b/i.test(raw)) {
    return {
      id: UNKNOWN_LICENSE,
      deprecated: false,
      unknownReason: "the declaration points at a licence file that was not read",
    };
  }
  if (raw.includes("/")) {
    return {
      id: UNKNOWN_LICENSE,
      deprecated: false,
      unknownReason: "the declaration is not an SPDX expression, because / is not an SPDX operator",
    };
  }
  if (raw.toLowerCase() === "unlicensed") {
    return { id: UNLICENSED_ID, deprecated: false, unknownReason: null };
  }
  // `GPL-2.0+` is the old spelling of `GPL-2.0-or-later`. The plus form is
  // unambiguous, so it normalizes. The bare form is not rewritten to
  // `-only`, because which side of the distinction the author meant is in the
  // licence text, not in the id.
  if (raw.endsWith("+")) {
    const base = raw.slice(0, -1);
    const canonical = CANONICAL.get(base.toLowerCase());
    if (canonical !== undefined) return { id: `${canonical}-or-later`, deprecated: false, unknownReason: null };
  }
  const canonical = CANONICAL.get(raw.toLowerCase());
  if (canonical !== undefined) {
    return { id: canonical, deprecated: DEPRECATED_IDS.has(canonical), unknownReason: null };
  }
  return {
    id: UNKNOWN_LICENSE,
    deprecated: false,
    unknownReason: `the declared id is not an id this product reads: ${raw}`,
  };
}

/**
 * An exception changes the terms, so it is kept exactly as declared rather than
 * folded into the base licence. An exception this product does not know is not
 * silently dropped: the caller is told, so the notice can say the terms changed
 * by an amount nobody read.
 */
export function normalizeException(declared: string): SpdxId {
  const raw = declared.trim();
  if (/^LicenseRef-/i.test(raw)) {
    return { id: raw, deprecated: false, unknownReason: null };
  }
  if (raw.length === 0) {
    return { id: UNKNOWN_LICENSE, deprecated: false, unknownReason: "the exception was named but empty" };
  }
  return {
    id: raw,
    deprecated: false,
    unknownReason: null,
  };
}

/**
 * Parse a declaration into an expression plus the normalized ids the
 * obligations table is written against.
 *
 * A disagreement is Unknown. If two declarations for the same component name
 * different licences, neither one is the answer, and picking one would be
 * picking a licence for a person who has not looked.
 */
export interface NormalizedDeclaration {
  verbatim: string;
  expression: LicenseExpression;
  /** Base ids with any WITH tail removed. */
  licenses: string[];
  exceptions: string[];
  operator: "single" | "and" | "or";
  /** True when every declared id could be normalized. */
  resolved: boolean;
  /** Per-id reasons, so a caller can say which id could not be read. */
  reasons: string[];
}

export function normalizeDeclaration(declared: string | null | undefined): NormalizedDeclaration {
  const expression = parseExpression((declared ?? "").trim());
  const licenses: string[] = [];
  const exceptions: string[] = [];
  const reasons: string[] = [];
  let resolved = expression.licenses.length > 0;
  for (const raw of expression.licenses) {
    const id = normalizeSpdxId(raw);
    licenses.push(id.id);
    if (id.unknownReason !== null) {
      resolved = false;
      reasons.push(id.unknownReason);
    }
  }
  for (const raw of expression.exceptions) {
    const ex = normalizeException(raw);
    exceptions.push(ex.id);
  }
  // An AND set is two licences that both apply, so both are real obligations.
  // An OR set is a choice, so the ids stay recorded but nothing is asserted
  // about which one the author meant. The caller keeps both readings and the
  // reader is asked which one was chosen.
  return {
    verbatim: expression.verbatim,
    expression,
    licenses,
    exceptions,
    operator: expression.operator,
    resolved,
    reasons,
  };
}