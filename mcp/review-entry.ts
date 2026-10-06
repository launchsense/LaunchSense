// Local review entry. Reads the working tree. Does not call api.github.com.
// Alpha does not check an API key. The auth slot is recorded and not enforced.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { decide } from "../convex/adapters/decision.ts";
import type { DecisionQuestion } from "../convex/adapters/decision.ts";
import { queryOsvBatch } from "../convex/adapters/osv.ts";
import { buildLocalReport } from "../shared/review/buildReport.ts";
import type { AdvisoryCoverage, NotChecked, ReviewFile, ReviewReport } from "../shared/review/buildReport.ts";
import { diagnosticPayload, diagnosticsAllowed } from "../shared/review/diagnostics.ts";
import { inventoryNpmLock } from "../shared/review/lockfile.ts";
import type { LockInventory, LockPackage } from "../shared/review/lockfile.ts";
import { findingsToAsk, laneCanReorder, questionIdFor, rankFromAnswers, rankState } from "../shared/reports/priority.ts";
import type { RankableFinding } from "../shared/reports/priority.ts";
import { buildFixPlan } from "../shared/reports/fixPlan.ts";
import { buildTopPrompt } from "../shared/reports/topPrompt.ts";
import type { PromptFinding } from "../shared/reports/topPrompt.ts";
import { lookupPackages, scorecardFact } from "../shared/review/registry.ts";
import { quoteForChoice, suggestionOptions } from "../shared/review/unknownQuote.ts";
import { parseManifests } from "../shared/analyzers/deps.ts";

// Vendored trees. Skipping them keeps thousands of third-party lines out of a
// review that is about this repo's own code, and every skip is disclosed in the
// not-checked list, so the report never hides the gap.
const VENDORED = new Set(["vendor", "third_party", "3rdparty", "deps"]);

const SKIP = new Set([
  "node_modules", "dist", "build", ".git", "coverage", ".next", "vendor", "target", "__pycache__", "third_party",
  // The other names third-party code arrives under. Same rule as vendor and
  // third_party: not read, and named in the not-checked list when skipped.
  ...VENDORED,
  // The agent working folder. It holds personal and planning material that is
  // nobody's to review, and a review of this repo must never walk into it. Skipped
  // by name, the same as any other unread directory, and disclosed when skipped.
  ".progress",
]);
const BINARY = new Set(["png", "jpg", "jpeg", "gif", "webp", "ico", "zip", "gz", "pdf", "woff", "woff2"]);
const OSV_CAP = 50;
const MAX_FILES = 5000;
const MAX_BYTES = 40_000_000;
const FILE_CAP = 100_000;

interface LocalConfig {
  tier?: string;
  diagnostics?: string;
  agreed?: boolean;
  authRequired?: boolean;
  harness?: string;
}

function argRoot(): string {
  const index = process.argv.indexOf("--root");
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value !== undefined && value.length > 0 ? value : process.cwd();
}

function readConfig(): LocalConfig {
  const home = process.env["HOME"];
  if (home === undefined) return {};
  try {
    const raw = readFileSync(join(home, ".config", "launchsense", "config.json"), "utf8");
    const data = JSON.parse(raw) as unknown;
    if (typeof data !== "object" || data === null) return {};
    const record = data as Record<string, unknown>;
    return {
      tier: typeof record["tier"] === "string" ? record["tier"] : undefined,
      diagnostics: typeof record["diagnostics"] === "string" ? record["diagnostics"] : undefined,
      agreed: record["agreed"] === true,
      authRequired: record["authRequired"] === true,
      harness: typeof record["harness"] === "string" ? record["harness"] : undefined,
    };
  } catch {
    return {};
  }
}

function walk(root: string): { files: ReviewFile[]; skipped: NotChecked[] } {
  const files: ReviewFile[] = [];
  const skipped: NotChecked[] = [];
  let bytes = 0;

  function visit(dir: string): void {
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      skipped.push({ scope: relative(root, dir) || dir, reason: "The directory could not be read." });
      return;
    }
    for (const name of names) {
      if (SKIP.has(name)) {
        const scope = relative(root, join(dir, name)).split("\\").join("/");
        if (VENDORED.has(name)) {
          skipped.push({ scope, reason: "Vendored tree was not read, so its notices were not checked." });
        } else if (name === ".progress") {
          skipped.push({ scope, reason: "Working notes folder. Not read, and its contents are not the repo owner's to review." });
        } else {
          skipped.push({ scope, reason: `Skipped directory ${name} was not read, so its notices were not checked.` });
        }
        continue;
      }
      const full = join(dir, name);
      let info;
      try {
        info = statSync(full);
      } catch {
        continue;
      }
      if (info.isDirectory()) {
        visit(full);
        continue;
      }
      if (!info.isFile()) continue;
      const path = relative(root, full).split("\\").join("/");
      const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
      if (BINARY.has(ext)) {
        skipped.push({ scope: path, reason: "Binary or media file." });
        continue;
      }
      if (files.length >= MAX_FILES || bytes >= MAX_BYTES) {
        skipped.push({ scope: path, reason: "Past the local read cap. Listed as not checked." });
        continue;
      }
      if (info.size > FILE_CAP && !name.endsWith("-lock.json") && name !== "package-lock.json") {
        skipped.push({ scope: path, reason: "Larger than 100KB. Not read." });
        continue;
      }
      try {
        const content = readFileSync(full, "utf8");
        if (content.includes("\u0000")) {
          skipped.push({ scope: path, reason: "Binary content." });
          continue;
        }
        files.push({ path, content });
        bytes += content.length;
      } catch {
        skipped.push({ scope: path, reason: "The file could not be read as text." });
      }
    }
  }

  visit(root);
  return { files, skipped };
}

