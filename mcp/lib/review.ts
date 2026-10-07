// Where the local review reads, and the subprocess that runs it. The review is
// review-entry.ts, the same node script the website check uses, run against a
// checkout on this machine.

import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { reviewTimeoutMs } from "./limits.ts";

// reviewScript is the local review entry point. The installer passes an absolute
// LAUNCHSENSE_REVIEW. Without it, resolve against the review root, not the
// process folder: the server runs with cwd inside the checkout, so a process
// relative default would look under mcp/ and find nothing.
export function reviewScript(root: string): string {
  const named = (process.env.LAUNCHSENSE_REVIEW ?? "").trim();
  if (named !== "") {
    return named;
  }
  const candidates = [
    join(root, "mcp", "review-entry.ts"),
    join(root, "review-entry.ts"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `no review script found. Set LAUNCHSENSE_REVIEW to review-entry.ts, or start the server from a LaunchSense checkout. Looked in ${candidates.join(" and ")}`,
  );
}

// reviewRoot is the checkout the local server reads. LAUNCHSENSE_ROOT names the
// checkout and the installer sets it. It must be an absolute path: resolving a
// relative one against the process folder is how the mcp module folder passes as
// a checkout, so it is refused instead. Without the variable, a process folder
// that is the checkout is used, and otherwise the process folder as it was.
export function reviewRoot(): string {
  const named = (process.env.LAUNCHSENSE_ROOT ?? "").trim();
  if (named !== "") {
    if (!isAbsolute(named)) {
      throw new Error(
        `LAUNCHSENSE_ROOT must be an absolute path, got ${JSON.stringify(named)}. A relative path is resolved against the folder the server was started in, which is this server's own mcp module, so the review would read that folder instead of the checkout. Set LAUNCHSENSE_ROOT to the absolute checkout root, for example /home/you/launchsense`,
      );
    }
    const root = resolve(named);
    let info;
    try {
      info = statSync(root);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`LAUNCHSENSE_ROOT is not readable: ${reason}`);
    }
    if (!info.isDirectory()) {
      throw new Error("LAUNCHSENSE_ROOT is not a folder");
    }
    return root;
  }
  const cwd = process.cwd();
  const checkout = checkoutAbove(cwd);
  return checkout === "" ? cwd : checkout;
}

// looksLikeCheckout reports whether root holds a LaunchSense checkout. The
// server lives in mcp/, so a checkout has mcp/review-entry.ts and mcp/server.ts.
// The markers are a shape check, not a proof: they exist so an honest checkout
// is quiet and an unfamiliar folder is named.
export function looksLikeCheckout(root: string): boolean {
  return (
    existsSync(join(root, "mcp", "review-entry.ts")) ||
    existsSync(join(root, "mcp", "server.ts"))
  );
}

// reviewRootNote names the folder the review read when that folder is not a
// checkout. A wrong root is otherwise invisible: the report is a confident
// review of whatever that folder held, and the reader never learns which folder
// it was. A checkout gets no line, so the normal case stays quiet.
export function reviewRootNote(root: string): string {
  if (looksLikeCheckout(root)) {
    return "";
  }
  return `Reviewed folder: ${root}\nThat folder is what the review read. It has no mcp/review-entry.ts and no mcp/server.ts, so it is not a LaunchSense checkout. If this is the wrong folder, set LAUNCHSENSE_ROOT to the absolute checkout root and ask again.`;
}

// checkoutAbove returns the checkout that owns folder, or "" when folder is not
// this server's module folder. The two module files are what mark the folder, so
// a folder that only shares its name does not count, and a folder at the file
// system root has no parent to name.
export function checkoutAbove(folder: string): string {
  if (
    !existsSync(join(folder, "review-entry.ts")) ||
    !existsSync(join(folder, "server.ts"))
  ) {
    return "";
  }
  const parent = dirname(folder);
  return parent === folder ? "" : parent;
}

// runNodeReview runs the review script with node and returns its combined
// output, trimmed. A review that runs past its budget is killed and reported as
// an error, so a review that never finishes cannot live for ever.
export async function runNodeReview(root: string): Promise<string> {
  const script = reviewScript(root);
  return new Promise<string>((resolveOutput, reject) => {
    const child = spawn(process.execPath, [script, "--root", root], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(
        new Error(
          `the local review did not finish within ${reviewTimeoutMs} ms, so there is no report here and nothing is claimed about the files. Run it yourself to see the whole review: ${process.execPath} ${script} --root ${root}`,
        ),
      );
    }, reviewTimeoutMs);
    child.stdout.on("data", (data: Buffer) => (output += data.toString("utf8")));
    child.stderr.on("data", (data: Buffer) => (output += data.toString("utf8")));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const text = output.trim();
      if (code === 0) {
        resolveOutput(text);
        return;
      }
      reject(new Error(text === "" ? `exit status ${code}` : text));
    });
  });
}
