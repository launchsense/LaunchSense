import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { buildRepoDna, buildReadiness } from "../../../shared/reports/repoDna";
import { buildStandards } from "../../../shared/reports/standards";
import { buildMissions } from "../../../shared/reports/missions";
import { DnaPanel, MissionsPanel, NoAgentPanel, StandardsPanel } from "./SignalPanels";
import type { FixPlan } from "../../../shared/reports/fixPlan";

const NOT_CHECKED = [
  "File contents beyond the 200 file and 2MB caps",
  "Binary files and generated folders",
  "Dependency freshness and deps.dev metadata",
  "Rendered layout on a real phone (fetch only)",
  "Authentication and runtime behaviour",
];

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
}) {
  const [tab, setTab] = useState<"dna" | "standards" | "missions" | "handoff">("dna");
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
      }),
    [props.findings, props.live, dna.analyzedFiles],
  );

  const missions = useMemo(() => {
    const highSecrets = props.findings.filter(
      (f) => f.severity === "high" && f.ruleId.startsWith("secret."),
    ).length;
    const highOrMediumOpen = props.findings.filter(
      (f) => (f.severity === "high" || f.severity === "medium") && f.bucket === "actionable",
    ).length;
    return buildMissions({
      scanRan: true,
      analyzed: true,
      highSecrets,
      highOrMediumOpen,
      hasReadme: dna.hasReadme,
      hasTests: dna.hasTests,
      rescanRan: props.rescanRan,
      passportIssued: props.passportIssued,
      shareCreated: props.shareCreated,
      shareViewed: props.shareViewed,
      liveOk: props.live?.reaches ?? null,
    });
  }, [props.findings, props.rescanRan, props.passportIssued, props.shareCreated, props.shareViewed, props.live, dna]);

  return (
    <div aria-label="Signals and progress">
      <nav aria-label="Panels">
        <button type="button" onClick={() => setTab("dna")} aria-pressed={tab === "dna"}>
          Repo DNA
        </button>{" "}
        <button type="button" onClick={() => setTab("standards")} aria-pressed={tab === "standards"}>
          Standards
        </button>{" "}
        <button type="button" onClick={() => setTab("missions")} aria-pressed={tab === "missions"}>
          Missions
        </button>{" "}
        <button type="button" onClick={() => setTab("handoff")} aria-pressed={tab === "handoff"}>
          Handoff
        </button>
      </nav>
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
          notChecked={NOT_CHECKED}
        />
      )}
    </div>
  );
}