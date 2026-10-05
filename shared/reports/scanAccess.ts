// Pure ownership rule for the report queries. A guest scan of a public repo is
// id-addressed: anyone holding the link can read it. A signed-in scan may hold
// private repo data, so only its owner can read it. No db access here so the
// rule is testable on its own.

export function canReadScan(
  scan: { signedIn?: boolean; userId?: string | null },
  viewerId: string | null,
): boolean {
  if (scan.signedIn !== true) return true;
  return viewerId !== null && scan.userId != null && viewerId === scan.userId;
}
