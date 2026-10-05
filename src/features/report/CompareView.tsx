import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export interface CompareTransition {
  oldFingerprint?: string;
  newFingerprint?: string;
  ruleId: string;
  state: "fixed" | "still_broken" | "new" | "regressed" | "unknown";
  cause?: "code_change" | "advisory_update" | "analyzer_update" | "license_change";
  title: string;
  path: string;
  line: number;
  severity: "high" | "medium" | "low" | "info";
}

function shortSha(sha: string | undefined): string {
  if (sha === undefined) return "unknown";
  return sha.slice(0, 7);
}

const STATE_HEADING: Record<CompareTransition["state"], string> = {
  fixed: "Fixed",
  still_broken: "Still broken",
  new: "New",
  regressed: "Back again",
  unknown: "Unknown (not rechecked)",
};

const CAUSE_LINE: Record<string, string> = {
  code_change: "the code changed",
  advisory_update: "the advisory data changed",
  analyzer_update: "the checker itself changed",
  // A dependency's declared licence changed. It says so in its own words,
  // because "the code changed" is how a re-licensed package disappears from a
  // reader's attention.
  license_change: "a dependency's declared licence changed",
};

export default function CompareView(props: {
  fromSha: string | undefined;
  toSha: string | undefined;
  sameSha: boolean;
  transitions: CompareTransition[];
  accepted: string[];
  toScanId: Id<"scans">;
}) {
  const setDecision = useMutation(api.scans.queries.setDecision);
  const groups = groupByState(props.transitions);

  if (props.sameSha) {
    return (
      <div aria-label="Rescan compare">
        <h4>Rescan: no new commits</h4>
        <p>
          Both scans point at {shortSha(props.toSha)}. The report is unchanged.
        </p>
      </div>
    );
  }

  return (
    <div aria-label="Rescan compare">
      <h4>
        Rescan: {shortSha(props.fromSha)} to {shortSha(props.toSha)}
      </h4>
      {(Object.keys(STATE_HEADING) as Array<CompareTransition["state"]>).map((state) => {
        const items = groups[state] ?? [];
        if (items.length === 0) return null;
        return (
          <div key={state} aria-label={`Compare ${state}`}>
            <h5>
              {STATE_HEADING[state]} ({items.length})
            </h5>
            <ul>
              {items.map((t) => {
                const fp = t.newFingerprint ?? t.oldFingerprint ?? t.ruleId;
                const isAccepted = (t.newFingerprint !== undefined && props.accepted.includes(t.newFingerprint)) ||
                  (t.oldFingerprint !== undefined && props.accepted.includes(t.oldFingerprint));
                return (
                  <li key={fp}>
                    <strong>{t.title}</strong>, {t.severity}, {t.path}:{t.line}
                    {t.cause !== undefined && <span>, because {CAUSE_LINE[t.cause]}</span>}
                    {isAccepted && <span> (accepted risk)</span>}
                    {!isAccepted && (state === "still_broken" || state === "new" || state === "regressed") && (
                      <button
                        type="button"
                        onClick={() => {
                          void setDecision({ scanId: props.toScanId, fingerprint: fp });
                        }}
                      >
                        Accept risk
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      <p>Unknown never turns into fixed. Items without fresh coverage stay unknown.</p>
    </div>
  );
}

function groupByState(
  transitions: CompareTransition[],
): Record<CompareTransition["state"], CompareTransition[]> {
  const groups = {
    fixed: [],
    still_broken: [],
    new: [],
    regressed: [],
    unknown: [],
  } as Record<CompareTransition["state"], CompareTransition[]>;
  for (const t of transitions) groups[t.state].push(t);
  return groups;
}
