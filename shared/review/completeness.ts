// Completeness is computed per applicable check, never from a bare file count.
//
// Two facts must stay apart. A check that does not apply to this repo (an npm
// lockfile check on a Python repo) is "not applicable" and does not make a run
// partial. A check that applies and did not run does. A partial result is never
// a pass, so every reason is named in words and carried in the report body and
// JSON, where a harness reads it. It is not carried as an exit code, because an
// exit code does not reach the harness over MCP.

import type { ArtifactCoverage } from "./artifactCoverage.ts";
import { summarizeArtifactCoverage } from "./artifactCoverage.ts";

export interface CompletenessInput {
  /** The local read cap was reached, so some files were not read. */
  capHit: boolean;
  /** A vendored tree was skipped, so its notices were not checked. */
  vendored: boolean;
  /** An agent instruction file was skipped because the read was not acknowledged. */
  agent: boolean;
  /** A directory or file could not be read. */
  unreadable: boolean;
  /** The governance file was refused, so it suppressed nothing. */
  govRefused: boolean;
  /** The governance file was written for an older notice version. */
  govStale: boolean;
  /** This repo declares npm dependencies or ships an npm lockfile. */
  npmApplicable: boolean;
  /** A lockfile was read that the run did not inventory and query (Cargo, yarn, a second npm lockfile). */
  unqueriedLockfileInHand: boolean;
  /** A lockfile was in the files read. */
  lockfileInHand: boolean;
  /** null when no inventory was built, else whether it was complete. */
  inventoryComplete: boolean | null;
  /** The advisory service answered (or was asked) for the lockfile versions. */
  advisoriesQueried: boolean;
  /** The advisory query did not finish. */
  advisoriesTimedOut: boolean;
  /** Lockfile packages left unqueried because of the OSV cap. */
  advisoriesSkipped: number;
  /**
   * Queried coordinates the answer did not cover with a readable entry: a short
   * result list, a malformed entry, or an unreadable vulns field. A missing
   * answer is not a pass, so any of these makes the run partial.
   */
  advisoriesUnanswered: number;
  /**
   * Advisory records the answer listed that could not be read. Counted, never
   * dropped, so they make the run partial too.
   */
  advisoriesUnreadable: number;
  /** The registry terms lookup ran (it returns an array, empty or not). */
  registryQueried: boolean;
  /** Lines over the 2,000 character line cap that no check judged. */
  analyzerSkippedLines: number;
  /** Lines within that cap but over the 500 character code-shape cap. */
  analyzerCodeSkippedLines: number;
  /** Matches withheld because a file was already at the 20 match cap. */
  analyzerSuppressedMatches: number;
  /** Per-check coverage for large files that received a provider-only pass. */
  artifactCoverage?: readonly ArtifactCoverage[];
}

export interface Completeness {
  status: "complete" | "partial";
  /** Every reason the run is partial, in words, in the order it applies. */
  reasons: string[];
  /** One line for the report body, right after the coverage line. */
  note: string;
}

