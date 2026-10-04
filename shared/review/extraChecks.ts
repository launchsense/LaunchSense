// Local-tree checks that the website paste does not run.
// Unknown stays unknown. Nothing here says a file is safe to delete.

export interface TextFile {
  path: string;
  content: string;
}

export interface ExtraHit {
  ruleId: string;
  path: string;
  line: number;
  title: string;
  why: string;
}

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function functionBodies(file: TextFile): Array<{ name: string; line: number; hash: string }> {
  const lines = file.content.split("\n");
  const out: Array<{ name: string; line: number; hash: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const named = line.match(/function\s+([A-Za-z0-9_]+)/);
    const arrow = line.match(/(?:const|let)\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\(/);
    const name = named?.[1] ?? arrow?.[1];
    if (name === undefined) continue;
    const slice = lines.slice(i, i + 12).join("\n").replace(/\s+/g, " ").trim();
    if (slice.length < 80) continue;
    out.push({ name, line: i + 1, hash: fnv(slice) });
  }
  return out;
}

export function repeatedFunctions(files: TextFile[]): ExtraHit[] {
  const seen = new Map<string, { path: string; line: number }>();
  const hits: ExtraHit[] = [];
  for (const file of files) {
    for (const body of functionBodies(file)) {
      const prev = seen.get(body.hash);
      if (prev === undefined) {
        seen.set(body.hash, { path: file.path, line: body.line });
        continue;
      }
      hits.push({
        ruleId: "code.repeated-function",
        path: file.path,
        line: body.line,
        title: `Repeated function text near ${prev.path}:${prev.line}`,
        why: "These two spans share the same 12-line token hash. That does not mean they do the same job, and it does not mean a merge is safe.",
      });
    }
  }
  return hits.slice(0, 20);
}

export function deadCopies(files: TextFile[]): ExtraHit[] {
  const groups = new Map<string, TextFile[]>();
  for (const file of files) {
    if (file.content.length < 50) continue;
    const hash = fnv(file.content);
    const list = groups.get(hash) ?? [];
    list.push(file);
    groups.set(hash, list);
  }
  const dynamic = files.some((file) => file.content.includes("import("));
  const hits: ExtraHit[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const extra = group[1];
    if (extra === undefined) continue;
    if (dynamic) {
      hits.push({
        ruleId: "code.dead-copy",
        path: extra.path,
        line: 1,
        title: "A duplicate file is present. Reachability is unknown.",
        why: "A dynamic import() is in this read, so this copy is not marked unreachable.",
      });
      continue;
    }
    const base = extra.path.split("/").pop() ?? extra.path;
    const referenced = files.some((file) => file.path !== extra.path && file.content.includes(base));
    hits.push({
      ruleId: "code.dead-copy",
      path: extra.path,
      line: 1,
      title: referenced ? "Duplicate file is referenced by name" : "Duplicate file was not named by the files we read",
      why: referenced
        ? "The basename appears in another file. That is not proof it is the entry."
        : "No read file names this basename, and no dynamic import was seen. This is not proof it is safe to delete.",
    });
  }
  return hits.slice(0, 20);
}

export function networkHints(files: TextFile[]): ExtraHit[] {
  const hits: ExtraHit[] = [];
  const host = /https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/i;
  for (const file of files) {
    const match = file.content.match(host);
    const name = match?.[1];
    if (name === undefined) continue;
    const line = file.content.split("\n").findIndex((row) => row.includes(name)) + 1;
    hits.push({
      ruleId: "code.network-hint",
      path: file.path,
      line: line > 0 ? line : 1,
      title: `This file names ${name}`,
      why: "The review did not contact that host. A named host is not proof of telemetry.",
    });
    if (hits.length >= 10) break;
  }
  return hits;
}

export function modelCards(files: TextFile[]): ExtraHit[] {
  const hits: ExtraHit[] = [];
  for (const file of files) {
    const base = (file.path.split("/").pop() ?? "").toLowerCase();
    if (base !== "model-card.md" && base !== "dataset-card.md" && base !== "card.md") continue;
    const dir = file.path.split("/").slice(0, -1).join("/");
    const licensed = files.some((other) => {
      const otherBase = (other.path.split("/").pop() ?? "").toUpperCase();
      const otherDir = other.path.split("/").slice(0, -1).join("/");
      return otherDir === dir && (otherBase === "LICENSE" || otherBase.startsWith("LICENSE."));
    });
    hits.push({
      ruleId: "license.model-card",
      path: file.path,
      line: 1,
      title: licensed ? "A model or dataset card has a license file beside it" : "A model or dataset card has no license file beside it",
      why: "The card was read as text. Weights were not loaded. Signal, not legal advice.",
    });
  }
  return hits;
}

export function generatedMarkers(files: TextFile[]): ExtraHit[] {
  const hits: ExtraHit[] = [];
  for (const file of files) {
    if (file.content.length < 20_000) continue;
    const head = file.content.slice(0, 400).toLowerCase();
    if (!head.includes("generated") && !head.includes("@generated")) continue;
    hits.push({
      ruleId: "hygiene.generated-file",
      path: file.path,
      line: 1,
      title: "Large file carries a generated marker",
      why: "Size alone is not treated as generated. The marker is the evidence. This does not mean the file is safe to remove.",
    });
  }
  return hits.slice(0, 10);
}