function rankLockPackages(packages: LockPackage[]): LockPackage[] {
  return [...packages].sort((a, b) => {
    if (a.dev !== b.dev) return a.dev ? 1 : -1;
    if (a.depth !== b.depth) return a.depth === "direct" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Query the advisory service for the lockfile versions, or return null.
 *
 * Returning null covers three different situations and the report has to tell
 * them apart, because "we had a lockfile and did not check it" is a weaker
 * claim than "there was no lockfile to check". A caller that knows a lockfile
 * was in hand passes it in, so the not-checked line can say the exact number of
 * versions that went unchecked instead of a bare "not queried".
 */
async function queryLockAdvisories(inventory: LockInventory | null, offline: boolean): Promise<AdvisoryCoverage | null> {
  if (offline || inventory === null || !inventory.complete) return null;
  const unique = new Map<string, LockPackage>();
  for (const pkg of rankLockPackages(inventory.packages)) {
    const key = `${pkg.name}@${pkg.version}`;
    if (!unique.has(key)) unique.set(key, pkg);
  }
  const all = [...unique.values()];
  const queried = all.slice(0, OSV_CAP);
  const batch = await queryOsvBatch(queried.map((pkg) => ({ ecosystem: "npm", name: pkg.name, version: pkg.version })));
  const hits: AdvisoryCoverage["hits"] = [];
  queried.forEach((pkg, index) => {
    const vulns = batch.results[index] ?? [];
    for (const vuln of vulns) {
      hits.push({
        name: pkg.name,
        version: pkg.version,
        depth: pkg.depth,
        id: vuln.id,
        summary: vuln.summary,
        severity: vuln.severity,
      });
    }
  });
  return {
    hits,
    queried: queried.length,
    skipped: all.length - queried.length,
    timedOut: batch.timedOut,
  };
}

function directNames(files: ReviewFile[]): Set<string> {
  return new Set(parseManifests(files).deps.filter((dep) => dep.ecosystem === "npm").map((dep) => dep.name));
}

async function maybeRank(report: ReviewReport): Promise<void> {
  const rankable: RankableFinding[] = report.findings.map((item) => ({
    fingerprint: item.fingerprint,
    severity: item.severity,
    ruleId: item.ruleId,
    title: item.title,
  }));
  if (!laneCanReorder(rankable)) return;
  const questions: Record<string, DecisionQuestion> = {};
  for (const item of findingsToAsk(rankable)) {
    questions[questionIdFor(item.fingerprint)] = {
      type: "noul",
      instructions: `Does this need fixing before the builder shares their repo: ${item.title} (severity ${item.severity}).`,
      criteria: {
        true: "A stranger could be harmed or embarrassed if this ships as it is.",
        false: "Real, but not something to fix before sharing.",
      },
    };
  }
  const result = await decide(rankState(rankable), questions);
  if (!result.ok) return;
  const ranked = rankFromAnswers(rankable, result.answers, result.source);
  const promptsIn: PromptFinding[] = report.findings.map((item) => ({
    ruleId: item.ruleId,
    fingerprint: item.fingerprint,
    path: item.path,
    line: item.line,
    severity: item.severity,
    title: item.title,
    why: item.why,
  }));
  const top = buildTopPrompt(promptsIn, buildFixPlan(report.findings).steps, [], 3, ranked.order);
  report.orderSource = ranked.source;
  report.orderNote = ranked.note;
  report.lead = top.lead?.prompt ?? report.lead;
  report.prompts = top.prompts
    .filter((item) => item.ruleId !== top.lead?.ruleId)
    .slice(0, 2)
    .map((item) => item.prompt);
}

async function maybeQuote(report: ReviewReport): Promise<{ id: string; quote: string } | null> {
  const options = suggestionOptions(report);
  if (options === null) return null;
  const result = await decide({ unknown: true }, {
    unknownNext: {
      type: "choice",
      instructions: "Which next look should be quoted for this unknown gap? Do not name a license or a finding.",
      criteria: options,
    },
  });
  if (!result.ok || result.answers === null) return null;
  const answer = result.answers["unknownNext"];
  if (answer === undefined || answer.type !== "choice") return null;
  const quote = quoteForChoice(answer.choice, options);
  if (quote === null) return null;
  return { id: answer.choice, quote };
}

async function sendDiagnostics(report: ReviewReport, config: LocalConfig, started: number, suggestionId: string | null): Promise<boolean> {
  if (!diagnosticsAllowed(config)) return false;
  const counts: Record<string, number> = {};
  for (const item of report.findings) counts[item.ruleId] = (counts[item.ruleId] ?? 0) + 1;
  if (suggestionId !== null) counts[`suggest.${suggestionId}`] = 1;
  const payload = diagnosticPayload({
    stage: "alpha",
    tier: config.tier === "pro" ? "pro" : "alpha",
    harness: config.harness ?? "local",
    version: "alpha",
    durationMs: Date.now() - started,
    orderSource: report.orderSource,
    ruleCounts: counts,
  });
  if (payload === null) return false;
  const base = process.env["LAUNCHSENSE_API_URL"];
  if (base === undefined || base.length === 0) return false;
  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/api/mcp/usage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    if (response.status !== 200) return false;
    // The route reports whether the row was actually stored. A 200 with
    // stored:false means the counts were refused, and the review must not tell
    // the person they were sent when nothing was written.
    const body = (await response.json().catch(() => null)) as { stored?: unknown } | null;
    return body !== null && body["stored"] === true;
  } catch {
    return false;
  }
}

function render(report: ReviewReport, diagnosticsSent: boolean, quote: string | null): string {
  const lines = [
    "LaunchSense alpha review. The job runs on the files on this machine.",
    report.coverageNote,
    `Auth slot: present, not enforced. Alpha does not check a key.`,
    `Order: ${report.orderSource}. ${report.orderNote}`,
    "",
    report.lead,
    ...report.prompts.map((line) => line),
    "",
    report.lockNote,
  ];
  if (quote !== null) {
    lines.push(`Suggestion, quoted from the model: "${quote}" This quote is not a finding.`);
  }
  if (report.sbom !== null) {
    lines.push(`SBOM from ${report.sbom.tool}: ${report.sbom.components} components. Omissions: ${report.sbom.omissions.join("; ")}.`);
  }
  if (report.licenseDeclaration !== null) {
    const declaration = report.licenseDeclaration;
    lines.push(
      `Third-party licence declaration: ${declaration.components} components, ${declaration.unknown} unknown. ${declaration.note}`,
    );
    // The notice text is a file the builder can commit, so it goes to stdout in
    // full rather than behind a flag. The JSON output carries it as
    // licenseDeclaration.notice under the same name.
    lines.push(declaration.notice);
  }
  if (report.notChecked.length > 0) {
    lines.push("Not checked:");
    for (const item of report.notChecked.slice(0, 30)) lines.push(`- ${item.scope}: ${item.reason}`);
  }
  lines.push(diagnosticsSent ? "Usage counts were sent. No file text was included." : "Usage counts were not sent.");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const started = Date.now();
  const config = readConfig();
  const root = argRoot();
  const offline = process.env["LAUNCHSENSE_OFFLINE"] === "1";
  const { files, skipped } = walk(root);
  const lock = files.find((file) => file.path.endsWith("package-lock.json"));
  const inventory = lock === undefined ? null : inventoryNpmLock(lock.content, directNames(files));
  const registry = offline || inventory === null
    ? null
    : await lookupPackages(inventory.packages.filter((pkg) => !pkg.dev).slice(0, 15));
  const advisories = await queryLockAdvisories(inventory, offline);
  const report = buildLocalReport(files, skipped, registry, advisories, lock);
  // Offline with a complete lockfile in hand: the inventory says how many exact
  // versions were available to check and none of them were. Say so here, in the
  // caller's own words, rather than leaving the flat "not queried" line to imply
  // there was nothing to query. The line is added, never replaces, so the
  // report still carries its own not-checked entry for the same gap.
  if (offline && inventory !== null && inventory.complete && inventory.packages.length > 0) {
    report.lockNote =
      `${inventory.note} This run was offline, so no version in that lockfile was checked against the advisory service. ` +
      "A lockfile in hand that was never queried is unknown, not a pass.";
  }
  if (!offline) {
    const pkg = files.find((file) => file.path === "package.json");
    const repo = pkg?.content.match(/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/)?.[1];
    if (repo !== undefined) {
      const fact = await scorecardFact(`github.com/${repo}`);
      if (fact !== null) report.notChecked.push({ scope: "scorecard", reason: fact });
    }
    await maybeRank(report);
  }
  const quoted = offline ? null : await maybeQuote(report);
  const sent = await sendDiagnostics(report, config, started, quoted?.id ?? null);
  if (process.argv.includes("--json")) {
    // One JSON document per line, terminated. Piping this into jq or a file
    // needs the last line to have a terminator like any other line.
    process.stdout.write(`${JSON.stringify({ ...report, diagnosticsSent: sent, modelQuote: quoted?.quote ?? null })}\n`);
    return;
  }
  process.stdout.write(`${render(report, sent, quoted?.quote ?? null)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "The review failed.";
  process.stderr.write(message);
  process.exitCode = 1;
});