export function completenessFor(input: CompletenessInput): Completeness {
  const reasons: string[] = [];
  const source = typeof input === "object" && input !== null && !Array.isArray(input)
    ? input : {} as CompletenessInput;
  const valid = new Set<keyof CompletenessInput>();
  const booleanFields = [
    "capHit", "vendored", "agent", "unreadable", "govRefused", "govStale",
    "npmApplicable", "unqueriedLockfileInHand", "lockfileInHand",
    "advisoriesQueried", "advisoriesTimedOut", "registryQueried",
  ] as const;
  const countFields = [
    "advisoriesSkipped", "advisoriesUnanswered", "advisoriesUnreadable",
    "analyzerSkippedLines", "analyzerCodeSkippedLines", "analyzerSuppressedMatches",
  ] as const;
  for (const key of booleanFields) {
    if (Object.hasOwn(source, key) && typeof source[key] === "boolean") valid.add(key);
    else reasons.push(`coverage input ${key} is missing or invalid`);
  }
  for (const key of countFields) {
    const value = source[key];
    if (Object.hasOwn(source, key) && typeof value === "number" && Number.isSafeInteger(value) && value >= 0) valid.add(key);
    else reasons.push(`coverage input ${key} is missing or invalid`);
  }
  if (Object.hasOwn(source, "inventoryComplete") &&
      (source.inventoryComplete === null || typeof source.inventoryComplete === "boolean")) {
    valid.add("inventoryComplete");
  } else {
    reasons.push("coverage input inventoryComplete is missing or invalid");
  }
  // Only validated facts may contribute a known reason. Invalid values are
  // unknown, not false flags or zero counts, and never printed in the report.
  const facts: Partial<CompletenessInput> = { ...source };
  for (const key of [...booleanFields, ...countFields, "inventoryComplete"] as const) {
    if (!valid.has(key)) delete facts[key];
  }
  if (facts.capHit === true) {
    reasons.push("the local read cap was reached, so some files were not read");
  }
  if (facts.vendored === true) {
    reasons.push("a vendored tree was not read, so its notices were not checked");
  }
  if (facts.agent === true) {
    reasons.push("an agent instruction file was not read");
  }
  if (facts.unreadable === true) {
    reasons.push("a directory or file could not be read");
  }
  if (facts.govRefused === true) {
    reasons.push("the governance file was refused, so it suppressed nothing");
  }
  if (facts.govStale === true) {
    reasons.push("the governance file was written for an older notice version");
  }
  if (facts.npmApplicable === true) {
    if (facts.lockfileInHand === false) {
      reasons.push("npm dependencies are declared but no npm lockfile was in the files read");
    } else if (facts.lockfileInHand === true) {
      if (facts.inventoryComplete === false) {
        reasons.push("the npm lockfile could not be fully inventoried");
      } else if (facts.inventoryComplete === null) {
        reasons.push("the npm lockfile inventory was not built, so inventory coverage is unknown");
      }
      if (facts.advisoriesQueried === false) {
        reasons.push("the lockfile versions were not queried, so advisories are unknown");
      }
    }
  }
  // These are independently known gaps, even when another fact is unknown or
  // the request timed out. A timeout must not hide a cap or a missing answer.
  if (facts.advisoriesTimedOut === true) {
    reasons.push("the advisory query did not finish");
  }
  if (facts.advisoriesSkipped !== undefined && facts.advisoriesSkipped > 0) {
    reasons.push(`${facts.advisoriesSkipped} lockfile packages were not queried for advisories`);
  }
  if (facts.advisoriesUnanswered !== undefined && facts.advisoriesUnanswered > 0) {
    reasons.push(`${facts.advisoriesUnanswered} queried coordinate(s) had no readable advisory answer`);
  }
  if (facts.advisoriesUnreadable !== undefined && facts.advisoriesUnreadable > 0) {
    reasons.push(`${facts.advisoriesUnreadable} advisory record(s) in the answer were unreadable and are not listed`);
  }
  if (facts.npmApplicable === true && facts.lockfileInHand === true && facts.registryQueried === false) {
    reasons.push("dependency terms were not queried, so licence terms are unknown");
  }
  // A lockfile the run read but did not inventory and query is a version set
  // that was in hand and was not checked. That is "not run", not "not
  // applicable": the report already names the file, and a partial result is
  // never a pass. This covers a second npm lockfile as well as another
  // ecosystem.
  if (facts.unqueriedLockfileInHand === true) {
    reasons.push("a lockfile was in the files read and was not queried for versions");
  }
  // Lines the fixed line-level checks skipped inside a file that was read.
  // The file is in the read, so "the file was read" would be the misleading
  // half of the story. Each cap names the check that owns it, and the counts
  // keep the gap measurable. Other checks still read those files under their
  // own limits; a skipped line here is never a claim about any other check.
  if (facts.analyzerSkippedLines !== undefined && facts.analyzerSkippedLines > 0) {
    reasons.push(
      facts.analyzerSkippedLines === 1
        ? `the secret checks did not judge ${facts.analyzerSkippedLines} line over 2,000 characters`
        : `the secret checks did not judge ${facts.analyzerSkippedLines} lines over 2,000 characters`,
    );
  }
  if (facts.analyzerCodeSkippedLines !== undefined && facts.analyzerCodeSkippedLines > 0) {
    reasons.push(
      facts.analyzerCodeSkippedLines === 1
        ? `the code-shape checks did not judge ${facts.analyzerCodeSkippedLines} line over 500 characters`
        : `the code-shape checks did not judge ${facts.analyzerCodeSkippedLines} lines over 500 characters`,
    );
  }
  if (facts.analyzerSuppressedMatches !== undefined && facts.analyzerSuppressedMatches > 0) {
    reasons.push(
      facts.analyzerSuppressedMatches === 1
        ? `${facts.analyzerSuppressedMatches} matched line was withheld by the secret checks' 20-match cap`
        : `${facts.analyzerSuppressedMatches} matched lines were withheld by the secret checks' 20-match cap`,
    );
  }
  if ("artifactCoverage" in source) {
    try {
      const summary = summarizeArtifactCoverage(source.artifactCoverage!);
      if (summary.providerOnlyFiles > 0) {
        const n = summary.providerOnlyFiles;
        reasons.push(`${n} large ${n === 1 ? "file" : "files"} received provider-signature checks only; other content checks did not run`);
      }
    } catch {
      reasons.push("coverage input artifactCoverage is missing or invalid");
    }
  }
  const status: Completeness["status"] = reasons.length === 0 ? "complete" : "partial";
  const note =
    status === "complete"
      ? "Review complete."
      : `Review incomplete: ${reasons.join("; ")}.`;
  return { status, reasons, note };
}
