// What may be said about the local gh login. It reports whether gh is logged in
// and which repo is open. It never reads or repeats a token: everything comes
// from the gh command, and a token is never part of any answer. A failure is
// named by its outcome and exit status alone. gh's own stderr is never repeated
// into a tool answer, and a recognised credential shape is refused before it is
// rendered, in an error or in success metadata alike.

import { spawn } from "node:child_process";
import { PROVIDER_SHAPES } from "../../shared/analyzers/secretValue.ts";

export interface Account {
  loggedIn: boolean;
  login: string;
  owner: string;
  name: string;
  isPrivate: boolean;
  host: string;
}

// Every way a gh command can end. `ok` is the only outcome whose output may be
// used; the others are distinct so an incomplete or failed answer is never
// reported as a known state.
type RunOutcome = "ok" | "exit" | "timeout" | "spawn-failure" | "overflow";

interface RunResult {
  outcome: RunOutcome;
  code: number | null;
  stdout: string;
}

// A gh command is bounded. A long-running or chatty gh must not hang the server
// or grow without limit: output past the cap marks the answer unusable and the
// child is killed after the timeout. Neither becomes a partial answer.
const COMMAND_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 64 * 1024;

function run(command: string, args: string[]): Promise<RunResult> {
  return new Promise((resolveResult) => {
    let settled = false;
    const stdout: Buffer[] = [];
    let collectedBytes = 0;
    // On POSIX this is a new, owned process group. Only that group's children
    // may be killed; never search for or kill unrelated host processes.
    const grouped = process.platform !== "win32";
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], detached: grouped });
    const stop = () => {
      try {
        if (grouped && child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        // The owned child/group may already have exited.
      }
      child.stdout.destroy();
      child.stderr.destroy();
    };
    const finish = (outcome: RunOutcome, code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Failed evidence never needs to retain or decode untrusted output.
      const text = outcome === "ok" ? Buffer.concat(stdout).toString("utf8") : "";
      stdout.length = 0;
      if (outcome !== "ok") stop();
      resolveResult({ outcome, code, stdout: text });
    };
    const timer = setTimeout(() => {
      // Resolve independently of `close`: a descendant can inherit a pipe even
      // after gh itself has exited. Destroy owned streams and stop its group.
      finish("timeout", null);
    }, COMMAND_TIMEOUT_MS);
    const collect = (channel: "stdout" | "stderr", data: Buffer) => {
      if (settled) return;
      collectedBytes += data.length;
      if (collectedBytes > MAX_OUTPUT_BYTES) {
        finish("overflow", null);
      } else if (channel === "stdout") {
        stdout.push(data);
      }
    };
    child.stdout.on("data", (data: Buffer) => collect("stdout", data));
    child.stderr.on("data", (data: Buffer) => collect("stderr", data));
    child.on("error", () => {
      finish("spawn-failure", null);
    });
    child.on("close", (code) => {
      finish(code === 0 ? "ok" : "exit", code ?? null);
    });
  });
}

// A GitHub login, owner and repository name are bounded ASCII shapes. A login and
// an owner are a GitHub account name; a repository name may also carry dots and
// underscores. A recognised provider credential shape is refused even when it
// fits those shapes, so an AWS-key-shaped login or a token-shaped repository name
// is never repeated back.
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_PART = /^[A-Za-z0-9._-]{1,100}$/;

// Rendering has a stricter boundary than repository detection: a supported
// credential span embedded in a plain identifier must not be disclosed. Derive
// local span matchers only; repository precision/severity rules stay unchanged.
const CREDENTIAL_SPANS = PROVIDER_SHAPES.map((shape) => new RegExp(shape.source.replace(/\\b/g, ""), shape.flags));
function credentialShaped(value: string): boolean {
  return CREDENTIAL_SPANS.some((shape) => shape.test(value));
}

function usableLogin(value: string): string {
  const login = value.trim();
  if (!LOGIN.test(login) || credentialShaped(login)) return "";
  return login;
}

function usableRepoPart(value: string): string {
  if (!REPO_PART.test(value) || credentialShaped(value)) return "";
  return value;
}

// A bounded, truthful reason for a gh command that could not be read. It never
// repeats gh's own output, so a credential-shaped string in stderr or stdout can
// never reach a tool answer.
function unavailable(what: string, result: RunResult): Error {
  if (result.outcome === "timeout") return new Error(`gh did not answer ${what} before the timeout.`);
  if (result.outcome === "spawn-failure") return new Error(`gh could not be run to ${what}.`);
  if (result.outcome === "overflow")
    return new Error(`gh returned more output than can be read for ${what}, so it was not used.`);
  return new Error(`gh could not ${what}: exit status ${result.code ?? "unknown"}.`);
}

export function accountRepo(account: Account): string {
  if (account.owner === "" || account.name === "") {
    return "";
  }
  return `${account.owner}/${account.name}`;
}

export async function localAccount(): Promise<Account> {
  const status = await run("gh", ["auth", "status"]);
  // This command's nonzero exit does not distinguish missing authentication
  // from permission/service failures. Do not infer absence from exit or prose.
  if (status.outcome !== "ok") {
    throw unavailable("read the login status", status);
  }

  const user = await run("gh", ["api", "user", "--jq", ".login"]);
  // Logged in, so a failure here is a real failure and is reported as one. A
  // logged-in account behind a network problem must not be told to log in again,
  // and a truncated or credential-shaped answer is not a login name.
  if (user.outcome !== "ok") {
    throw unavailable("read the account", user);
  }
  const login = usableLogin(user.stdout);
  if (login === "") {
    throw new Error("gh is logged in but its account login could not be read as a plain name.");
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
  if (repo.outcome !== "ok") {
    throw unavailable("read the current repository", repo);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(repo.stdout);
  } catch {
    throw new Error("gh returned a current-repository answer that was not JSON, so it was not used.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("gh returned a current-repository answer that was not a JSON object, so it was not used.");
  }
  const record = parsed as Record<string, unknown>;
  const ownerField = record["owner"];
  const ownerLogin =
    typeof ownerField === "object" && ownerField !== null && !Array.isArray(ownerField)
      ? (ownerField as Record<string, unknown>)["login"]
      : undefined;
  const nameField = record["name"];
  // A number is not a string name. Reject rather than coerce.
  if (typeof ownerLogin !== "string" || typeof nameField !== "string") {
    throw new Error("gh returned a current-repository answer with fields that are not strings, so it was not used.");
  }
  const owner = usableRepoPart(ownerLogin);
  const name = usableRepoPart(nameField);
  if (owner === "" || name === "") {
    throw new Error("gh returned a current-repository answer that is not a plain owner/name, so it was not used.");
  }
  if (typeof record["isPrivate"] !== "boolean") {
    throw new Error("gh returned a current-repository answer without boolean privacy information, so it was not used.");
  }
  account.owner = owner;
  account.name = name;
  account.isPrivate = record["isPrivate"];
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
