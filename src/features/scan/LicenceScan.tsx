import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import LicenseReport from "../report/LicenseReport";
import { ToolCard } from "../report/ToolCard";
import { toUserError } from "../../../shared/userError";
import { useVisitorId } from "./useVisitorId";

const MCP_URL = "https://harmless-chihuahua-667.convex.site/mcp";

// The licence door. One tool, one result: it runs the same scan as the home
// page and renders only the licence rows, with a named count of what it did
// not show. No limiter, no email gate, no credential minted here.
export default function LicenceScan() {
  const runScan = useAction(api.scans.actions.runScan);
  const analyzeScan = useAction(api.scans.analyze.analyzeScan);
  const logEvent = useMutation(api.scans.queries.logEvent);
  const visitorId = useVisitorId();
  const [repoUrl, setRepoUrl] = useState("");
  const [scanId, setScanId] = useState<Id<"scans"> | null>(null);
  const [phase, setPhase] = useState<"idle" | "fetching" | "analyzing">("idle");
  const [submitError, setSubmitError] = useState("");
  const [queueNote, setQueueNote] = useState("");
  const [copied, setCopied] = useState(false);
  const scanState = useQuery(
    api.scans.queries.getScan,
    scanId === null ? "skip" : { scanId },
  );
  const resultsState = useQuery(
    api.scans.queries.getResults,
    scanId === null ? "skip" : { scanId },
  );

  useEffect(() => {
    void logEvent({ kind: "licence_route_viewed", visitorId });
  }, [logEvent, visitorId]);

  async function onCopyMcp() {
    try {
      await navigator.clipboard.writeText(`claude mcp add launchsense --transport http ${MCP_URL}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
    void logEvent({ kind: "licence_cta_clicked", scanId: scanId ?? undefined, visitorId });
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError("");
    if (repoUrl.trim().length === 0) {
      setSubmitError("Paste a public GitHub repository URL to start.");
      return;
    }
    setPhase("fetching");
    try {
      const result = await runScan({ repoUrl: repoUrl.trim() });
      setScanId(result.scanId);
      void logEvent({ kind: "scan_started", scanId: result.scanId, visitorId });
      if (result.status === "failed") {
        setPhase("idle");
        return;
      }
      setPhase("analyzing");
      let analyzed = await analyzeScan({ scanId: result.scanId });
      if (analyzed.status === "queued") {
        setQueueNote("Busy right now, and your place is held. The local check on your own machine has no line at all.");
        for (let attempt = 0; attempt < 20; attempt++) {
          await new Promise((r) => setTimeout(r, 3000));
          analyzed = await analyzeScan({ scanId: result.scanId });
          if (analyzed.status !== "queued") break;
        }
        setQueueNote("");
        if (analyzed.status === "queued") {
          setPhase("idle");
          return;
        }
      }
      void logEvent({
        kind: analyzed.status === "completed" ? "scan_completed" : "scan_partial",
        scanId: result.scanId,
        visitorId,
      });
      setPhase("idle");
    } catch (error) {
      setSubmitError(toUserError(error, "Could not run the scan. Try again."));
      setPhase("idle");
    }
  }

  return (
    <div>
      <form onSubmit={(event) => void onSubmit(event)}>
        <label htmlFor="licence-repo">Public GitHub repository URL</label>
        <input
          id="licence-repo"
          type="text"
          value={repoUrl}
          onChange={(event) => setRepoUrl(event.target.value)}
          placeholder="https://github.com/owner/repo"
        />
        <button type="submit" disabled={phase !== "idle"}>
          {phase !== "idle" ? "Working" : "Check the licences"}
        </button>
      </form>
      {submitError.length > 0 && <p role="alert">{submitError}</p>}
      {queueNote.length > 0 && <p role="status">{queueNote}</p>}
      {phase !== "idle" && <p role="status">Working</p>}
      {resultsState !== undefined && scanState !== undefined && (
        <LicenseReport
          findings={resultsState.findings}
          coverageNote={resultsState.scan?.coverageNote}
        />
      )}
      {scanState !== undefined && scanState !== null && <ToolCard tools={scanState.codingTools} />}
      <section aria-label="Keep the check">
        <h2 id="licence-mcp">Keep this check next to your code</h2>
        <p>The rest of this work sits next to the code in your coding tool.</p>
        <pre className="install-command">{`claude mcp add launchsense --transport http ${MCP_URL}`}</pre>
        <button type="button" onClick={() => void onCopyMcp()}>
          {copied ? "Copied" : "Copy the MCP line"}
        </button>
        <p>
          <a
            href="/connect"
            onClick={() => {
              void logEvent({ kind: "licence_cta_clicked", scanId: scanId ?? undefined, visitorId });
            }}
          >
            Connect your coding tool
          </a>
        </p>
      </section>
    </div>
  );
}
