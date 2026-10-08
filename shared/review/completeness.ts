// Completeness is computed per applicable check, never from a bare file count.
//
// Two facts must stay apart. A check that does not apply to this repo (an npm
// lockfile check on a Python repo) is "not applicable" and does not make a run
// partial. A check that applies and did not run does. A partial result is never
// a pass, so every reason is named in words and carried in the report body and
// JSON, where a harness reads it. It is not carried as an exit code, because an
// exit code does not reach the harness over MCP.

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
  /** The registry terms lookup ran (it returns an array, empty or not). */
  registryQueried: boolean;
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
  if (input.capHit) {
    reasons.push("the local read cap was reached, so some files were not read");
  }
  if (input.vendored) {
    reasons.push("a vendored tree was not read, so its notices were not checked");
  }
  if (input.agent) {
    reasons.push("an agent instruction file was not read");
  }
  if (input.unreadable) {
    reasons.push("a directory or file could not be read");
  }
  if (input.govRefused) {
    reasons.push("the governance file was refused, so it suppressed nothing");
  }
  if (input.govStale) {
    reasons.push("the governance file was written for an older notice version");
  }
  if (input.npmApplicable) {
    if (!input.lockfileInHand) {
      reasons.push("npm dependencies are declared but no npm lockfile was in the files read");
    } else {
      if (input.inventoryComplete === false) {
        reasons.push("the npm lockfile could not be fully inventoried");
      }
      if (!input.advisoriesQueried) {
        reasons.push("the lockfile versions were not queried, so advisories are unknown");
      } else if (input.advisoriesTimedOut) {
        reasons.push("the advisory query did not finish");
      } else if (input.advisoriesSkipped > 0) {
        reasons.push(`${input.advisoriesSkipped} lockfile packages were not queried for advisories`);
      }
      if (!input.registryQueried) {
        reasons.push("dependency terms were not queried, so licence terms are unknown");
      }
    }
  }
  // A lockfile the run read but did not inventory and query is a version set
  // that was in hand and was not checked. That is "not run", not "not
  // applicable": the report already names the file, and a partial result is
  // never a pass. This covers a second npm lockfile as well as another
  // ecosystem.
  if (input.unqueriedLockfileInHand) {
    reasons.push("a lockfile was in the files read and was not queried for versions");
  }
  const status: Completeness["status"] = reasons.length === 0 ? "complete" : "partial";
  const note =
    status === "complete"
      ? "Review complete."
      : `Review incomplete: ${reasons.join("; ")}.`;
  return { status, reasons, note };
}
