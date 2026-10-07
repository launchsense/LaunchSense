import { licenseView } from "../../../shared/reports/licenseView";
import type { ReportFinding } from "./ScanReport";
import { buildNotCheckedList } from "../../../shared/reports/scope";

// The licence-only render of one scan. It shows the licence rows of the same
// findings the full report holds, names how many it did not show, and says the
// same coverage line. License lines are signals, not legal advice.
export default function LicenseReport(props: {
  findings: ReportFinding[];
  coverageNote: string | undefined;
}) {
  const view = licenseView(props.findings);
  const notChecked = buildNotCheckedList({ aiConfigured: false, liveProvided: false });
  return (
    <div aria-label="Licence report" className="paste">
      <section aria-label="Licence findings">
        <p className="verdict-scope">{props.coverageNote ?? "A partial result is not a pass."}</p>
        <p>A partial result is not a pass. License lines are signals, not legal advice.</p>
        {view.coverage === "empty" && (
          <p>This scan returned no findings at all, so there is no licence row to show. The files it did not read are listed below.</p>
        )}
        {view.coverage === "no_licence_findings" && (
          <p>This scan found no licence rows in the files it read. Other rule families did flag rows, and those rows are not shown on this page. The files it did not read are listed below.</p>
        )}
        {view.declaration !== null && (
          <article aria-label="Licence declaration">
            <p><strong>{view.declaration.title}</strong></p>
            <p>{view.declaration.why}</p>
          </article>
        )}
        {view.inventoryLines.length > 0 && (
          <ul>
            {view.inventoryLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        {view.policy !== null && (
          <article aria-label="Licence policy">
            <p><strong>{view.policy.title}</strong></p>
            <p>{view.policy.why}</p>
          </article>
        )}
        {view.components.length > 0 && (
          <ol>
            {view.components.map((component) => (
              <li key={`${component.title}:${component.path}`}>
                <strong>{component.title}</strong>
                <p>{component.why}</p>
              </li>
            ))}
          </ol>
        )}
        {view.withheldCount > 0 && (
          <p>
            Your repo also has {view.withheldCount} finding{view.withheldCount === 1 ? "" : "s"} this page did not show. A partial result is not a pass.
          </p>
        )}
        <details className="not-checked">
          <summary>What was not checked</summary>
          <ul>
            {notChecked.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
      </section>
    </div>
  );
}
