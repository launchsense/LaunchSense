import { useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { buildFixPlan } from "../../../shared/reports/fixPlan";
import type { PlanFinding } from "../../../shared/reports/fixPlan";
import ScanReport from "../report/ScanReport";
import CompareView from "../report/CompareView";
import Stage5Panels from "../report/Stage5Panels";
import CapacityMeter from "../report/CapacityMeter";

// This project's own public repo, so a first-time visitor can see a real
// report without needing a repo of their own to hand.
const SELF_REPO_URL = "https://github.com/withkeshav/LaunchSense";

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
  const rescanScan = useAction(api.scans.rescan.rescanScan);
  const compareScans = useAction(api.scans.rescan.compareScans);
  const createShare = useAction(api.scans.sharing.createShare);
  const createPassport = useAction(api.scans.sharing.createPassport);
  const explainScan = useAction(api.scans.aiExplain.explainScan);
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
  const [comparePair, setComparePair] = useState<{ from: Id<"scans">; to: Id<"scans"> } | null>(null);
  const [rescanRan, setRescanRan] = useState(false);
  const [rescanNote, setRescanNote] = useState("");
  const [explainNote, setExplainNote] = useState("");
  const [explanations, setExplanations] = useState<
    Array<{ fingerprint: string; plain: string }>
  >([]);
  const [notActionable, setNotActionable] = useState<
    Array<{ fingerprint: string; reason: string }>
  >([]);
  // Set when the builder confirms their own share link opened. There is no
  // server round trip for someone else's view, so we ask instead of guessing.
  const [shareViewedAt, setShareViewedAt] = useState<number | null>(null);
  const [showLive, setShowLive] = useState(false);
  const [queueNote, setQueueNote] = useState("");
  const scanState = useQuery(
    api.scans.queries.getScan,
    scanId === null ? "skip" : { scanId },
  );
  const resultsState = useQuery(
    api.scans.queries.getResults,
    scanId === null ? "skip" : { scanId },
  );

  const compareState = useQuery(
    api.scans.queries.getCompare,
    comparePair === null ? "skip" : { fromScanId: comparePair.from, toScanId: comparePair.to },
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
      setRescanRan(false);
      setComparePair(null);
      setExplainNote("");
      void logEvent({ kind: "scan_started", scanId: result.scanId, refShareId: refShare ?? undefined });
      if (refShare !== null) {
        void logEvent({ kind: "referred_scan_started", scanId: result.scanId, refShareId: refShare });
      }
      if (result.status === "failed") {
        setPhase("idle");
        return;
      }
      setPhase("analyzing");
      // analyzeScan handles admission control internally: on sprint day many
      // people arrive at once, so a scan either gets a slot or is told its
      // place in the queue. All of that lives server side.
      let analyzed = await analyzeScan({ scanId: result.scanId });
      // Queued scans keep their place. We retry while the user waits here.
      if (analyzed.status === "queued") {
        setQueueNote(
          `Busy right now. You are number ${analyzed.queuePosition ?? 1} in line of ${analyzed.queueLimit ?? 6} slots. Holding your place.`,
        );
        for (let attempt = 0; attempt < 20; attempt++) {
          await new Promise((r) => setTimeout(r, 3000));
          analyzed = await analyzeScan({ scanId: result.scanId });
          if (analyzed.status !== "queued") break;
          setQueueNote(
            `Still waiting. You are number ${analyzed.queuePosition ?? 1} in line. Holding your place.`,
          );
        }
        setQueueNote("");
        if (analyzed.status === "queued") {
          setSubmitError(
            "Servers are busy. Your scan is saved and you can press Run scan again in a moment; you will not lose your place.",
          );
          setPhase("idle");
          return;
        }
      }
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

  async function onRescan() {
    if (scanId === null || phase !== "idle") return;
    setSubmitError("");
    setRescanNote("");
    setPhase("fetching");
    try {
      const base = scanId;
      const rescan = await rescanScan({ scanId: base });
      if (rescan.sameSha) {
        setRescanNote("No new commits. The report is unchanged.");
        setPhase("idle");
        setComparePair({ from: base, to: base });
        return;
      }
      setPhase("analyzing");
      await analyzeScan({ scanId: rescan.scanId });
      await compareScans({ fromScanId: base, toScanId: rescan.scanId });
      setScanId(rescan.scanId);
      setComparePair({ from: base, to: rescan.scanId });
      setRescanRan(true);
      setPhase("idle");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Could not rescan. Try again.");
      setPhase("idle");
    }
  }
  async function onExplain() {
    if (scanId === null || phase !== "idle") return;
    setExplainNote("");
    setExplanations([]);
    setNotActionable([]);
    setPhase("analyzing");
    try {
      const result = await explainScan({ scanId });
      setExplainNote(
        `${result.note} Explained ${result.explained} item(s).`,
      );
      setExplanations(result.explanations);
      setNotActionable(result.notActionable);
    } catch (error) {
      setExplainNote(error instanceof Error ? error.message : "Could not explain. Try again.");
    } finally {
      setPhase("idle");
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
  const progress =
    phase !== "idle"
      ? {
          done: scan?.progressFetched ?? 0,
          total: scan?.progressTotal ?? (phase === "fetching" ? 1 : 30),
        }
      : null;
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
      <h2>Check your public repo</h2>
      <div role="note" aria-label="Privacy note">
        <p>
          <strong>Public repos only.</strong> If your repo is private, flip it
          public first, scan it, fix what shows up, and only then share the
          link. Nothing on your machine leaves the browser except the form
          below. We fetch the public file list and one repository archive, read
          it in memory, plus the served page HTML if you add a live URL. We keep
          only the owner, repo, commit SHA, file paths, sizes, hashes, and
          redacted finding snippets. We store no copy of your code. Raw secret
          values are never stored. Free GitHub quota is shared; we show what is
          left, and quota exhaustion shows as partial, never as a pass.
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
        <p>
          <button type="button" onClick={() => setRepoUrl(SELF_REPO_URL)}>
            Try this repo
          </button>
        </p>
        <p>
          <button
            type="button"
            aria-expanded={showLive}
            onClick={() => setShowLive((v) => !v)}
          >
            {showLive ? "Hide the live app check" : "Also check my live app"}
          </button>
        </p>
        {showLive && (
          <>
            <label htmlFor="guest-live-url">Live app URL, optional but recommended</label>
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
          </>
        )}
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
      <CapacityMeter waiting={0} running={0} quota={null} />
      {submitError.length > 0 && <p role="alert">{submitError}</p>}
      {queueNote.length > 0 && <p role="status">{queueNote}</p>}
      {status !== null && <p role="status">Status: {status}{wasCached ? " (cached)" : ""}</p>}
      {progress !== null && (
        <div aria-label="Progress">
          <progress value={progress.done} max={Math.max(1, progress.total)} />
          <p role="status">
            {phase === "fetching"
              ? "Fetching the file list"
              : phase === "analyzing"
                ? "Reading files"
                : phase === "live"
                  ? "Checking your live app"
                  : "Working"}{" "}
            {progress.done} of {progress.total} files
          </p>
        </div>
      )}
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
              mainAction={scan.mainAction ?? null}
              onShare={() => void onShare()}
              onPassport={() => void onPassport()}
              shareId={shareId}
              passportId={passportId}
              shareError={shareError}
              shareViewed={shareViewedAt !== null}
              onConfirmShareViewed={() => {
                setShareViewedAt(Date.now());
                if (shareId !== null && scanId !== null) {
                  void logEvent({ kind: "share_viewed", scanId, shareId });
                }
              }}
            />
          )}
          {analyzed && (
            <div aria-label="Rescan">
              <button type="button" disabled={phase !== "idle"} onClick={() => void onRescan()}>
                {phase !== "idle" ? "Working…" : "Re-scan for new commits"}
              </button>{" "}
              <button type="button" disabled={phase !== "idle"} onClick={() => void onExplain()}>
                Explain in plain words
              </button>
              {rescanNote.length === 0 && comparePair === null && (
                <p>
                  Re-scanning is the part that matters. After you fix things and
                  push a commit, come back and press it: every finding is sorted
                  into fixed, still broken, new, back again, or unknown.
                </p>
              )}
              {rescanNote.length > 0 && <p role="status">{rescanNote}</p>}
              {explainNote.length > 0 && <p role="status">{explainNote}</p>}
              {explanations.length > 0 && (
                <ul aria-label="Plain-word explanations">
                  {explanations.slice(0, 8).map((item) => (
                    <li key={item.fingerprint}>{item.plain}</li>
                  ))}
                </ul>
              )}
              {explanations.length > 8 && (
                <p>{explanations.length - 8} more finding(s) are explained in the full report.</p>
              )}
              {notActionable.length > 0 && (
                <p>{notActionable.length} item(s) were reviewed and marked informational.</p>
              )}
            </div>
          )}
          {analyzed && resultsState !== undefined && (
            <Stage5Panels
              scanId={scanId as Id<"scans">}
              plan={plan}
              owner={scan.owner}
              repo={scan.repo}
              sha={scan.sha}
              rescanRan={rescanRan}
              passportIssued={passportId !== null}
              shareCreated={shareId !== null}
              shareViewed={shareId !== null && shareViewedAt !== null}
              findings={resultsState.findings}
              live={resultsState.live}
              partial={scan.status === "partial"}
            />
          )}
          {compareState !== undefined && compareState !== null && comparePair !== null && (
            <CompareView
              fromSha={compareState.from.sha}
              toSha={compareState.to.sha}
              sameSha={compareState.sameSha}
              transitions={compareState.transitions}
              accepted={compareState.accepted}
              toScanId={comparePair.to}
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
