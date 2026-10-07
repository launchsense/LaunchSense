// What each tool does once its arguments have been checked. Every tool reads
// this machine or the LaunchSense API. None of them downloads GitHub.

import type { Account } from "./github.ts";
import { accountText } from "./github.ts";
import { postJSON } from "./api.ts";
import { reviewRoot, reviewRootNote } from "./review.ts";

export interface ToolRuntime {
  apiURL: string;
  review: (root: string) => Promise<string>;
  account: () => Promise<Account>;
}

const NOTICE =
  "The public paste is the website, and the hosted address reads a public repo too: " +
  "https://harmless-chihuahua-667.convex.site/mcp\n" +
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
      const scanId = typeof args.scanId === "string" ? args.scanId : "";
      if (scanId.trim() === "") {
        throw new Error("scanId is required");
      }
      return await postJSON(runtime.apiURL, "/api/mcp/report", { scanId });
    }
    case "launchsense_github":
      return accountText(await runtime.account());
    case "launchsense_scan_repo":
      return await scanRepo(runtime);
    default:
      throw new Error(`unknown tool ${name}`);
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
