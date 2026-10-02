import { useMemo, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { buildFixPlan } from "../../../shared/reports/fixPlan";
import type { PlanFinding } from "../../../shared/reports/fixPlan";

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export default function GuestScan() {
  const runScan = useAction(api.scans.actions.runScan);
  const analyzeScan = useAction(api.scans.analyze.analyzeScan);
  const [repoUrl, setRepoUrl] = useState("");
  const [scanId, setScanId] = useState<Id<"scans"> | null>(null);
  const [phase, setPhase] = useState<"idle" | "fetching" | "analyzing">("idle");
  const [submitError, setSubmitError] = useState("");
  const [wasCached, setWasCached] = useState(false);
  const scanState = useQuery(
    api.scans.queries.getScan,
    scanId === null ? "skip" : { scanId },
  );
  const resultsState = useQuery(
    api.scans.queries.getResults,
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
    setPhase("fetching");
    try {
      const result = await runScan({ repoUrl: repoUrl.trim() });
      setScanId(result.scanId);
      setWasCached(result.cached);
      if (result.status === "failed") {
        setPhase("idle");
        return;
      }
      setPhase("analyzing");
      await analyzeScan({ scanId: result.scanId });
      setPhase("idle");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Could not run the scan. Try again.");
      setPhase("idle");
    }
  }

  const scan = scanState?.scan ?? resultsState?.scan ?? null;
  const status = scan?.status ?? (phase === "fetching" ? "fetching" : phase === "analyzing" ? "analyzing" : null);
  const findings: PlanFinding[] = useMemo(
    () =>
      (resultsState?.findings ?? []).map((f) => ({
        ruleId: f.ruleId,
        path: f.path,
        severity: f.severity,
        title: f.title,
      })),
    [resultsState],
  );
  const plan = useMemo(() => buildFixPlan(findings), [findings]);
  const counts = useMemo(() => {
    const out = { high: 0, medium: 0, low: 0, info: 0 };
    for (const f of findings) out[f.severity]++;
    return out;
  }, [findings]);
  const analyzed = resultsState?.analyzed === true;

  return (
    <section aria-label="Guest repository scan">
      <h2>Scan a public repository</h2>
      <div role="note" aria-label="Privacy note">
        <p>
          <strong>Before you run:</strong> we fetch the public file list and
          bounded file contents. Nothing on your machine leaves the browser
          except the repository URL. We save the owner, repo, commit SHA, file
          paths, and redacted finding snippets for 24-hour caching. Raw secret
          values are never stored. Free GitHub quota is shared; quota
          exhaustion shows as partial, never as a pass.
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
        <button type="submit" disabled={phase !== "idle"}>
          {phase === "fetching" ? "Fetching…" : phase === "analyzing" ? "Analyzing…" : "Run scan"}
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
          {scan.fetchedFileCount !== undefined && (
            <p>Analyzed {scan.fetchedFileCount} files, skipped {scan.skippedFileCount ?? 0}.</p>
          )}
          {analyzed && (
            <p>
              Findings: {counts.high} high, {counts.medium} medium, {counts.low} low, {counts.info} info.
            </p>
          )}
          {scan.errorMessage !== undefined && <p role="alert">{scan.errorMessage}</p>}
          {scan.rateLimitResetAt !== undefined && (
            <p>Quota resets at {new Date(scan.rateLimitResetAt).toLocaleTimeString()}.</p>
          )}
          {scan.coverageNote !== undefined && <p>{scan.coverageNote}</p>}
          {analyzed && plan.steps.length > 0 && (
            <div aria-label="Fix before you share">
              <h3>Fix before you share</h3>
              <ol>
                {plan.steps.map((step) => (
                  <li key={step.ruleId}>
                    <strong>{step.order}. {step.title}</strong>
                    <p>{step.why}</p>
                    <ul>
                      {step.checklist.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div aria-label="What was not checked">
            <p>
              <strong>Not checked:</strong> file contents beyond the 200-file /
              2MB caps, binary and generated files, dependency freshness,
              deps.dev metadata, live URL, and AI explanations.{" "}
              {scan.status === "partial"
                ? "This is a partial result. Unlisted files were not examined."
                : "Deterministic checks only."}
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
