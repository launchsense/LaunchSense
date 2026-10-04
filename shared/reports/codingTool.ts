// Names a coding tool only when a path in the repo shows it. No guess.

export type CodingTool = "Cursor" | "Claude" | "Codex";

const ORDER: readonly CodingTool[] = ["Cursor", "Claude", "Codex"];

function baseName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

function mentions(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`) || path.includes(`/${dir}/`);
}

export function codingToolsIn(paths: readonly string[]): CodingTool[] {
  const found = new Set<CodingTool>();
  for (const path of paths) {
    const base = baseName(path);
    if (mentions(path, ".cursor") || base === ".cursorrules") found.add("Cursor");
    if (base === "CLAUDE.md" || mentions(path, ".claude")) found.add("Claude");
    if (mentions(path, ".codex")) found.add("Codex");
  }
  return ORDER.filter((tool) => found.has(tool));
}

export function toolCardSentence(tools: readonly CodingTool[]): string {
  if (tools.length === 0) {
    return "The rest of this work sits next to the code in your coding tool.";
  }
  if (tools.length === 1) {
    return `The rest of this work sits next to the code in ${tools[0]}.`;
  }
  const head = tools.slice(0, -1).join(", ");
  const last = tools[tools.length - 1];
  return `The rest of this work sits next to the code in ${head} and ${last}.`;
}
