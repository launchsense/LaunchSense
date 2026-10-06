import type { ReportFinding } from "./ScanReport";
import type { FixPlan } from "../../../shared/reports/fixPlan";
import { AuthPanel } from "../auth/AuthPanel";

// The lite report: what an anonymous visitor sees after a scan. It is a real
// result with genuine content. Severity counts, the top finding with its fix
// direction, the coverage line, and a named count of what is held back. The
// full list, all fix prompts, and rescan history wait behind sign-in, and the
// page says exactly that. No timers, no obscured page, no dark pattern.
export default function LiteReport(props: {
  findings: ReportFinding[];
  plan: FixPlan;
  coverageNote: string | null | undefined;
  partial: boolean;
  scanId: string | null;
}) {
  const counts = { high: 0, medium: 0, low: 0, info: 0 };
  for (const finding of props.findings) {
    counts[finding.severity] += 1;
  }
  const top = props.plan.steps[0] ?? null;
  const withheld = Math.max(0, props.findings.length - (top === null ? 0 : 1));
  return (
    <div aria-label="Lite report">
      <p>
        Findings: {counts.high} high, {counts.medium} medium, {counts.low} low,{" "}
        {counts.info} info.
      </p>
      {top !== null && (
        <div aria-label="Start here">
          <p>
            <strong>Start here: {top.title}</strong>
          </p>
          <p>{top.why}</p>
        </div>
      )}
      {props.coverageNote !== null && props.coverageNote !== undefined && (
        <p>{props.coverageNote}</p>
      )}
      {props.partial && <p>A partial result is not a pass.</p>}
      {withheld > 0 && (
        <p>
          The full report lists {withheld} more finding{withheld === 1 ? "" : "s"}. Sign
          in with GitHub to read all of it, keep rescan history, and scan bigger repos.
        </p>
      )}
      <AuthPanel scanId={props.scanId} />
    </div>
  );
}
