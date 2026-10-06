// Pure rescan comparison. Old findings meet new findings by fingerprint.
// Unmatched old findings become fixed only when the new scan actually
// covered them; lost coverage means unknown, never fixed. Cause tags tell
// whether code, advisories, or the analyzer itself changed.

import type { Severity } from "../policies/severity";
import { baseFingerprint } from "../redaction.ts";

export type TransitionState =
  | "fixed"
  | "still_broken"
  | "new"
  | "regressed"
  | "unknown"
  | "accepted_risk";

// `license_change` was added for the licence declaration lane. A dependency
// that moves from MIT to a strong copyleft term is not a code change and not an
// advisory update, and labelling it either one hides the only delta that lane
// exists to surface. The state machine is the one that already ships; this adds
// one more reason for a change that it already reports.
export type ChangeCause =
  | "code_change"
  | "advisory_update"
  | "analyzer_update"
  | "license_change";

export interface ComparedFinding {
  ruleId: string;
  fingerprint: string;
  path: string;
  line: number;
  severity: Severity;
  title: string;
  why: string;
}

export interface Transition {
  oldFingerprint: string | null;
  newFingerprint: string | null;
  ruleId: string;
  state: Exclude<TransitionState, "accepted_risk">;
  cause: ChangeCause | null;
}

export interface CompareOptions {
  oldAnalyzer: string;
  newAnalyzer: string;
  oldFetched: Set<string>;
  newFetched: Set<string>;
  oldContents: Map<string, string>;
  newContents: Map<string, string>;
  previouslyFixed: Set<string>;
  depOf: (ruleId: string, title: string) => string | null;
  /**
   * Which cause a same-coordinate change is reported under. Defaults to
   * `advisory_update`, which is what an advisory change was and still is. The
   * licence lane passes a hook so a licence change reads as a licence change.
   */
  causeForChange?: (ruleId: string) => ChangeCause;
}

const ADVISORY_CAUSE: ChangeCause = "advisory_update";

export function sameFile(a: ComparedFinding, b: ComparedFinding): boolean {
  return a.ruleId === b.ruleId && a.path === b.path;
}

/**
 * The same coordinate changed. An advisory got a new id, or a dependency's
 * licence changed. Both are one old row replaced by one new row at the same
 * coordinate, so the cause comes from the caller rather than being guessed here.
 */
function sameCoordinateChanged(
  oldF: ComparedFinding,
  newList: ComparedFinding[],
  depOf: CompareOptions["depOf"],
): boolean {
  const dep = depOf(oldF.ruleId, oldF.title);
  if (dep === null) return false;
  return newList.some((n) => {
    if (n.ruleId !== oldF.ruleId || n.path !== oldF.path) return false;
    return depOf(n.ruleId, n.title) === dep && n.fingerprint !== oldF.fingerprint;
  });
}

function changeCause(opts: CompareOptions, ruleId: string): ChangeCause {
  return opts.causeForChange?.(ruleId) ?? ADVISORY_CAUSE;
}

