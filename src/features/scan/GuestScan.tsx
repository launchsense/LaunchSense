import { useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { buildFixPlan } from "../../../shared/reports/fixPlan";
import type { PlanFinding } from "../../../shared/reports/fixPlan";
import ScanReport from "../report/ScanReport";

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function readRef(): string | null {
  try {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref !== null && /^[0-9a-f]{32}$/.test(ref)) return ref;
  } catch {
    return null;
  }
  return null;
}

export default function GuestScan() {
  const runScan = useAction(api.scans.actions.runScan);
  const analyzeScan = useAction(api.scans.analyze.analyzeScan);
  const checkLive = useAction(api.scans.livecheck.checkLive);
  const createShare = useAction(api.scans.sharing.createShare);
  const createPassport = useAction(api.scans.sharing.createPassport);
  const logEvent = useMutation(api.scans.queries.logEvent);
  const [repoUrl, setRepoUrl] = useState("");
  const [liveUrl, setLiveUrl] = useState("");
  const [mainAction, setMainAction] = useState("");
  const [scanId, setScanId] = useState<Id<"scans"> | null>(null);
  const [phase, setPhase] = useState<"idle" | "fetching" | "analyzing" | "live">("idle");
  const [submitError, setSubmitError] = useState("");
  const [wasCached, setWasCached] = useState(false);
  const [refShare] = useState<string | null>(() => {
    const ref = readRef();
    if (ref !== null) void logEvent({ kind: "referred_visit", refShareId: ref });
    return ref;
  });
  const [shareId, setShareId] = useState<string | null>(null);
  const [passportId, setPassportId] = useState<string | null>(null);
  const [shareError, setShareError] = useState("");
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
    setShareError("");
    setShareId(null);
    setPassportId(null);
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
      void logEvent({ kind: "scan_started", scanId: result.scanId, refShareId: refShare ?? undefined });
      if (refShare !== null) {
        void logEvent({ kind: "referred_scan_started", scanId: result.scanId, refShareId: refShare });
      }
      if (result.status === "failed") {
        setPhase("idle");
        return;
      }
      setPhase("analyzing");
      const analyzed = await analyzeScan({ scanId: result.scanId });
      void logEvent({
        kind: analyzed.status === "completed" ? "scan_completed" : "scan_partial",
        scanId: result.scanId,
      });
      if (liveUrl.trim().length > 0) {
        setPhase("live");
        await checkLive({
          scanId: result.scanId,
          url: liveUrl.trim(),
          mainAction: mainAction.trim().length > 0 ? mainAction.trim() : undefined,
        });
        void logEvent({ kind: "live_checked", scanId: result.scanId });
      }
      setPhase("idle");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Could not run the scan. Try again.");
      setPhase("idle");
    }
  }

  async function onShare() {
    if (scanId === null) return;
    setShareError("");
    try {
      const result = await createShare({ scanId });
      setShareId(result.shareId);
      void logEvent({ kind: "share_created", scanId, shareId: result.shareId });
    } catch (error) {
      setShareError(error instanceof Error ? error.message : "Could not create a share link.");
    }
  }

  async function onPassport() {
    if (scanId === null) return;
    setShareError("");
    try {
      const result = await createPassport({ scanId });
      setPassportId(result.passportId);
      void logEvent({ kind: "passport_created", scanId });
    } catch (error) {
      setShareError(error instanceof Error ? error.message : "Could not issue a passport.");
    }
  }

  const scan = scanState?.scan ?? resultsState?.scan ?? null;
  const status =
    scan?.status ??
    (phase === "fetching" ? "fetching" : phase === "analyzing" ? "analyzing" : phase === "live" ? "live" : null);
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
  const analyzed = resultsState?.analyzed === true;

  return (
    <section aria-label="Guest repository scan">
      <h2>Scan a public repository</h2>
      <div role="note" aria-label="Privacy note">
        <p>
          <strong>Before you run:</strong> we fetch the public file list and
          bounded file contents. Nothing on your machine leaves the browser
          except the form below. We save the owner, repo, commit SHA, file
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
        <label htmlFor="guest-live-url">Live site URL, optional</label>
        <input
          id="guest-live-url"
          name="liveUrl"
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://your-demo-site.com"
          value={liveUrl}
          onChange={(e) => setLiveUrl(e.target.value)}
        />
        <label htmlFor="guest-main-action">Main action in one sentence, optional</label>
        <input
          id="guest-main-action"
          name="mainAction"
          type="text"
          autoComplete="off"
          maxLength={140}
          placeholder="Visitors sign up for the waitlist"
          value={mainAction}
          onChange={(e) => setMainAction(e.target.value)}
        />
        <button type="submit" disabled={phase !== "idle"}>
          {phase === "fetching"
            ? "Fetching…"
            : phase === "analyzing"
              ? "Analyzing…"
              : phase === "live"
                ? "Checking site…"
                : "Run scan"}
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
          {scan.errorMessage !== undefined && <p role="alert">{scan.errorMessage}</p>}
          {scan.rateLimitResetAt !== undefined && (
            <p>Quota resets at {new Date(scan.rateLimitResetAt).toLocaleTimeString()}.</p>
          )}
          {scan.coverageNote !== undefined && <p>{scan.coverageNote}</p>}
          {analyzed && resultsState !== undefined && (
            <ScanReport
              findings={resultsState.findings}
              plan={plan}
              live={resultsState.live}
              onShare={() => void onShare()}
              onPassport={() => void onPassport()}
              shareId={shareId}
              passportId={passportId}
              shareError={shareError}
            />
          )}
          <div aria-label="What was not checked">
            <p>
              <strong>Not checked:</strong> file contents beyond the 200-file /
              2MB caps, binary and generated files, dependency freshness,
              deps.dev metadata, and AI explanations.{" "}
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
