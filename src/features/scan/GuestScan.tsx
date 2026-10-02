import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export default function GuestScan() {
  const runScan = useAction(api.scans.actions.runScan);
  const [repoUrl, setRepoUrl] = useState("");
  const [scanId, setScanId] = useState<Id<"scans"> | null>(null);
  const [running, setRunning] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [wasCached, setWasCached] = useState(false);
  const scanState = useQuery(
    api.scans.queries.getScan,
    scanId === null ? "skip" : { scanId },
  );

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError("");
    setWasCached(false);
    if (repoUrl.trim().length === 0) {
      setSubmitError("Paste a public GitHub repository URL to start.");
      return;
    }
    setRunning(true);
    try {
      const result = await runScan({ repoUrl: repoUrl.trim() });
      setScanId(result.scanId);
      setWasCached(result.cached);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Could not start the scan. Try again.");
    } finally {
      setRunning(false);
    }
  }

  const scan = scanState?.scan ?? null;
  const status = scan?.status ?? (running ? "fetching" : null);

  return (
    <section aria-label="Guest repository scan">
      <h2>Scan a public repository</h2>
      <div role="note" aria-label="Privacy note">
        <p>
          <strong>Before you run:</strong> we fetch the public file list only.
          Nothing on your machine leaves the browser except the repository URL.
          We save the owner, repo, commit SHA, and file paths for 24-hour caching.
          No code contents are stored in this stage. Free GitHub quota is shared;
          quota exhaustion shows as partial, never as a pass.
        </p>
      </div>
      <form onSubmit={(e) => void onSubmit(e)}>
        <label htmlFor="guest-repo-url">Public GitHub URL</label>
        <input
          id="guest-repo-url"
          name="repoUrl"
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://github.com/owner/repo"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
        />
        <button type="submit" disabled={running}>
          {running ? "Fetching…" : "Run scan"}
        </button>
      </form>
      {submitError.length > 0 && <p role="alert">{submitError}</p>}
      {status !== null && <p role="status">Status: {status}{wasCached ? " (cached)" : ""}</p>}
      {scan !== null && (
        <article aria-label="Scan result">
          <p>
            <strong>{scan.owner}/{scan.repo}</strong>
            {scan.sha !== undefined && <> · commit {shortSha(scan.sha)}</>}
            {scan.defaultBranch !== undefined && <> · branch {scan.defaultBranch}</>}
          </p>
          {scan.fileCount !== undefined && (
            <p>{scan.fileCount} paths in tree{scan.truncated === true ? " (truncated)" : ""}.</p>
          )}
          {scan.errorMessage !== undefined && <p role="alert">{scan.errorMessage}</p>}
          {scan.rateLimitResetAt !== undefined && (
            <p>Quota resets at {new Date(scan.rateLimitResetAt).toLocaleTimeString()}.</p>
          )}
          <div aria-label="What was not checked">
            <p>
              <strong>Not checked in this stage:</strong> file contents, secrets,
              dependencies, licenses, live URL, and AI explanations.{" "}
              {scan.status === "partial"
                ? "This is a partial tree fetch — unlisted files were not examined."
                : "Tree fetch only."}
            </p>
          </div>
          {scanState !== undefined && scanState.samplePaths.length > 0 && (
            <details>
              <summary>First {scanState.samplePaths.length} paths (of {scanState.storedEntries} stored)</summary>
              <ul>
                {scanState.samplePaths.slice(0, 20).map((entry: { path: string; type: string }) => (
                  <li key={entry.path}>{entry.path}</li>
                ))}
              </ul>
            </details>
          )}
        </article>
      )}
    </section>
  );
}
