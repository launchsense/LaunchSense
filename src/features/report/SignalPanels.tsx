import { useMemo, useState } from "react";
import type { RepoDna, ReadinessBand } from "../../../shared/reports/repoDna";
import type { StandardMapping } from "../../../shared/reports/standards";
import type { Achievement, Mission } from "../../../shared/reports/missions";
import { buildNoAgentExport } from "../../../shared/reports/noAgentExport";
import type { FixPlan } from "../../../shared/reports/fixPlan";

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

function share(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && "share" in navigator) {
    return navigator
      .share({ title: "LaunchSense check", text })
      .catch(() => undefined);
  }
  return Promise.resolve();
}

export function DnaPanel(props: { dna: RepoDna; readiness: ReadinessBand }) {
  const max = Math.max(1, ...props.dna.directories.map((d) => d.files));
  return (
    <div aria-label="Repo DNA">
      <h4>Repo DNA</h4>
      <p>
        {props.dna.analyzedFiles} of {props.dna.totalPaths} paths were read.
      </p>
      <div aria-label="Folders">
        <h5>Folders</h5>
        <ul>
          {props.dna.directories.map((d) => (
            <li key={d.name}>
              {d.name} ({d.files})
              <span
                style={{ display: "block", height: "4px", background: "#174e39", width: `${Math.round((d.files / max) * 100)}%` }}
              />
            </li>
          ))}
        </ul>
      </div>
      <div aria-label="Languages">
        <h5>Languages</h5>
        <p>{props.dna.languages.map((l) => `${l.language} ${l.files}`).join(", ") || "none"}</p>
      </div>
      <div aria-label="Share readiness">
        <p className="panel-caption">
          Supporting signal: {props.readiness.label}. The verdict is in the result box
          at the top of the report.
        </p>
        <ul>
          {props.readiness.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <p>
          Read coverage: {Math.round(props.readiness.readCoverage * 100)}% ({props.readiness.filesRead} of{" "}
          {props.readiness.filesInTree} paths were read).
        </p>
        <p>
          Actionable share: {Math.round(props.readiness.actionableShare * 100)}% (
          {props.readiness.actionableFindings} of {props.readiness.totalFindings} findings need action).
        </p>
        <p>
          This is a signal from the files we could read. It is not a certification and it does not
          decide whether your product is good.
        </p>
      </div>
    </div>
  );
}

export function StandardsPanel(props: { mappings: StandardMapping[] }) {
  return (
    <div aria-label="Standards">
      <h4>Standards signals</h4>
      <p>Signals only. This is not a certification.</p>
      <ul>
        {props.mappings.map((m) => (
          <li key={`${m.version}:${m.requirementId}`}>
            <strong>
              {m.version} {m.requirementId} {m.title}
            </strong>
            <p>
              {m.coverage}. {m.status}
              {m.evidenceCount > 0 ? ` (${m.evidenceCount} evidence items)` : ""}
            </p>
            <p>{m.caveat}</p>
            <p>
              <a href={m.source}>Source</a>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MissionsPanel(props: {
  missions: Mission[];
  achievements: Achievement[];
  currentMissionId: string | null;
  done: number;
  total: number;
}) {
  return (
    <div aria-label="Missions">
      <h4>Missions</h4>
      <p>
        {props.done} of {props.total} done. One at a time, in order.
      </p>
      <ol>
        {props.missions.map((m) => (
          <li key={m.id} aria-current={m.id === props.currentMissionId ? "step" : undefined}>
            <strong>{m.title}</strong>
            {m.done ? ": done" : m.id === props.currentMissionId ? ": do this next" : ""}
            <p>{m.plain}</p>
            {m.blocked !== null && <p>{m.blocked}</p>}
          </li>
        ))}
      </ol>
      <h5>Achievements</h5>
      <ul>
        {props.achievements.map((a) => (
          <li key={a.id}>{a.earned ? "Earned: " : "Not yet: "}{a.title}</li>
        ))}
      </ul>
      <p>No points and no leaderboard. Completion is checked from the scan, not self declared.</p>
    </div>
  );
}

export function NoAgentPanel(props: {
  repoLabel: string;
  sha: string | undefined;
  findings: Array<{ title: string; path: string; line: number; severity: string; why: string }>;
  plan: FixPlan;
  notChecked: string[];
}) {
  const [copied, setCopied] = useState(false);
  const text = useMemo(
    () => buildNoAgentExport(props.repoLabel, props.sha, props.findings, props.plan, props.notChecked),
    [props],
  );
  return (
    <div aria-label="No coding agent handoff">
      <h4>Send this to a developer friend</h4>
      <p>Plain text checklist. No tooling needed to follow it.</p>
      <textarea readOnly value={text} rows={10} style={{ width: "100%" }} />
      <button
        type="button"
        onClick={() => {
          void copyText(text).then(setCopied);
        }}
      >
        {copied ? "Copied" : "Copy text"}
      </button>{" "}
      <button type="button" onClick={() => void share(text)}>
        Share
      </button>
    </div>
  );
}