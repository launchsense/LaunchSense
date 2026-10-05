import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { buildFixPlan } from "../../../shared/reports/fixPlan";
import type { PlanFinding } from "../../../shared/reports/fixPlan";
import ScanReport from "../report/ScanReport";
import { AuthPanel } from "../auth/AuthPanel";
import CompareView from "../report/CompareView";
import Stage5Panels from "../report/Stage5Panels";
import CapacityMeter from "../report/CapacityMeter";
import { ToolCard } from "../report/ToolCard";
import { toUserError } from "./userError";

// This project's own public repo, so a first-time visitor can see a real
// report without needing a repo of their own to hand.
const SELF_REPO_URL = "https://github.com/launchsense/LaunchSense";

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

// The share block renders these URLs after creation.
const origin = typeof window !== "undefined" ? window.location.origin : "";

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
  const { isAuthenticated } = useConvexAuth();
  const hasGitHubToken = useQuery(api.github.sessionToken.hasGitHubToken);
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
  const [refShare] = useState<string | null>(() => readRef());

  useEffect(() => {
    if (refShare !== null) {
      void logEvent({ kind: "referred_visit", refShareId: refShare });
    }
  }, [refShare, logEvent]);
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
  // A scan that hit the queue and was not admitted. Held so the visitor can
  // resume it in place rather than starting over at the back of the line.
  const [queuedScan, setQueuedScan] = useState<{
    scanId: Id<"scans">;
    position: number;
    limit: number;
  } | null>(null);
  const capacity = useQuery(api.scans.queries.getCapacity, {});
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
      setSubmitError(
        isAuthenticated
          ? "Paste a GitHub repository URL to start."
          : "Paste a public GitHub repository URL to start.",
      );
      return;
    }
    setQueuedScan(null);
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
          // Keep the queued scan so the visitor can resume it in place. The
          // queue row is keyed by this scanId, so calling analyzeScan again
          // with the same id keeps their position. Calling runScan instead
          // would mint a new scan and drop them to the back of the line.
          setQueuedScan({
            scanId: result.scanId,
            position: analyzed.queuePosition ?? 1,
            limit: analyzed.queueLimit ?? 6,
          });
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
      setSubmitError(toUserError(error, "Could not run the scan. Try again."));
      setPhase("idle");
    }
  }

  // Resumes the queued scan in place. The queue row is keyed by scanId, so
  // calling analyzeScan with the same id preserves the visitor's position.
  // This must never call runScan: that mints a new scan and a new queue row,
  // which is the bug this path exists to avoid.
  async function onResume() {
    if (queuedScan === null) return;
    setSubmitError("");
    setPhase("analyzing");
    try {
      let result = await analyzeScan({ scanId: queuedScan.scanId });
      for (let attempt = 0; attempt < 20 && result.status === "queued"; attempt++) {
        setQueueNote(
          `Still waiting. You are number ${result.queuePosition ?? queuedScan.position} in line. Holding your place.`,
        );
        await new Promise((r) => setTimeout(r, 3000));
        result = await analyzeScan({ scanId: queuedScan.scanId });
      }
      setQueueNote("");
      if (result.status === "queued") {
        setPhase("idle");
        return;
      }
      setScanId(queuedScan.scanId);
      setQueuedScan(null);
      setWasCached(false);
      setRescanRan(false);
      setComparePair(null);
      void logEvent({
        kind: result.status === "completed" ? "scan_completed" : "scan_partial",
        scanId: queuedScan.scanId,
      });
      setPhase("idle");
    } catch {
      // The scan row or its commit is gone, so there is nothing to resume.
      setQueuedScan(null);
      setPhase("idle");
      setSubmitError("That waiting scan is gone. Press Run a sample check to start a new one.");
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
      setShareError(toUserError(error, "Could not create a share link. Try again."));
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
      setSubmitError(toUserError(error, "Could not rescan. Try again."));
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
      setExplainNote(toUserError(error, "Could not explain. Try again."));
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
      setShareError(toUserError(error, "Could not issue a passport. Try again."));
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
  const quotaExhausted = capacity?.quota != null && capacity.quota.remaining <= 0;
  const repoMiss = scan?.errorKind === "not_found";
  const guestCapHit =
    scan !== null &&
    scan.signedIn !== true &&
    (quotaExhausted ||
      scan.errorKind === "rate_limited" ||
      scan.errorKind === "truncated" ||
      scan.truncated === true ||
      (scan.fetchedFileCount ?? 0) >= 200);
  const showSignIn = !isAuthenticated && (guestCapHit || repoMiss);
  const capDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = capDialog.current;
    if (node === null) return;
    if (!node.open) node.showModal();
    return () => {
      if (node.open) node.close();
    };
  }, [showSignIn]);

  return (
    <section aria-label="Guest repository scan">
      {isAuthenticated && hasGitHubToken === false && (
        <p role="status">Sign in again so this scan can use your GitHub token.</p>
      )}
      <form onSubmit={(e) => void onSubmit(e)}>
        <label htmlFor="guest-repo-url">{isAuthenticated ? "GitHub URL" : "Public GitHub URL"}</label>
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
        <button className="paste-bar" type="submit" disabled={phase !== "idle"}>
          {phase === "fetching"
            ? "Fetching files"
            : phase === "analyzing"
              ? "Analyzing files"
              : phase === "live"
                ? "Checking live site"
                : "Run a sample check"}
        </button>
        <div className="scan-secondary">
          <button className="ghost" type="button" onClick={() => setRepoUrl(SELF_REPO_URL)}>
            Load this repo
          </button>
          <button
            className="ghost"
            type="button"
            aria-expanded={showLive}
            onClick={() => setShowLive((v) => !v)}
          >
            {showLive ? "Hide the live app check" : "Also check my live app"}
          </button>
        </div>
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
      </form>
      <details>
        <summary>Privacy note</summary>
        <p>
          A guest read uses the shared GitHub quota and stops at 200 files and about 2MB. Signed in, the same check uses your GitHub token and reads up to 1,000 files and about 8MB, including one private repo you can already read. We do not store the file contents. We delete the token when you sign out. The Connect page shows how to call this same public read from your coding tool. A partial result is not a pass.
        </p>
      </details>
      {scan === null && <CapacityMeter waiting={0} running={0} quota={null} />}
      {queuedScan !== null && (
        <div aria-label="Waiting scan">
          <p>
            Servers are busy. Your scan is saved in waiting place{" "}
            {queuedScan.position} of {queuedScan.limit}. Press the button below and it
            picks up from that same place. Pressing Run a sample check instead starts a new scan
            at the back of the line.
          </p>
          <button type="button" disabled={phase !== "idle"} onClick={() => void onResume()}>
            {phase !== "idle" ? "Waiting..." : "Keep waiting in place"}
          </button>
        </div>
      )}
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
            {scan.sha !== undefined && <>, commit {shortSha(scan.sha)}</>}
            {scan.defaultBranch !== undefined && <>, branch {scan.defaultBranch}</>}
          </p>
          {scan.errorMessage !== undefined && <p role="alert">{scan.errorMessage}</p>}
          {scan.rateLimitResetAt !== undefined && (
            <p>Quota resets at {new Date(scan.rateLimitResetAt).toLocaleTimeString()}.</p>
          )}
          {analyzed && resultsState !== undefined && (
            <ScanReport
              findings={resultsState.findings}
              plan={plan}
              live={resultsState.live}
              mainAction={scan.mainAction ?? null}
              status={scan.status}
              fetchedFileCount={scan.fetchedFileCount ?? 0}
              skippedFileCount={scan.skippedFileCount ?? 0}
              fileCount={scan.fileCount}
              treeTruncated={scan.truncated === true}
              liveProvided={liveUrl.trim().length > 0}
              aiConfigured={explainNote.length > 0 && !/No AI provider/i.test(explainNote)}
              signedIn={scan.signedIn === true}
              priorityOrder={scan.priorityOrder ?? []}
              priorityNote={scan.priorityNote}
            />
          )}
          {analyzed && scanState !== undefined && (
            <ToolCard tools={scanState.codingTools} />
          )}
          {analyzed && (
            <div aria-label="Rescan" className="scan-secondary">
              <button className="ghost" type="button" disabled={phase !== "idle"} onClick={() => void onRescan()}>
                {phase !== "idle" ? "Working" : "Re-scan for new commits"}
              </button>
              <button className="ghost" type="button" disabled={phase !== "idle"} onClick={() => void onExplain()}>
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
          {analyzed && (
            <div aria-label="Share and passport" className="share-block">
              <h4>Share</h4>
              <div aria-label="Before you create a link">
                <p>Before you create a link, know this.</p>
                <p>Anyone with the link can open it. No sign in is needed.</p>
                <p>The link does not expire. There is no way to take it back.</p>
                <p>
                  It shows your repo name, the commit, finding counts, titles, and
                  short explanations.
                </p>
                <p>It never shows file paths, line numbers, code, or secret values.</p>
              </div>
              <div className="scan-secondary">
                <button className="ghost" type="button" onClick={() => void onShare()}>Create share link</button>
                <button className="ghost" type="button" onClick={() => void onPassport()}>Issue passport</button>
              </div>
              {shareError.length > 0 && <p role="alert">{shareError}</p>}
              {shareId !== null && (
                <p>
                  Share link: {origin}/s/{shareId}
                </p>
              )}
              {passportId !== null && (
                <p>
                  Passport link: {origin}/p/{passportId}
                </p>
              )}
              {shareId !== null && shareViewedAt === null && (
                <div aria-label="Confirm share works">
                  <p>
                    Open your share link in another tab or on your phone to check it
                    works.
                  </p>
                  <button type="button" onClick={() => {
                    setShareViewedAt(Date.now());
                    if (shareId !== null && scanId !== null) {
                      void logEvent({ kind: "share_viewed", scanId, shareId });
                    }
                  }}>
                    It opened fine
                  </button>
                </div>
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
              coverageNote={scan.coverageNote}
              signedIn={scan.signedIn === true}
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
      {scan !== null && <CapacityMeter waiting={0} running={0} quota={null} />}
      {showSignIn && (
        <dialog ref={capDialog} className="cap-dialog" aria-labelledby="limit-signin-title">
          <h2 id="limit-signin-title">Sign in to read more</h2>
          <p>This sample stopped at the guest cap, or the repo was not public.</p>
          <AuthPanel />
        </dialog>
      )}
    </section>
  );
}
