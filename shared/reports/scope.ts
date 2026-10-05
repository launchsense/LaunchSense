// Verdict and scope wording for a scan result.
//
// The rule this file exists to enforce: a verdict is never rendered without its
// scope sitting beside it. "Nothing to flag" reads as safe, so the scope line
// that says how little was actually read must be impossible to skip.
//
// Four states only. Nothing else may appear in this file or in the UI:
//   checked     the check ran and returned a result
//   partial     the check ran but skipped some inputs, and the counts are shown
//   notChecked  the check did not run, and the reason is shown
//   unknown     a previous result cannot be re-verified
//
// Nothing here decides a finding. It only describes what was examined.

import { GUEST_MAX_BYTES, GUEST_MAX_FILES } from "../scanCaps.ts";

export type ScopeState = "checked" | "partial" | "notChecked" | "unknown";

export const SCOPE_LABEL: Record<ScopeState, string> = {
  checked: "Checked",
  partial: "Partial",
  notChecked: "Not checked",
  unknown: "Unknown",
};

export type ScanStatus = "validating" | "fetching" | "completed" | "partial" | "failed";

export interface VerdictInput {
  status: ScanStatus;
  /** Files whose contents were actually read and analyzed. */
  fetched: number;
  /** Files skipped by a cap, a size budget, or a fetch failure. */
  skipped: number;
  /** Paths in the repository tree, when the tree fetch succeeded. */
  total: number | undefined;
  /** Findings the analyzers produced. Info findings count as findings. */
  findingCount: number;
  /** Findings a reader must act on. Info findings are notes, not actions. */
  actionableCount: number;
  /** True when the scan ended in the partial state. */
  truncatedTree?: boolean;
}

export interface StageLine {
  label: string;
  state: ScopeState;
  detail: string;
}

export interface Verdict {
  /** Never readable as a clean bill of health on its own. */
  headline: string;
  /** Always adjacent to the headline. Says how much was and was not read. */
  scope: string;
  state: ScopeState;
  stages: StageLine[];
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

// "We read 12 of 340 files. The other 328 were not read."
function readScope(fetched: number, total: number | undefined, skipped: number): string {
  if (total === undefined) {
    return `We read ${fetched} ${plural(fetched, "file", "files")} and did not finish listing the repository.`;
  }
  const unread = Math.max(0, total - fetched);
  if (unread === 0 && skipped === 0) {
    return `We read all ${total} ${plural(total, "file", "files")} in the repository.`;
  }
  return `We read ${fetched} of ${total} ${plural(total, "file", "files")}. The other ${unread} ${plural(unread, "was", "were")} not read.`;
}

// "We found 3 to fix, 2 notes in the files we read." Info findings are notes,
// so the two counts are always shown apart. A zero count drops its clause
// rather than printing "0 notes".
function foundPhrase(actionableCount: number, noteCount: number, where: string): string {
  const fix = `${actionableCount} to fix`;
  const notes = `${noteCount} ${plural(noteCount, "note", "notes")}`;
  if (actionableCount === 0) return `We found ${notes} in the ${where}.`;
  if (noteCount === 0) return `We found ${fix} in the ${where}.`;
  return `We found ${fix}, ${notes} in the ${where}.`;
}

export function buildVerdict(input: VerdictInput): Verdict {
  const { status, fetched, skipped, total, findingCount, actionableCount } = input;
  const scope = readScope(fetched, total, skipped);
  const noteCount = Math.max(0, findingCount - actionableCount);

  const stages: StageLine[] = [];

  if (total === undefined) {
    stages.push({
      label: "File list",
      state: "unknown",
      detail: "We did not finish listing the repository.",
    });
  } else {
    stages.push({
      label: "File list",
      state: "checked",
      detail: `${total} ${plural(total, "path", "paths")} in the repository${input.truncatedTree === true ? ", list was cut off" : ""}.`,
    });
  }

  if (status === "failed") {
    stages.push({
      label: "File contents",
      state: "notChecked",
      detail: "The scan stopped before reading file contents.",
    });
  } else if (skipped > 0) {
    stages.push({
      label: "File contents",
      state: "partial",
      detail: `Read ${fetched}, skipped ${skipped}. Skipped files were not analyzed.`,
    });
  } else {
    stages.push({
      label: "File contents",
      state: "checked",
      detail: `Read and analyzed ${fetched} ${plural(fetched, "file", "files")}.`,
    });
  }

  // Headline. The order matters: state first when the state is the news.
  let headline: string;
  let state: ScopeState;

  if (status === "failed") {
    headline = "The scan did not finish, so there is no result to read.";
    state = "notChecked";
  } else if (status === "partial" || skipped > 0) {
    state = "partial";
    headline =
      findingCount === 0
        ? "This result is partial. Nothing was flagged in the files we did read."
        : `This result is partial. ${foundPhrase(actionableCount, noteCount, "files we did read")}`;
  } else if (findingCount === 0) {
    state = "checked";
    headline = "Nothing was flagged in the files we read. This is not a clean bill of health.";
  } else {
    state = "checked";
    headline = foundPhrase(actionableCount, noteCount, "files we read");
  }

  return { headline, scope, state, stages };
}

// The fixed list of checks this product does not run. Kept next to the verdict
// so the two can never drift apart.
export function buildNotCheckedList(options: {
  /**
   * Whether a provider wrote the explanations on screen. This must be a
   * structural fact from the explain lane, never a test over a string a provider
   * wrote: the provider chooses the model name that ends up in the note, so a
   * string test would let a provider add or remove the disclosure below.
   */
  aiConfigured: boolean;
  liveProvided: boolean;
  /** Read caps this scan used. Defaults to the guest caps. */
  maxFiles?: number;
  maxBytes?: number;
}): string[] {
  const maxFiles = options.maxFiles ?? GUEST_MAX_FILES;
  const maxBytes = options.maxBytes ?? GUEST_MAX_BYTES;
  const list = [
    `Files past the ${maxFiles.toLocaleString("en-US")} file and ${Math.round(maxBytes / 1_000_000)}MB read caps.`,
    "Binary and generated files.",
    "Whether dependency advisories are current.",
    "How the app looks in a real browser. We read served HTML, not a rendered phone screen.",
  ];
  if (!options.liveProvided) {
    list.push("Your live app. You did not give a URL for this scan.");
  }
  if (!options.aiConfigured) {
    list.push("Plain word explanations. No AI provider answered this scan.");
  }
  return list;
}