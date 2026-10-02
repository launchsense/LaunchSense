// Repo DNA: a shape view of the project from fetched tree data only, plus an
// explainable Judge Readiness signal with evidence coverage. Signals, not a
// certification and not a score out of ten pretending to be objective.

import type { Severity } from "../policies/severity";

export interface DnaFile {
  path: string;
  type: string;
  size?: number;
}

export interface RepoDna {
  totalPaths: number;
  analyzedFiles: number;
  directories: Array<{ name: string; files: number }>;
  languages: Array<{ language: string; files: number }>;
  entryPoints: string[];
  hasReadme: boolean;
  hasTests: boolean;
  hasCI: boolean;
  hasLicense: boolean;
  usesEnvVars: boolean;
  agentInstructionFiles: string[];
  liveOk?: boolean | null;
}

export interface ReadinessBand {
  band: "ready" | "nearly" | "not-yet" | "unknown";
  label: string;
  reasons: string[];
  // Share of the repo we actually read. A real measure of coverage.
  readCoverage: number;
  filesRead: number;
  filesInTree: number;
  // Share of findings that are actionable. A measure of the mix, not coverage.
  actionableShare: number;
  actionableFindings: number;
  totalFindings: number;
}

export interface ReadinessInput {
  dna: RepoDna;
  findings: Array<{ severity: Severity; ruleId: string; bucket: string }>;
  liveReaches: boolean | null;
  partial: boolean;
}

const EXT_LANG: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  py: "Python",
  go: "Go",
  rb: "Ruby",
  rs: "Rust",
  java: "Java",
  cs: "C#",
  php: "PHP",
  md: "Markdown",
  json: "JSON",
  yml: "YAML",
  yaml: "YAML",
  toml: "TOML",
  css: "CSS",
  html: "HTML",
  sh: "Shell",
  sql: "SQL",
  tf: "Terraform",
};

function langOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "other";
  return EXT_LANG[base.slice(dot + 1).toLowerCase()] ?? "other";
}

export function buildRepoDna(
  treePaths: string[],
  analyzedPaths: string[],
  hygiene: {
    hasReadme: boolean;
    hasTests: boolean;
    hasCI: boolean;
    hasLicense: boolean;
    entryPoints: string[];
    agentFiles: string[];
    envUsages: string[];
  },
): RepoDna {
  const dirCounts = new Map<string, number>();
  const langCounts = new Map<string, number>();
  for (const path of analyzedPaths) {
    const slash = path.indexOf("/");
    const dir = slash === -1 ? "(root)" : path.slice(0, slash);
    dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
    const lang = langOf(path);
    langCounts.set(lang, (langCounts.get(lang) ?? 0) + 1);
  }
  return {
    totalPaths: treePaths.length,
    analyzedFiles: analyzedPaths.length,
    directories: [...dirCounts.entries()]
      .map(([name, files]) => ({ name, files }))
      .sort((a, b) => b.files - a.files)
      .slice(0, 10),
    languages: [...langCounts.entries()]
      .map(([language, files]) => ({ language, files }))
      .sort((a, b) => b.files - a.files)
      .slice(0, 10),
    entryPoints: hygiene.entryPoints.slice(0, 10),
    hasReadme: hygiene.hasReadme,
    hasTests: hygiene.hasTests,
    hasCI: hygiene.hasCI,
    hasLicense: hygiene.hasLicense,
    usesEnvVars: hygiene.envUsages.length > 0,
    agentInstructionFiles: hygiene.agentFiles.slice(0, 10),
  };
}

export function buildReadiness(input: ReadinessInput): ReadinessBand {
  const actionable = input.findings.filter((f) => f.bucket === "actionable");
  const high = actionable.filter((f) => f.severity === "high").length;
  const medium = actionable.filter((f) => f.severity === "medium").length;
  const total = input.findings.length;
  // Read coverage is what we actually looked at, not a restatement of severity.
  const filesInTree = Math.max(1, input.dna.totalPaths);
  const filesRead = Math.min(input.dna.analyzedFiles, filesInTree);
  const readCoverage = filesRead / filesInTree;
  const actionableShare = total === 0 ? 1 : actionable.length / total;
  const reasons: string[] = [];

  if (readCoverage < 0.5) {
    reasons.push(
      `Only ${Math.round(readCoverage * 100)}% of the repo was read, so most of it is unchecked.`,
    );
  }

  if (high > 0) reasons.push(`${high} high severity item(s) must be fixed first.`);
  if (medium > 0) reasons.push(`${medium} medium severity item(s) need review.`);
  if (!input.dna.hasReadme) reasons.push("No README, so nobody can run your project in one minute.");
  if (!input.dna.hasTests) reasons.push("No tests found, so fixes can silently break the demo.");
  if (!input.dna.hasLicense) reasons.push("No license terms found, so reuse is unclear.");
  if (input.liveReaches === false) reasons.push("The live site does not load.");
  if (input.partial) reasons.push("Some files were skipped, so the rest is unknown.");
  if (reasons.length === 0) reasons.push("Nothing blocking was found in the files we could read.");

  let band: ReadinessBand["band"];
  if (input.partial && high === 0 && medium === 0) band = "unknown";
  else if (high > 0 || input.liveReaches === false) band = "not-yet";
  else if (medium > 0 || !input.dna.hasReadme || !input.dna.hasTests) band = "nearly";
  else band = "ready";

  const label =
    band === "ready"
      ? "Looks ready to share"
      : band === "nearly"
        ? "Nearly ready"
        : band === "not-yet"
          ? "Not ready to share yet"
          : "Too much unchecked to say";

  return {
    band,
    label,
    reasons,
    readCoverage,
    filesRead,
    filesInTree,
    actionableShare,
    actionableFindings: actionable.length,
    totalFindings: total,
  };
}