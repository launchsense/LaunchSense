export interface ParsedRepo {
  owner: string;
  repo: string;
  normalizedUrl: string;
}

const OWNER_REPO_PATTERN = /^[A-Za-z0-9_.-]+$/;

export function parseGitHubRepoUrl(input: string):
  | { ok: true; value: ParsedRepo }
  | { ok: false; error: string } {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, error: "Enter a GitHub repository URL." };
  if (trimmed.length > 500) return { ok: false, error: "That URL is too long." };
  if (trimmed.includes("@") && trimmed.includes("://")) {
    const afterScheme = trimmed.split("://")[1] ?? "";
    const hostPart = afterScheme.split("/")[0] ?? "";
    if (hostPart.includes("@")) {
      return { ok: false, error: "URLs with credentials are not allowed. Paste a plain public repository URL." };
    }
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: "That does not look like a URL. Paste a https://github.com/owner/repo link." };
  }

  if (url.protocol !== "https:") {
    return { ok: false, error: "Only https GitHub URLs are accepted." };
  }
  if (url.hostname.toLowerCase() !== "github.com") {
    return { ok: false, error: "Only github.com repository URLs are accepted." };
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return { ok: false, error: "URLs with credentials are not allowed. Paste a plain public repository URL." };
  }

  const segments = url.pathname.split("/").filter((s) => s.length > 0);
  if (segments.length < 2) {
    return { ok: false, error: "Include both owner and repository, like https://github.com/owner/repo." };
  }
  const owner = segments[0] ?? "";
  let repo = segments[1] ?? "";
  if (repo.toLowerCase().endsWith(".git")) repo = repo.slice(0, -4);

  if (owner.length < 1 || owner.length > 100 || repo.length < 1 || repo.length > 100) {
    return { ok: false, error: "Owner and repository names must be 1-100 characters." };
  }
  if (!OWNER_REPO_PATTERN.test(owner) || !OWNER_REPO_PATTERN.test(repo)) {
    return { ok: false, error: "Owner and repository may only contain letters, numbers, dot, underscore, or hyphen." };
  }
  if (owner === "." || owner === ".." || repo === "." || repo === "..") {
    return { ok: false, error: "That repository path is not allowed." };
  }

  return { ok: true, value: { owner, repo, normalizedUrl: `https://github.com/${owner}/${repo}` } };
}
