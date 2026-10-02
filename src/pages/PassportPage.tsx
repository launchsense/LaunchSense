import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { toShareCard } from "../../shared/reports/shareCard";

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

  return (
    <main>
      <p className="eyebrow">LAUNCHSENSE · PASSPORT</p>
      <h1>
        {page.scan.owner}/{page.scan.repo}
      </h1>
      <p>Checked scan passport. Counts only, no code and no secrets.</p>
      <p>
        Findings: {card.counts.high} high, {card.counts.medium} medium,{" "}
        {card.counts.low} low, {card.counts.info} info.
      </p>
      {card.steps.length > 0 && (
        <div aria-label="Passport fix list">
          <h2>Fixed before sharing</h2>
          <ol>
            {card.steps.map((step) => (
              <li key={`${step.order}-${step.title}`}>
                <strong>{step.order}. {step.title}</strong>
              </li>
            ))}
          </ol>
        </div>
      )}
      <p>
        <a href="/">Scan your own repo</a>
      </p>
    </main>
  );
}
