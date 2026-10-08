// What each tool does once its arguments have been checked. Every tool reads
// this machine. None of them downloads GitHub and none uploads files.

import type { Account } from "./github.ts";
import { accountText } from "./github.ts";
import { reviewRoot, reviewRootNote } from "./review.ts";
import { maxReportBytes } from "./limits.ts";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export interface ToolRuntime {
  apiURL: string;
  review: (root: string) => Promise<string>;
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
  _args: Record<string, unknown>,
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
      return await scanRepo(runtime);
    default:
      throw new Error(`unknown tool ${name}`);
  }
}

// readLatestLocalReport returns the newest report the local review wrote under
// .ls/reports. Local only: it never asks any server, because reports stay on
// the machine. Set LAUNCHSENSE_ROOT at the checkout, the same root the review
// uses, so the report is for the checkout and not for the server folder.
function readLatestLocalReport(): string {
  const root = reviewRoot();
  const dir = join(root, ".ls", "reports");
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".md")).sort();
  } catch {
    throw new Error("No local report yet. Run launchsense_scan_repo first.");
  }
  if (names.length === 0) {
    throw new Error("No local report yet. Run launchsense_scan_repo first.");
  }
  const latest = names[names.length - 1];
  if (latest === undefined) {
    throw new Error("No local report yet. Run launchsense_scan_repo first.");
  }
  try {
    const info = statSync(join(dir, latest));
    if (info.size > maxReportBytes) {
      throw new Error("The latest local report is over 1 MiB. Read it from .ls/reports directly.");
    }
    return readFileSync(join(dir, latest), "utf8");
  } catch (error) {
    if (error instanceof Error && /No local report|over 1 MiB/.test(error.message)) throw error;
    throw new Error("The latest local report could not be read as text.");
  }
}
// scanRepo reviews the checkout named by LAUNCHSENSE_ROOT. It takes no arguments
// on purpose: it reads files on this machine, so a repository URL would be a
// promise this tool cannot keep. A root that is not a checkout is announced
// before the report, and the same line goes on an error, so a review of the
// wrong folder is never a quiet confident answer.
async function scanRepo(runtime: ToolRuntime): Promise<string> {
  const root = reviewRoot();
  const note = reviewRootNote(root);
  try {
    const text = await runtime.review(root);
    return note === "" ? text : `${note}\n${text}`;
  } catch (error) {
    if (note === "") {
      throw error;
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${note}\n${reason}`);
  }
}
