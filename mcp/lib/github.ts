// What may be said about the local gh login. It reports whether gh is logged in
// and which repo is open. It never reads or repeats a token: everything comes
// from the gh command, and a token is never part of any answer.

import { spawn } from "node:child_process";

export interface Account {
  loggedIn: boolean;
  login: string;
  owner: string;
  name: string;
  isPrivate: boolean;
  host: string;
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(command: string, args: string[]): Promise<RunResult> {
  return new Promise((resolveResult) => {
    let settled = false;
    const finish = (result: RunResult) => {
      if (settled) return;
      settled = true;
      resolveResult(result);
    };
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data: Buffer) => (stdout += data.toString("utf8")));
    child.stderr.on("data", (data: Buffer) => (stderr += data.toString("utf8")));
    child.on("error", () => finish({ code: 127, stdout: "", stderr: "" }));
    child.on("close", (code) => finish({ code: code ?? 1, stdout, stderr }));
  });
}

function blank(): Account {
  return {
    loggedIn: false,
    login: "",
    owner: "",
    name: "",
    isPrivate: false,
    host: "github.com",
  };
}

// failure names why a gh command that should have worked did not. The detail is
// gh's own stderr, which carries an HTTP status or a message and never a token.
function failure(result: RunResult): string {
  const detail = result.stderr.trim();
  return detail === "" ? `exit status ${result.code}` : detail;
}

export function accountRepo(account: Account): string {
  if (account.owner === "" || account.name === "") {
    return "";
  }
  return `${account.owner}/${account.name}`;
}

export async function localAccount(): Promise<Account> {
  const status = await run("gh", ["auth", "status"]);
  const statusText = status.stdout + status.stderr;
  if (status.code !== 0 && !/Logged in to/.test(statusText)) {
    return blank();
  }

  const user = await run("gh", ["api", "user", "--jq", ".login"]);
  const login = user.stdout.trim();
  // Logged in, so a failure here is a real failure and is reported as one. A
  // logged-in account behind a network problem must not be told to log in
  // again, which is what the Go server it replaces also did.
  if (user.code !== 0) {
    throw new Error(`gh could not read the account: ${failure(user)}`);
  }
  if (login === "") {
    throw new Error("gh is logged in but its account has no login name.");
  }

  const account: Account = {
    loggedIn: true,
    login,
    owner: "",
    name: "",
    isPrivate: false,
    host: "github.com",
  };

  const repo = await run("gh", ["repo", "view", "--json", "owner,name,isPrivate"]);
  if (repo.code !== 0) {
    return account;
  }
  try {
    const parsed = JSON.parse(repo.stdout) as {
      owner?: { login?: string };
      name?: string;
      isPrivate?: boolean;
    };
    account.owner = parsed.owner?.login ?? "";
    account.name = parsed.name ?? "";
    account.isPrivate = parsed.isPrivate === true;
    account.host = "github.com";
  } catch {
    return account;
  }
  return account;
}

export function accountText(account: Account): string {
  if (!account.loggedIn) {
    return "gh is not logged in on this machine.\nRun: gh auth login\nThen ask again. The website Sign in button is not this login.";
  }
  const lines = [`Logged in to GitHub as ${account.login}.`];
  const repo = accountRepo(account);
  if (repo === "") {
    lines.push(
      "No current repo. Pass a github.com URL, or run this inside a checkout.",
    );
  } else if (account.isPrivate) {
    lines.push(
      `Current repo ${repo} is private. The local review can read a checkout on this machine. It does not send a token.`,
    );
  } else {
    lines.push(`Current repo ${repo} is public.`);
  }
  lines.push(
    "The local review reads files on this machine. It does not download GitHub. Alpha has no login.",
  );
  return lines.join("\n");
}
