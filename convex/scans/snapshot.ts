// One commit, pinned, and the two shas it carries.
//
// Pure on purpose: no Convex import, no fetch, no database. Every assertion a
// scan makes about the snapshot it read lives here so a test can drive it with a
// fake GitHub response rather than read it as a comment.
//
// Why this module exists at all. `GET /git/trees/{sha}` returns the TREE OBJECT
// sha, which is not the commit sha that was used to request it. Two consequences:
//
//   1. Recording one field for both and comparing them would fail on every repo,
//      and dropping the difference proves nothing at all.
//   2. The one cheap way to know the tree response belongs to the commit we
//      asked for is to compare it to the tree sha the COMMIT response already
//      carried. `GET /repos/{o}/{r}/commits/{ref}` returns both the commit sha
//      and `commit.tree.sha`, so the cross-check costs no extra request.
//
// A scan is a snapshot of one commit, never of a moving ref. That is what
// "committed code only" means here, so both the tree request and every blob ref
// go through the functions below, and each refuses a sha that is not pinned.

/** A commit sha is 40 lowercase hex characters. Nothing else is one. */
export const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

/** True when the value is a full commit sha, so a ref can never be used as one. */
export function isPinnedCommitSha(value: unknown): value is string {
  return typeof value === "string" && COMMIT_SHA_PATTERN.test(value);
}

/**
 * The two shas a scan records, plus whether they agree.
 *
 * commitSha is what the scan describes. treeSha is the tree object GitHub
 * reported for it. They are stored as separate fields and are never assumed
 * equal. `commitTreeSha` is what the commit response claimed its tree was, and
 * comparing that against the tree response's own sha is the integrity check.
 */
export type SnapshotShas = {
  commitSha: string;
  treeSha?: string;
  /** The sha the commit response said its tree carried. Not stored, compared. */
  commitTreeSha?: string;
};

/**
 * Why a snapshot is untrustworthy, or null when it holds together.
 *
 * `commit_sha_unpinned` means the ref never resolved to a full commit sha, so
 * there is nothing to pin the tree to. `tree_sha_mismatch` means the tree
 * response describes a different tree than the commit response promised, which
 * is what a proxied or misrouted response looks like. Neither is recoverable
 * in-place, so both fail the scan rather than record a snapshot nobody can
 * trust.
 */
export type SnapshotDefect = "commit_sha_unpinned" | "tree_sha_unpinned" | "tree_sha_mismatch";

/**
 * Check a snapshot and split it into the fields to store.
 *
 * Returns the two fields to write, or a defect to fail on. A tree sha that is
 * simply absent is not a defect: a caller can send back a tree body without one,
 * and refusing the whole scan over a missing optional value would be harsher
 * than the evidence supports. A tree sha that is present and disagrees IS a
 * defect, because two server responses are contradicting each other.
 */
export function checkSnapshot(shas: SnapshotShas): {
  ok: true;
  commitSha: string;
  treeSha?: string;
} | { ok: false; defect: SnapshotDefect } {
  if (!isPinnedCommitSha(shas.commitSha)) return { ok: false, defect: "commit_sha_unpinned" };
  if (shas.treeSha !== undefined && !isPinnedCommitSha(shas.treeSha)) {
    return { ok: false, defect: "tree_sha_unpinned" };
  }
  if (
    shas.treeSha !== undefined &&
    shas.commitTreeSha !== undefined &&
    shas.treeSha !== shas.commitTreeSha
  ) {
    // Two responses from the same server disagree about which tree this commit
    // has. Recording it anyway would put a snapshot on a scan that neither
    // response supports.
    return { ok: false, defect: "tree_sha_mismatch" };
  }
  return shas.treeSha === undefined
    ? { ok: true, commitSha: shas.commitSha }
    : { ok: true, commitSha: shas.commitSha, treeSha: shas.treeSha };
}

/**
 * The tree request URL for a pinned commit.
 *
 * Returns null for anything that is not a full commit sha, so a branch name can
 * never reach this call site and be read as a moving ref. A caller that gets
 * null has to fail the scan; it does not fall back to the ref.
 */
export function treeRequestUrl(owner: string, repo: string, commitSha: string): string | null {
  if (!isPinnedCommitSha(commitSha)) return null;
  return `https://api.github.com/repos/${owner}/${repo}/git/trees/${commitSha}?recursive=1`;
}

/**
 * The blob ref query for a pinned commit.
 *
 * Every file body is read at `?ref=<commit sha>`, never at a branch. Returning
 * null for an unpinned sha means a blob read cannot silently become a read of
 * whatever the branch points at now, which is the failure that would make a scan
 * a description of two different commits.
 */
export function blobRefQuery(commitSha: string): string | null {
  if (!isPinnedCommitSha(commitSha)) return null;
  return `?ref=${commitSha}`;
}

/**
 * The tree sha a commit response claimed, or undefined.
 *
 * Read from `commit.tree.sha`, which is what GitHub returns alongside the commit
 * sha. An absent value is undefined rather than an error: it means this response
 * did not carry the cross-check, not that the two disagree.
 */
export function commitTreeShaOf(commitResponse: unknown): string | undefined {
  if (typeof commitResponse !== "object" || commitResponse === null) return undefined;
  const commit = (commitResponse as Record<string, unknown>).commit;
  if (typeof commit !== "object" || commit === null) return undefined;
  const tree = (commit as Record<string, unknown>).tree;
  if (typeof tree !== "object" || tree === null) return undefined;
  const sha = (tree as Record<string, unknown>).sha;
  return typeof sha === "string" ? sha : undefined;
}

/** The commit sha a response carries, or undefined. */
export function commitShaOf(response: unknown): string | undefined {
  if (typeof response !== "object" || response === null) return undefined;
  const sha = (response as Record<string, unknown>).sha;
  return typeof sha === "string" ? sha : undefined;
}

/** The tree sha a tree response carries, or undefined. */
export function treeShaOf(response: unknown): string | undefined {
  if (typeof response !== "object" || response === null) return undefined;
  const sha = (response as Record<string, unknown>).sha;
  return typeof sha === "string" ? sha : undefined;
}