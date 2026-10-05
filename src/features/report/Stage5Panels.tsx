import { useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { buildRepoDna, buildReadiness } from "../../../shared/reports/repoDna";
import { buildStandards } from "../../../shared/reports/standards";
import { buildMissions } from "../../../shared/reports/missions";
import {
  GUEST_MAX_BYTES,
  GUEST_MAX_FILES,
  SIGNED_MAX_BYTES,
  SIGNED_MAX_FILES,
} from "../../../shared/scanCaps";
import { DnaPanel, MissionsPanel, NoAgentPanel, StandardsPanel } from "./SignalPanels";
import type { FixPlan } from "../../../shared/reports/fixPlan";

type TabId = "dna" | "standards" | "missions" | "handoff";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "dna", label: "Repo DNA" },
  { id: "standards", label: "Standards" },
  { id: "missions", label: "Missions" },
  { id: "handoff", label: "Handoff" },
];

// The read caps this scan actually used, so the handoff list cannot claim the
// guest cap on a signed-in scan (the same defect U10 fixed in the verdict).
function notCheckedList(signedIn: boolean): string[] {
  const maxFiles = signedIn ? SIGNED_MAX_FILES : GUEST_MAX_FILES;
  const maxBytes = signedIn ? SIGNED_MAX_BYTES : GUEST_MAX_BYTES;
  return [
    `File contents beyond the ${maxFiles.toLocaleString("en-US")} file and ${Math.round(maxBytes / 1_000_000)}MB caps`,
    "Binary files and generated folders",
    "Dependency freshness and deps.dev metadata",
    "Rendered layout on a real phone (fetch only)",
    "Authentication and runtime behaviour",
  ];
}

export default function Stage5Panels(props: {
  scanId: Id<"scans">;
  plan: FixPlan;
  owner: string;
  repo: string;
  sha: string | undefined;
  rescanRan: boolean;
  passportIssued: boolean;
  shareCreated: boolean;
  shareViewed: boolean;
  findings: Array<{
    ruleId: string;
    fingerprint: string;
    path: string;
    line: number;
    severity: "high" | "medium" | "low" | "info";
    title: string;
    why: string;
    bucket: "actionable" | "info";
  }>;
  live: { reaches: boolean } | null;
  partial: boolean;
  coverageNote?: string | null;
  signedIn?: boolean;
}) {
  const [tab, setTab] = useState<TabId>("dna");
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({
    dna: null,
    standards: null,
    missions: null,
    handoff: null,
  });
  const contents = useQuery(api.scans.queries.getAnalysisFacts, { scanId: props.scanId });

  const hygiene = useMemo(
    () => ({
      hasReadme: contents?.hasReadme ?? false,
      hasTests: contents?.hasTests ?? false,
      hasCI: contents?.hasCI ?? false,
      hasLicense: contents?.hasLicense ?? false,
      entryPoints: contents?.entryPoints ?? [],
      agentFiles: contents?.agentFiles ?? [],
      envUsages: contents?.envUsages ?? [],
    }),
    [contents],
  );

  const dna = useMemo(
    () => buildRepoDna(contents?.treePaths ?? [], contents?.analyzedPaths ?? [], hygiene),
    [contents, hygiene],
  );

  const readiness = useMemo(
    () =>
      buildReadiness({
        dna,
        findings: props.findings.map((f) => ({
          severity: f.severity,
          ruleId: f.ruleId,
          bucket: f.bucket,
        })),
        liveReaches: props.live?.reaches ?? null,
        partial: props.partial,
      }),
    [dna, props.findings, props.live, props.partial],
  );

  const standards = useMemo(
    () =>
      buildStandards({
        findings: props.findings.map((f) => ({ ruleId: f.ruleId, severity: f.severity })),
        analyzedFiles: dna.analyzedFiles,
        liveChecked: props.live !== null,
        coverageNote: props.coverageNote,
      }),
    [props.findings, props.live, props.coverageNote, dna.analyzedFiles],
  );

  const missions = useMemo(() => {
    const highSecrets = props.findings.filter(
      (f) => f.severity === "high" && f.ruleId.startsWith("secret."),
    ).length;
    const highOpen = props.findings.filter(
      (f) => f.severity === "high" && f.bucket === "actionable",
    ).length;
    return buildMissions({
      scanRan: true,
      analyzed: true,
      highSecrets,
      highOpen,
      hasReadme: dna.hasReadme,
      hasTests: dna.hasTests,
      rescanRan: props.rescanRan,
      passportIssued: props.passportIssued,
      shareCreated: props.shareCreated,
      shareViewed: props.shareViewed,
      liveOk: props.live?.reaches ?? null,
    });
  }, [props.findings, props.rescanRan, props.passportIssued, props.shareCreated, props.shareViewed, props.live, dna]);

  // A tablist needs arrow key navigation and a roving tabindex, so keyboard
  // users can reach every panel without tabbing through the other three.
  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = TABS.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    if (next === null) return;
    event.preventDefault();
    const id = TABS[next].id;
    setTab(id);
    tabRefs.current[id]?.focus();
  }

  return (
    <div aria-label="Signals and progress">
      <div className="tabs" role="tablist" aria-label="Signals and progress">
        {TABS.map((entry, index) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`tab-${entry.id}`}
            aria-selected={tab === entry.id}
            aria-controls={`panel-${entry.id}`}
            tabIndex={tab === entry.id ? 0 : -1}
            ref={(node) => {
              tabRefs.current[entry.id] = node;
            }}
            onClick={() => setTab(entry.id)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        tabIndex={0}
      >
      {tab === "dna" && <DnaPanel dna={dna} readiness={readiness} />}
      {tab === "standards" && <StandardsPanel mappings={standards} />}
      {tab === "missions" && (
        <MissionsPanel
          missions={missions.missions}
          achievements={missions.achievements}
          currentMissionId={missions.currentMissionId}
          done={missions.progress.done}
          total={missions.progress.total}
        />
      )}
      {tab === "handoff" && (
        <NoAgentPanel
          repoLabel={`${props.owner}/${props.repo}`}
          sha={props.sha}
          findings={props.findings}
          plan={props.plan}
          notChecked={notCheckedList(props.signedIn === true)}
        />
      )}
      </div>
    </div>
  );
}