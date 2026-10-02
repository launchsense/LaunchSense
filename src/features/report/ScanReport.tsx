import { useState } from "react";
import type { FixPlan } from "../../../shared/reports/fixPlan";

export interface ReportFinding {
  ruleId: string;
  fingerprint: string;
  path: string;
  line: number;
  severity: "high" | "medium" | "low" | "info";
  title: string;
  why: string;
  bucket: "actionable" | "info";
}

export interface LiveInfo {
  url: string;
  finalUrl?: string;
  https: boolean;
  reaches: boolean;
  httpStatus?: number;
  nonBlank?: boolean;
  mainActionFound?: boolean;
  viewportMeta?: boolean;
  hops: number;
  errorMessage?: string;
  checkedAt: number;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      document.body.removeChild(area);
      return true;
    } catch {
      return false;
    }
  }
}

export default function ScanReport(props: {
  findings: ReportFinding[];
  plan: FixPlan;
  live: LiveInfo | null;
  onShare: () => void;
  onPassport: () => void;
  shareId: string | null;
  passportId: string | null;
  shareError: string;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const counts = { high: 0, medium: 0, low: 0, info: 0 };
  for (const f of props.findings) counts[f.severity]++;

  function copyFinding(f: ReportFinding) {
    const text = `${f.title}\n${f.path}:${f.line}\n${f.why}`;
    void copyText(text).then((ok) => {
      setCopied(ok ? f.fingerprint : null);
      if (!ok) setCopied(null);
    });
  }

  const origin =
    typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div aria-label="Scan report">
      <h3>Report</h3>
      <p>
        Findings: {counts.high} high, {counts.medium} medium, {counts.low} low, {counts.info} info.
      </p>

      {props.plan.steps.length > 0 && (
        <div aria-label="Fix before you share">
          <h4>Fix before you share</h4>
          <ol>
            {props.plan.steps.map((step) => (
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

      <div aria-label="Findings">
        <h4>Findings</h4>
        {props.findings.length === 0 && <p>No findings. The checks found nothing to flag.</p>}
        {props.findings.map((f) => (
          <article key={f.fingerprint} aria-label={`Finding ${f.title}`}>
            <p>
              <strong>{f.title}</strong> · {f.severity}
            </p>
            <p>
              Where: {f.path}:{f.line}
            </p>
            <p>{f.why}</p>
            <button type="button" onClick={() => copyFinding(f)}>
              {copied === f.fingerprint ? "Copied" : "Copy finding"}
            </button>
          </article>
        ))}
      </div>

      {props.live !== null && (
        <div aria-label="Live site check">
          <h4>From the live site (separate from repo evidence)</h4>
          <ul>
            <li>Address: {props.live.finalUrl ?? props.live.url}</li>
            <li>HTTPS: {props.live.https ? "yes" : "no"}</li>
            <li>Reaches: {props.live.reaches ? "yes" : "no"}</li>
            {props.live.httpStatus !== undefined && <li>Status: HTTP {props.live.httpStatus}</li>}
            {props.live.nonBlank !== undefined && (
              <li>Page has content: {props.live.nonBlank ? "yes" : "no"}</li>
            )}
            {props.live.mainActionFound !== undefined && (
              <li>Main action hint found: {props.live.mainActionFound ? "yes" : "no"}</li>
            )}
            {props.live.viewportMeta !== undefined && (
              <li>Phone viewport tag: {props.live.viewportMeta ? "yes" : "no"}</li>
            )}
          </ul>
          <p>
            A fetch check cannot prove how the page looks on a real phone.
            It only reads the served HTML.
          </p>
          {props.live.errorMessage !== undefined && <p role="alert">{props.live.errorMessage}</p>}
        </div>
      )}

      <div aria-label="Share and passport">
        <h4>Share</h4>
        <button type="button" onClick={props.onShare}>Create share link</button>{" "}
        <button type="button" onClick={props.onPassport}>Issue passport</button>
        {props.shareError.length > 0 && <p role="alert">{props.shareError}</p>}
        {props.shareId !== null && (
          <p>
            Share link: {origin}/s/{props.shareId}
          </p>
        )}
        {props.passportId !== null && (
          <p>
            Passport link: {origin}/p/{props.passportId}
          </p>
        )}
      </div>
    </div>
  );
}
