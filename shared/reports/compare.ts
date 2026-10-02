// Pure rescan comparison. Old findings meet new findings by fingerprint.
// Unmatched old findings become fixed only when the new scan actually
// covered them; lost coverage means unknown, never fixed. Cause tags tell
// whether code, advisories, or the analyzer itself changed.

import type { Severity } from "../policies/severity";

export type TransitionState =
  | "fixed"
  | "still_broken"
  | "new"
  | "regressed"
  | "unknown"
  | "accepted_risk";

export type ChangeCause = "code_change" | "advisory_update" | "analyzer_update";

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
}

export function sameFile(a: ComparedFinding, b: ComparedFinding): boolean {
  return a.ruleId === b.ruleId && a.path === b.path;
}

function advisoryChanged(
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

export function compareFindings(
  oldList: ComparedFinding[],
  newList: ComparedFinding[],
  opts: CompareOptions,
): Transition[] {
  const out: Transition[] = [];
  const newByFp = new Map(newList.map((f) => [f.fingerprint, f]));
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
    const same = newByFp.get(old.fingerprint);
    if (same !== undefined) {
      matchedNew.add(old.fingerprint);
      out.push({
        oldFingerprint: old.fingerprint,
        newFingerprint: same.fingerprint,
        ruleId: old.ruleId,
        state: opts.previouslyFixed.has(old.fingerprint) ? "regressed" : "still_broken",
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
    if (advisoryChanged(old, newList, opts.depOf)) {
      out.push({
        oldFingerprint: old.fingerprint,
        newFingerprint: null,
        ruleId: old.ruleId,
        state: "fixed",
        cause: "advisory_update",
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
    out.push({
      oldFingerprint: null,
      newFingerprint: next.fingerprint,
      ruleId: next.ruleId,
      state: "new",
      cause: !changed && !peerGone ? "advisory_update" : "code_change",
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
