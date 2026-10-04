import { useMemo, useState } from "react";
import type { FixPlan } from "../../../shared/reports/fixPlan";
import { buildTopPrompt, liveActionItems } from "../../../shared/reports/topPrompt.ts";
import { buildVerdict, buildNotCheckedList, SCOPE_LABEL } from "../../../shared/reports/scope";
import type { ScanStatus } from "../../../shared/reports/scope";

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
  mainAction: string | null;
  // Scope inputs. The verdict is meaningless without them, so they are props
  // rather than something this component looks up later.
  status: ScanStatus;
  fetchedFileCount: number;
  skippedFileCount: number;
  fileCount: number | undefined;
  treeTruncated: boolean;
  liveProvided: boolean;
  aiConfigured: boolean;
  /** Fingerprints in stored priority order. Empty when the lane never ran. */
  priorityOrder?: string[];
  /** Which rung produced the order, for the plain-words line under the report. */
  priorityNote?: string;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [promptCopied, setPromptCopied] = useState<string | null>(null);
  const counts = { high: 0, medium: 0, low: 0, info: 0 };
  for (const f of props.findings) counts[f.severity]++;

  const top = useMemo(
    () =>
      buildTopPrompt(
        props.findings.map((f) => ({
          ruleId: f.ruleId,
          fingerprint: f.fingerprint,
          path: f.path,
          line: f.line,
          severity: f.severity,
          title: f.title,
          why: f.why,
        })),
        props.plan.steps,
        liveActionItems(props.live, props.mainAction),
        3,
        props.priorityOrder,
      ),
    [props.findings, props.plan, props.live, props.mainAction, props.priorityOrder],
  );

  // The rest of the list excludes what the top 3 already covers, so the same
  // item never appears twice on one screen.
  const restSteps = useMemo(
    () =>
      top.topRuleIds.length === 0
        ? props.plan.steps
        : props.plan.steps.filter((s) => !top.topRuleIds.includes(s.ruleId)),
    [props.plan.steps, top.topRuleIds],
  );

  function copyFinding(f: ReportFinding) {
    const text = `${f.title}\n${f.path}:${f.line}\n${f.why}`;
    void copyText(text).then((ok) => {
      setCopied(ok ? f.fingerprint : null);
    });
  }

  function copyPrompt(id: string, text: string) {
    void copyText(text).then((ok) => {
      setPromptCopied(ok ? id : null);
    });
  }

  // Verdict and scope are computed together and rendered together. This is the
  // whole point of the change: a reader cannot reach the headline without the
  // line that says how much was not read.
  const verdict = useMemo(
    () =>
      buildVerdict({
        status: props.status,
        fetched: props.fetchedFileCount,
        skipped: props.skippedFileCount,
        total: props.fileCount,
        findingCount: props.findings.length,
        truncatedTree: props.treeTruncated,
      }),
    [
      props.status,
      props.fetchedFileCount,
      props.skippedFileCount,
      props.fileCount,
      props.treeTruncated,
      props.findings.length,
    ],
  );
  const notChecked = useMemo(
    () => buildNotCheckedList({ aiConfigured: props.aiConfigured, liveProvided: props.liveProvided }),
    [props.aiConfigured, props.liveProvided],
  );

  return (
    <div aria-label="Scan report">
      <section aria-label="Result and scope" className="verdict">
        <h3>{verdict.headline}</h3>
        <p className="verdict-scope">{verdict.scope}</p>
        <p className="verdict-counts">
          Findings: {counts.high} high, {counts.medium} medium, {counts.low} low, {counts.info} info.
        </p>
        <ul className="verdict-stages">
          {verdict.stages.map((stage) => (
            <li key={stage.label}>
              <strong>{stage.label}:</strong> {SCOPE_LABEL[stage.state]}. {stage.detail}
            </li>
          ))}
        </ul>
        <details className="not-checked">
          <summary>What was not checked</summary>
          <ul>
            {notChecked.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
      </section>

      {top.lead !== null && (
        <div aria-label="One thing to look at">
          <h4>The one thing to look at</h4>
          <p>This is the item a first check usually misses.</p>
          <p style={{ whiteSpace: "pre-line" }}>{top.lead.prompt}</p>
          <button type="button" onClick={() => copyPrompt("lead", top.lead?.prompt ?? "")}>
            {promptCopied === "lead" ? "Copied" : "Copy this prompt"}
          </button>
        </div>
      )}

      {top.prompts.length > 0 && (
        <div aria-label="Three actions">
          <h4>
            {top.prompts.length === 1
              ? "One thing to fix first"
              : top.prompts.length === 2
                ? "Two things to fix first"
                : "Three things to fix first"}
          </h4>
          <ol>
            {top.prompts.map((item, index) => (
              <li key={item.ruleId}>
                <p style={{ whiteSpace: "pre-line" }}>{item.prompt}</p>
                <button type="button" onClick={() => copyPrompt(item.ruleId, item.prompt)}>
                  {promptCopied === item.ruleId ? "Copied" : `Copy prompt ${index + 1}`}
                </button>
              </li>
            ))}
          </ol>
          {props.priorityNote !== undefined && props.priorityNote.length > 0 && (
            <p className="priority-note">{props.priorityNote}</p>
          )}
        </div>
      )}

      {top.prompts.length === 0 && props.priorityNote !== undefined && props.priorityNote.length > 0 && (
        <p className="priority-note">{props.priorityNote}</p>
      )}

      <p className="priority-note">
        Checks decide the findings. A model may only reorder items that share a severity. It does not add one, and it does not drop one.
      </p>

      {restSteps.length > 0 && (
        <div aria-label="Fix before you share">
          <h4>The rest of the fix list</h4>
          <p>
            {top.topRuleIds.length > 0
              ? "These are the items after the prompts above."
              : "Everything the check found."}
          </p>
          <ol>
            {restSteps.map((step) => (
              <li key={step.ruleId}>
                <strong>{step.title}</strong>
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

      {props.live !== null && (
        <div aria-label="Live site check">
          <h4>What a stranger hits on your live app</h4>
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

      <div aria-label="Findings">
        <h4>Findings</h4>
        {props.findings.length === 0 && (
          <p>
            Nothing was flagged in the files we read. Not checked files are not passes. The
            full list of what was not checked sits in the result box above.
          </p>
        )}
        {props.findings.map((f) => (
          <article key={f.fingerprint} aria-label={`Finding ${f.title}`}>
            <p>
              <strong>{f.title}</strong>,{" "}
              <span className={f.severity === "high" ? "severity-high" : undefined}>{f.severity}</span>
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

      </div>
  );
}
