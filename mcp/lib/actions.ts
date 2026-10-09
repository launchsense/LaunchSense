// What each tool does once its arguments have been checked. Every tool reads
// this machine. None of them downloads GitHub and none uploads files.

import type { Account } from "./github.ts";
import { accountText } from "./github.ts";
import { reviewRoot, reviewRootNote } from "./review.ts";
import type { ReviewMode } from "./review.ts";
import { maxReportBytes } from "./limits.ts";
import { closeSync } from "node:fs";
import { openReviewRoot } from "../root-boundary.ts";
import { isSavedReportName, listDirectoryNames, openChildDirectory, readBoundedFile } from "../local-state.ts";

export interface ToolRuntime {
  apiURL: string;
  review: (root: string, mode: ReviewMode) => Promise<string>;
  account: () => Promise<Account>;
}

const NOTICE =
  "Policies live online at https://harmless-chihuahua-667.convex.site/mcp: skill, " +
  "rules, checklists, and audit instructions only, never a file read.\n" +
  "This server reviews the files on this machine and does not download GitHub. " +
  "Use launchsense_scan_repo for the checkout.";

// callTool runs one tool by name. It throws on a failure, and the caller turns
// that into a tool result with isError set, because a tool that ran and failed
// is a result and not a protocol error.
export async function callTool(
  name: string,
  args: Record<string, unknown>,
  runtime: ToolRuntime,
): Promise<string> {
  switch (name) {
    case "launchsense_scan_public_notice":
      return NOTICE;
    case "launchsense_report": {
      return readLatestLocalReport();
    }
    case "launchsense_github":
      return accountText(await runtime.account());
    case "launchsense_scan_repo":
      return await scanRepo(runtime, scanMode(args));
    default:
      throw new Error(`unknown tool ${name}`);
  }
}

// scanMode reads the mode argument. The schema allows only "tree" and
// "change", and an unknown value is refused there, so anything else here is
// tree: the whole-tree review stays the default, and a change run must be asked
// for explicitly.
function scanMode(args: Record<string, unknown>): ReviewMode {
  return args["mode"] === "change" ? "change" : "tree";
}

// readLatestLocalReport returns the newest report the local review wrote under
// .ls/reports. Local only: it never asks any server, because reports stay on the
// machine. Set LAUNCHSENSE_ROOT at the checkout, the same root the review uses,
// so the report is for the checkout and not for the server folder.
//
// The root is pinned and every component is opened from a pinned parent, with
// the final component refusing a link. A linked `.ls`, a linked `.ls/reports`,
// or a linked report file is refused rather than followed, so this read cannot
// be redirected outside the checkout. Absence is still the ordinary "no report
// yet" answer; a link or an unreadable file is a refusal and says so.
//
// Only a file whose name is the saved-report shape (a run stamp then `.md`) is
// treated as a report. The third-party notice also ends in `.md`, and an
// unrelated file a person dropped in the folder may too. Neither is a report, so
// neither is returned as one. Files are never deleted or moved to make a
// selection; a name that is not a report is simply skipped.
function readLatestLocalReport(): string {
  const root = reviewRoot();
  const { fd: rootFd } = openReviewRoot(root);
  try {
    const ls = openChildDirectory(rootFd, ".ls");
    if (ls.state === "absent") throw new Error("No local report yet. Run launchsense_scan_repo first.");
    if (ls.state === "refused") throw new Error(`The local report folder could not be read: ${ls.reason}`);
    const lsFd = ls.value;
    try {
      const listed = listDirectoryNames(lsFd, "reports");
      if (listed.state === "absent") throw new Error("No local report yet. Run launchsense_scan_repo first.");
      if (listed.state === "refused") throw new Error(`The local report folder could not be read: ${listed.reason}`);
      const names = listed.value.filter((name) => isSavedReportName(name)).sort();
      if (names.length === 0) throw new Error("No local report yet. Run launchsense_scan_repo first.");
      const latest = names[names.length - 1];
      if (latest === undefined) throw new Error("No local report yet. Run launchsense_scan_repo first.");
      const reports = openChildDirectory(lsFd, "reports");
      if (reports.state !== "ok") throw new Error("The latest local report could not be read as text.");
      const reportsFd = reports.value;
      try {
        const read = readBoundedFile(reportsFd, latest, maxReportBytes);
        if (read.state === "absent") {
          // The named report was removed between the listing and the read. The
          // older reports, if any, are still on disk and still readable, so name
          // them rather than claiming there is no report at all.
          const older = names.slice(0, -1);
          if (older.length > 0) {
            throw new Error(
              `The newest local report was removed while it was being read. Older reports are still on disk under .ls/reports; read those.`,
            );
          }
          throw new Error("No local report yet. Run launchsense_scan_repo first.");
        }
        if (read.state === "refused") {
          if (read.code === "too_large") {
            throw new Error("The latest local report is over 1 MiB. Read it from .ls/reports directly.");
          }
          if (read.code === "link") throw new Error(`The latest local report is a symbolic link: ${read.reason}`);
          throw new Error("The latest local report could not be read as text.");
        }
        return read.value;
      } finally {
        closeSync(reportsFd);
      }
    } finally {
      closeSync(lsFd);
    }
  } finally {
    closeSync(rootFd);
  }
}
// scanRepo reviews the checkout named by LAUNCHSENSE_ROOT. It takes no arguments
// on purpose: it reads files on this machine, so a repository URL would be a
// promise this tool cannot keep. A root that is not a checkout is announced
// before the report, and the same line goes on an error, so a review of the
// wrong folder is never a quiet confident answer.
async function scanRepo(runtime: ToolRuntime, mode: ReviewMode): Promise<string> {
  const root = reviewRoot();
  const note = reviewRootNote(root);
  try {
    const text = await runtime.review(root, mode);
    return note === "" ? text : `${note}\n${text}`;
  } catch (error) {
    if (note === "") {
      throw error;
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${note}\n${reason}`);
  }
}
