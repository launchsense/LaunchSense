import { useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { toShareCard } from "../../shared/reports/shareCard";

export default function SharePage({ shareId }: { shareId: string }) {
  const logEvent = useMutation(api.scans.queries.logEvent);
  const page = useQuery(api.scans.queries.getSharePage, { shareId });
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

  useEffect(() => {
    if (page !== undefined && page !== null) {
      void logEvent({ kind: "share_viewed", shareId });
    }
  }, [page, shareId, logEvent]);

  if (page === undefined) return <main><p>Loading shared scan…</p></main>;
  if (page === null || card === null) {
    return (
      <main>
        <h1>Share link not found</h1>
        <p>This link is wrong or was never created. Ask the sender for a fresh link.</p>
        <p><a href="/">Scan your own repo</a></p>
      </main>
    );
  }

  return (
    <main>
      <p className="eyebrow">LAUNCHSENSE · SHARED SCAN</p>
      <h1>
        {page.scan.owner}/{page.scan.repo}
      </h1>
      <p>
        Findings: {card.counts.high} high, {card.counts.medium} medium,{" "}
        {card.counts.low} low, {card.counts.info} info.
      </p>
      {card.steps.length > 0 && (
        <div aria-label="Shared fix list">
          <h2>Fix before sharing</h2>
          <ol>
            {card.steps.map((step) => (
              <li key={`${step.order}-${step.title}`}>
                <strong>{step.order}. {step.title}</strong>
                <p>{step.why}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
      <p>{page.scan.coverageNote}</p>
      <p>
        <a
          href={`/?ref=${shareId}`}
          onClick={() => {
            void logEvent({ kind: "share_cta_clicked", shareId });
          }}
        >
          Scan your own repo
        </a>
      </p>
    </main>
  );
}
