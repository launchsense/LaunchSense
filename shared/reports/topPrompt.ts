// One fix prompt for the top 3, ranked across repo findings and live site
// items. Deterministic and plain. The rest of the list stays visible below.

import type { Severity } from "../policies/severity";
import type { FixStep } from "./fixPlan";

export interface PromptFinding {
  ruleId: string;
  path: string;
  line: number;
  severity: Severity;
  title: string;
  why: string;
}

export interface LiveSummary {
  reaches: boolean;
  https: boolean;
  nonBlank?: boolean;
  mainActionFound?: boolean;
  viewportMeta?: boolean;
  finalUrl?: string;
  url: string;
}

export interface RankedItem {
  severity: Severity;
  title: string;
  where: string;
  why: string;
  firstStep: string;
}

export interface TopPrompt {
  prompt: string;
  topCount: number;
  restCount: number;
}

const WEIGHT: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };

export function liveActionItems(
  live: LiveSummary | null,
  mainAction: string | null,
): RankedItem[] {
  if (live === null) return [];
  const where = live.finalUrl ?? live.url;
  const items: RankedItem[] = [];
  if (!live.reaches) {
    items.push({
      severity: "high",
      title: "Live site does not load",
      where,
      why: "A stranger hitting your live app sees nothing at all.",
      firstStep: "Open the URL in a fresh browser and fix hosting first.",
    });
    return items;
  }
  if (!live.https) {
    items.push({
      severity: "high",
      title: "Live site does not use HTTPS",
      where,
      why: "Browsers warn visitors away from plain HTTP pages.",
      firstStep: "Serve the site over HTTPS before sharing the link.",
    });
  }
  if (live.nonBlank === false) {
    items.push({
      severity: "medium",
      title: "Live page reads as blank",
      where,
      why: "A fetch read found almost no text, so visitors may see an empty page.",
      firstStep: "Check what the page serves without JavaScript running.",
    });
  }
  if (mainAction !== null && live.mainActionFound === false) {
    items.push({
      severity: "medium",
      title: "Main action hint missing from page",
      where,
      why: "The one action you named does not appear in the served page text.",
      firstStep: "Make the main action visible in plain page text.",
    });
  }
  if (live.viewportMeta === false) {
    items.push({
      severity: "low",
      title: "No phone viewport tag",
      where,
      why: "Phones may render the page at desktop width without it.",
      firstStep: "Add a viewport meta tag to the page head.",
    });
  }
  return items;
}

export function buildTopPrompt(
  findings: PromptFinding[],
  steps: FixStep[],
  live: RankedItem[],
  limit = 3,
): TopPrompt {
  const repoItems: RankedItem[] = findings
    .filter((f) => f.severity !== "info")
    .map((f) => {
      const step = steps.find((s) => s.ruleId === f.ruleId);
      return {
        severity: f.severity,
        title: f.title,
        where: f.line > 0 ? `${f.path}:${f.line}` : f.path,
        why: f.why,
        firstStep: step?.checklist[0] ?? "Review the finding and fix it at the listed location.",
      };
    });
  const ranked = [...live, ...repoItems].sort(
    (a, b) => WEIGHT[a.severity] - WEIGHT[b.severity],
  );
  const top = ranked.slice(0, limit);
  const restCount = Math.max(0, ranked.length - top.length);
  if (top.length === 0) {
    return { prompt: "", topCount: 0, restCount };
  }
  const lines = top.map(
    (item, i) =>
      `${i + 1}. ${item.title} (${item.where}). ${item.why} First move: ${item.firstStep}`,
  );
  const prompt =
    `Before your repo goes public, fix these ${top.length} first:\n` +
    lines.join("\n") +
    `\nAfter these, re-scan to confirm, then work through the rest of the list` +
    (restCount > 0 ? ` (${restCount} more).` : `.`);
  return { prompt, topCount: top.length, restCount };
}
