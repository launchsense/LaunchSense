import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { toShareCard } from "../../shared/reports/shareCard";

function shortSha(sha: string | undefined): string {
  return sha === undefined ? "unknown" : sha.slice(0, 7);
}

export default function PassportPage({ passportId }: { passportId: string }) {
  const page = useQuery(api.scans.queries.getPassportPage, { passportId });
  const card =
    page === undefined || page === null
      ? null
      : toShareCard(
          page.findings.map((f) => ({
            ruleId: f.ruleId,
            path: "",
            severity: f.severity,
            title: f.title,
          })),
        );

  if (page === undefined) return <main><p>Loading passport…</p></main>;
  if (page === null || card === null) {
    return (
      <main>
        <h1>Passport not found</h1>
        <p>This link is wrong or was never issued.</p>
        <p><a href="/">Scan your own repo</a></p>
      </main>
    );
  }

  const openHigh = card.counts.high;
  const verdict =
    openHigh > 0
      ? "Open high severity findings remain"
      : card.counts.medium > 0
        ? "No high findings, review the medium ones"
        : "No high or medium findings at this commit";

  return (
    <main>
      <p className="eyebrow">LAUNCHSENSE · PASSPORT</p>
      <h1>
        {page.scan.owner}/{page.scan.repo}
      </h1>
      <p>
        Commit <strong>{shortSha(page.scan.sha)}</strong>
        {page.scan.analyzedAt !== undefined &&
          ` · checked ${new Date(page.scan.analyzedAt).toISOString().slice(0, 10)}`}
      </p>
      <p>Scan status: {page.scan.status}.</p>
      <p>
        <strong>{verdict}.</strong>
      </p>
      <p>
        Findings: {card.counts.high} high, {card.counts.medium} medium,{" "}
        {card.counts.low} low, {card.counts.info} info.
      </p>
      {card.steps.length > 0 && (
        <div aria-label="Still open">
          <h2>Still open, not fixed</h2>
          <p>
            These are open items at this commit. Nothing here claims to be fixed.
          </p>
          <ol>
            {card.steps.map((step) => (
              <li key={`${step.order}-${step.title}`}>
                <strong>{step.order}. {step.title}</strong>
              </li>
            ))}
          </ol>
        </div>
      )}
      {page.scan.coverageNote !== undefined && <p>{page.scan.coverageNote}</p>}
      <p>
        This page shows counts and titles only. No code, no file paths, no secret values.
      </p>
      <p>
        <a href="/">Scan your own repo</a>
      </p>
    </main>
  );
}