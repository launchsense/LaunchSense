// One fix prompt for the top 3, ranked across repo findings and live site
// items. Deterministic and plain. The rest of the list stays visible below.

import type { Severity } from "../policies/severity";
import type { FixStep } from "./fixPlan";

export interface PromptFinding {
  ruleId: string;
  fingerprint?: string;
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
  ruleId: string;
  fingerprint?: string;
  severity: Severity;
  title: string;
  where: string;
  why: string;
  firstStep: string;
  count: number;
}

export interface TopPrompt {
  prompt: string;
  topCount: number;
  restCount: number;
  // Rule ids in the prompt and below it, so the UI can hide the duplicates.
  topRuleIds: string[];
  restRuleIds: string[];
}

const WEIGHT: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };

// One prompt slot per rule. Three findings from the same rule is one problem,
// not three, and a tracked-but-empty .env must not outrank a real CVE.
const RULE_RANK: Record<string, number> = {
  "secret.private-key": 0,
  "secret.github-token": 0,
  "secret.aws-key": 0,
  "secret.client-exposure": 0,
  "secret.credential-pattern": 1,
  "secret.tracked-env": 4,
  "secret.eval-use": 2,
  "secret.debugger-statement": 2,
  "deps.vulnerability": 0,
  "live.down": 0,
  "live.no-https": 1,
  "license.policy": 3,
};

function ruleRank(ruleId: string | null): number {
  if (ruleId === null) return 5;
  const rank = RULE_RANK[ruleId];
  return rank === undefined ? 3 : rank;
}

export function liveActionItems(
  live: LiveSummary | null,
  mainAction: string | null,
): RankedItem[] {
  if (live === null) return [];
  const where = live.finalUrl ?? live.url;
  const items: RankedItem[] = [];
  if (!live.reaches) {
    items.push({
      ruleId: "live.down",
      severity: "high",
      title: "Live site does not load",
      where,
      why: "A stranger hitting your live app sees nothing at all.",
      firstStep: "Open the URL in a fresh browser and fix hosting first.",
      count: 1,
    });
    return items;
  }
  if (!live.https) {
    items.push({
      ruleId: "live.no-https",
      severity: "high",
      title: "Live site does not use HTTPS",
      where,
      why: "Browsers warn visitors away from plain HTTP pages.",
      firstStep: "Serve the site over HTTPS before sharing the link.",
      count: 1,
    });
  }
  if (live.nonBlank === false) {
    items.push({
      ruleId: "live.blank",
      severity: "medium",
      title: "Live page reads as blank",
      where,
      why: "A fetch read found almost no text, so visitors may see an empty page.",
      firstStep: "Check what the page serves without JavaScript running.",
      count: 1,
    });
  }
  if (mainAction !== null && live.mainActionFound === false) {
    items.push({
      ruleId: "live.main-action",
      severity: "medium",
      title: "Main action hint missing from page",
      where,
      why: "The one action you named does not appear in the served page text.",
      firstStep: "Make the main action visible in plain page text.",
      count: 1,
    });
  }
  if (live.viewportMeta === false) {
    items.push({
      ruleId: "live.viewport",
      severity: "low",
      title: "No phone viewport tag",
      where,
      why: "Phones may render the page at desktop width without it.",
      firstStep: "Add a viewport meta tag to the page head.",
      count: 1,
    });
  }
  return items;
}

export function buildTopPrompt(
  findings: PromptFinding[],
  steps: FixStep[],
  live: RankedItem[],
  limit = 3,
  /**
   * Optional. Fingerprints in the order the decision lane (or the table) put them.
   * Used ONLY as a tiebreak inside one severity band, so the lane can never lift a
   * medium finding above a high one. When absent, the existing rule order applies
   * and nothing changes.
   */
  priorityOrder: string[] = [],
): TopPrompt {
  const repoItems: RankedItem[] = findings
    .filter((f) => f.severity !== "info")
    .map((f) => {
      const step = steps.find((s) => s.ruleId === f.ruleId);
      return {
        ruleId: f.ruleId,
        fingerprint: f.fingerprint,
        severity: f.severity,
        title: f.title,
        where: f.line > 0 ? `${f.path}:${f.line}` : f.path,
        why: f.why,
        firstStep: step?.checklist[0] ?? "Review the finding and fix it at the listed location.",
        count: 1,
      };
    });

  // One slot per rule. Repeated findings of the same rule collapse into one
  // item carrying a count, so the top 3 is three different problems.
  const byRule = new Map<string, RankedItem>();
  for (const item of [...live, ...repoItems]) {
    const existing = byRule.get(item.ruleId);
    if (existing === undefined) {
      byRule.set(item.ruleId, { ...item, count: item.count });
      continue;
    }
    const worst = WEIGHT[item.severity] < WEIGHT[existing.severity] ? item : existing;
    byRule.set(item.ruleId, {
      ...worst,
      count: existing.count + item.count,
      title: existing.title,
    });
  }

  const rankOf = new Map(priorityOrder.map((fp, i) => [fp, i]));

  const ranked = [...byRule.values()].sort((a, b) => {
    const bySeverity = WEIGHT[a.severity] - WEIGHT[b.severity];
    if (bySeverity !== 0) return bySeverity;
    // Inside one severity band, the stored order decides if it knows both items.
    // This is the only place the lane can influence what the reader sees first, and
    // it cannot cross a severity boundary.
    const ra = rankOf.get(a.fingerprint ?? "");
    const rb = rankOf.get(b.fingerprint ?? "");
    if (ra !== undefined && rb !== undefined && ra !== rb) return ra - rb;
    const byRuleRank = ruleRank(a.ruleId) - ruleRank(b.ruleId);
    if (byRuleRank !== 0) return byRuleRank;
    const byCount = b.count - a.count;
    if (byCount !== 0) return byCount;
    return a.ruleId < b.ruleId ? -1 : 1;
  });

  const top = ranked.slice(0, limit);
  const restCount = Math.max(0, ranked.length - top.length);
  if (top.length === 0) {
    return { prompt: "", topCount: 0, restCount, topRuleIds: [], restRuleIds: [] };
  }
  const lines = top.map((item, i) => {
    const many = item.count > 1 ? ` (${item.count} places)` : "";
    return `${i + 1}. ${item.title}${many} (${item.where}). ${item.why} First move: ${item.firstStep}`;
  });
  const prompt =
    `Before you share this, fix these ${top.length} first:\n` +
    lines.join("\n") +
    `\nAfter these, re-scan to confirm, then work through the rest of the list` +
    (restCount > 0 ? ` (${restCount} more).` : `.`);
  return {
    prompt,
    topCount: top.length,
    restCount,
    topRuleIds: top.map((t) => t.ruleId),
    restRuleIds: ranked.slice(limit).map((t) => t.ruleId),
  };
}
