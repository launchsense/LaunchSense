// Deterministic repository hygiene signals. Signals, not verdicts: gaps are
// reported as info findings, inventory (languages, entry points) as evidence.

import { fnv1aHex } from "../redaction";

export interface FetchedFile {
  path: string;
  content: string;
  size: number;
}

export interface HygieneSignals {
  languages: Array<{ language: string; files: number }>;
  entryPoints: string[];
  hasReadme: boolean;
  readmeChars: number;
  hasTests: boolean;
  hasCI: boolean;
  agentFiles: string[];
  envUsages: string[];
  duplicateGroups: number;
  largeFiles: string[];
  configFiles: string[];
}

const EXTENSION_LANGUAGE: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  go: "Go",
  rs: "Rust",
  rb: "Ruby",
  java: "Java",
  php: "PHP",
  cs: "C#",
  swift: "Swift",
  kt: "Kotlin",
  md: "Markdown",
  json: "JSON",
  yml: "YAML",
  yaml: "YAML",
  toml: "TOML",
  css: "CSS",
  html: "HTML",
  sql: "SQL",
  sh: "Shell",
  tf: "Terraform",
  sol: "Solidity",
  vue: "Vue",
  svelte: "Svelte",
};

const ENTRY_CANDIDATES = [
  "src/main.tsx",
  "src/main.ts",
  "src/App.tsx",
  "src/App.ts",
  "src/index.ts",
  "src/index.js",
  "index.html",
  "convex/schema.ts",
  "package.json",
  "README.md",
];

const AGENT_FILENAMES = ["AGENTS.md", "CLAUDE.md", "CURSOR.md"];

function languageFor(path: string): string {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "no-extension";
  const ext = base.slice(dot + 1).toLowerCase();
  return EXTENSION_LANGUAGE[ext] ?? "other";
}

export function analyzeHygiene(
  treeBlobs: string[],
  files: FetchedFile[],
  skippedLarge: string[],
): HygieneSignals {
  const langCounts = new Map<string, number>();
  for (const path of treeBlobs) {
    const lang = languageFor(path);
    langCounts.set(lang, (langCounts.get(lang) ?? 0) + 1);
  }
  const languages = [...langCounts.entries()]
    .map(([language, count]) => ({ language, files: count }))
    .sort((a, b) => b.files - a.files)
    .slice(0, 12);

  const treeSet = new Set(treeBlobs);
  const entryPoints = ENTRY_CANDIDATES.filter((c) => treeSet.has(c));

  const readmePath = treeBlobs.find((p) => /^(readme)(\..+)?$/i.test(p.split("/").pop() ?? ""));
  const readmeFile = files.find((f) => f.path === readmePath);

  const hasTests =
    treeBlobs.some((p) => /(^|\/)__tests__\//.test(p) || /\.test\.[a-z]+$/i.test(p) || /\.spec\.[a-z]+$/i.test(p)) ||
    treeBlobs.some((p) => /vitest|jest|playwright|pytest|go\.test/i.test(p.split("/").pop() ?? ""));
  const hasCI = treeBlobs.some((p) => p.startsWith(".github/workflows/"));

  const agentFiles = treeBlobs.filter(
    (p) =>
      AGENT_FILENAMES.includes(p.split("/").pop() ?? "") ||
      p.startsWith(".agents/") ||
      p.startsWith(".codex/") ||
      p.startsWith(".claude/"),
  );

  const envUsages = files
    .filter((f) => /process\.env|import\.meta\.env|\bVITE_/.test(f.content))
    .map((f) => f.path)
    .slice(0, 20);

  const hashGroups = new Map<string, number>();
  for (const f of files) {
    if (f.content.length < 50) continue;
    const h = fnv1aHex(f.content);
    hashGroups.set(h, (hashGroups.get(h) ?? 0) + 1);
  }
  let duplicateGroups = 0;
  for (const count of hashGroups.values()) {
    if (count > 1) duplicateGroups++;
  }

  const configFiles = treeBlobs.filter((p) =>
    /(^|\/)(package\.json|tsconfig.*\.json|vite\.config\.[a-z]+|convex\/convex\.config\.ts|\.env\.example|Dockerfile|docker-compose\.ya?ml)$/.test(p),
  );

  return {
    languages,
    entryPoints,
    hasReadme: readmePath !== undefined,
    readmeChars: readmeFile?.content.length ?? 0,
    hasTests,
    hasCI,
    agentFiles: agentFiles.slice(0, 20),
    envUsages,
    duplicateGroups,
    largeFiles: skippedLarge.slice(0, 20),
    configFiles: configFiles.slice(0, 20),
  };
}