export function compareFindings(
  oldList: ComparedFinding[],
  newList: ComparedFinding[],
  opts: CompareOptions,
): Transition[] {
  const out: Transition[] = [];
  const newByFp = new Map(newList.map((f) => [f.fingerprint, f]));
  // Identical findings in one file share a base and differ only by occurrence,
  // which is a running count. Group the new list by base so a match is made
  // against the group, not against one position. Two identical findings that
  // become one then read as one still broken and one fixed, whatever the order.
  const newByBase = new Map<string, string[]>();
  for (const finding of newList) {
    const key = baseFingerprint(finding.fingerprint);
    const group = newByBase.get(key);
    if (group === undefined) newByBase.set(key, [finding.fingerprint]);
    else group.push(finding.fingerprint);
  }
  const matchedNew = new Set<string>();

  if (opts.oldAnalyzer !== opts.newAnalyzer) {
    for (const old of oldList) {
      if (newByFp.has(old.fingerprint)) {
        matchedNew.add(old.fingerprint);
        out.push({
          oldFingerprint: old.fingerprint,
          newFingerprint: old.fingerprint,
          ruleId: old.ruleId,
          state: "still_broken",
          cause: null,
        });
      } else {
        out.push({
          oldFingerprint: old.fingerprint,
          newFingerprint: null,
          ruleId: old.ruleId,
          state: "unknown",
          cause: "analyzer_update",
        });
      }
    }
    for (const next of newList) {
      if (!matchedNew.has(next.fingerprint)) {
        out.push({
          oldFingerprint: null,
          newFingerprint: next.fingerprint,
          ruleId: next.ruleId,
          state: "new",
          cause: "analyzer_update",
        });
      }
    }
    return out;
  }

  for (const old of oldList) {
    const base = baseFingerprint(old.fingerprint);
    const group = newByBase.get(base);
    const match = group === undefined ? undefined : group.shift();
    if (match !== undefined) {
      matchedNew.add(match);
      out.push({
        oldFingerprint: old.fingerprint,
        newFingerprint: match,
        ruleId: old.ruleId,
        state:
          opts.previouslyFixed.has(old.fingerprint) || opts.previouslyFixed.has(base)
            ? "regressed"
            : "still_broken",
        cause: null,
      });
      continue;
    }
    if (!opts.newFetched.has(old.path) && old.path !== "(repo)") {
      out.push({
        oldFingerprint: old.fingerprint,
        newFingerprint: null,
        ruleId: old.ruleId,
        state: "unknown",
        cause: "code_change",
      });
      continue;
    }
    if (sameCoordinateChanged(old, newList, opts.depOf)) {
      out.push({
        oldFingerprint: old.fingerprint,
        newFingerprint: null,
        ruleId: old.ruleId,
        state: "fixed",
        cause: changeCause(opts, old.ruleId),
      });
      continue;
    }
    out.push({
      oldFingerprint: old.fingerprint,
      newFingerprint: null,
      ruleId: old.ruleId,
      state: "fixed",
      cause: "code_change",
    });
  }

  for (const next of newList) {
    if (matchedNew.has(next.fingerprint)) continue;
    const oldContent = opts.oldContents.get(next.path);
    const newContent = opts.newContents.get(next.path);
    const changed = oldContent === undefined || oldContent !== newContent;
    const peerGone = oldList.some(
      (o) => o.ruleId === next.ruleId && o.path === next.path && o.fingerprint !== next.fingerprint,
    );
    // The new row replaced an old row at the SAME dependency coordinate, not
    // merely a row of the same rule at the same path. An added dependency sits at
    // the same path and rule as the one before it, but at a different coordinate,
    // so it is a code change, not a licence change. Requiring the coordinate to
    // match is what keeps "a dependency added is a code change" true.
    const nextCoordinate = opts.depOf(next.ruleId, next.title);
    const peerAtSameCoordinate =
      nextCoordinate !== null &&
      oldList.some(
        (o) =>
          o.ruleId === next.ruleId &&
          o.path === next.path &&
          o.fingerprint !== next.fingerprint &&
          opts.depOf(o.ruleId, o.title) === nextCoordinate,
      );
    out.push({
      oldFingerprint: null,
      newFingerprint: next.fingerprint,
      ruleId: next.ruleId,
      state: "new",
      cause: peerAtSameCoordinate
        ? changeCause(opts, next.ruleId)
        : !changed && !peerGone
          ? ADVISORY_CAUSE
          : "code_change",
    });
  }

  return out;
}

// Extracts "name@version" from a vulnerability title shaped as
// "GHSA-xxxx affects name@version". Returns null for other rules.
export function depOfVuln(ruleId: string, title: string): string | null {
  if (ruleId !== "deps.vulnerability") return null;
  const match = title.match(/affects\s+(\S+@\S+)/);
  return match !== null ? (match[1] ?? null) : null;
}

/**
 * Extracts "name@version" from a per-component licence row, whose title is
 * shaped as "name@version is Apache-2.0".
 *
 * This is the hook the licence lane uses, and it reads the coordinate out of the
 * same title a reader sees. A licence row carries the coordinate and the declared
 * id together, so the id changing between scans leaves the coordinate in place,
 * which is exactly the shape the transition machinery already recognises.
 */
export function depOfLicense(ruleId: string, title: string): string | null {
  if (ruleId !== "license.dependency") return null;
  const match = title.match(/^(\S+@\S+)\s+is\s+/);
  return match !== null ? (match[1] ?? null) : null;
}

/**
 * The coordinate reader for both dependency-shaped rules, and the cause a change
 * at that coordinate is reported under. One place decides what a licence change
 * looks like on a rescan, so the scan path and the local path cannot disagree.
 */
export function depOfDependency(ruleId: string, title: string): string | null {
  return depOfVuln(ruleId, title) ?? depOfLicense(ruleId, title);
}

export function causeForDependencyChange(ruleId: string): ChangeCause {
  return ruleId === "license.dependency" ? "license_change" : ADVISORY_CAUSE;
}
