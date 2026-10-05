// Regression harness for the 100-repo corpus.
//
// The wave passes each wrote their own per-repo table by hand, and every hand-written
// total is a chance to be wrong. This computes the numbers from the archived scan JSON
// instead, so a later pass can diff against a machine-made baseline instead of against
// prose.
//
// What it does:
//
//   counts(dir)          per repo: total, byRule, bySeverity, from the archived JSON
//   --write <out>        write that baseline
//   --compare <baseline> print every repo/rule count that moved, with the delta,
//                        and exit non-zero when a move was not named in the labels file
//   --labels <file>      the expected-move labels (defaults next to the baseline)
//
// What it does NOT do, on purpose:
//
//   - It never stores a path, a line, a snippet, or a value. A baseline of counts is
//     safe to keep in a working tree; a baseline of quoted literals is not.
//   - It never re-runs the scanner. It reads the JSON the runner already wrote, so it
//     is offline and deterministic and it costs nothing to run.
//   - It never calls a move "fine" on its own. A move is expected only when a human
//     named it in the labels file first. Everything else is a regression signal until
//     someone reads it and either fixes the rule or writes the label.
//
// Skip list: the per-pass comparison files are not corpora. `*.preA`, `*.preB`,
// `*.pre-fix`, `*.baseline-<commit>` and `baseline-<commit>.aggregate.json` are read
// by no rule of this script, so a comparison run can never be mistaken for a corpus.

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const WAVE_DIR = /^wave-\d+$/;

// Anything that is a comparison artefact rather than one scan of one repo.
const SKIP_FILE = /(\.preA|\.preB|\.pre-fix)\.json$/;
const SKIP_BASELINE = /\.baseline-[^/]*\.json$/;
const SKIP_AGGREGATE = /^baseline-.*\.aggregate\.json$/;

export function isCorpusFile(name) {
  if (!name.endsWith(".json")) return false;
  if (SKIP_FILE.test(name)) return false;
  if (SKIP_BASELINE.test(name)) return false;
  if (SKIP_AGGREGATE.test(name)) return false;
  return true;
}

function bump(map, key) {
  map[key] = (map[key] ?? 0) + 1;
}

// Counts every repo under `dir/wave-NN/*.json`.
//
// Throws on a file that is not scan JSON. A silent zero here would turn a corrupt
// corpus into a regression report full of invented removals, which is the exact class
// of false claim this harness exists to remove.
export function counts(dir) {
  const waves = readdirSync(dir)
    .filter((name) => WAVE_DIR.test(name))
    .sort();
  const repos = {};
  for (const wave of waves) {
    const waveDir = join(dir, wave);
    if (!statSync(waveDir).isDirectory()) continue;
    for (const name of readdirSync(waveDir).sort()) {
      if (!isCorpusFile(name)) continue;
      const slug = name.slice(0, -".json".length);
      const raw = readFileSync(join(waveDir, name), "utf8");
      let scan;
      try {
        scan = JSON.parse(raw);
      } catch (cause) {
        throw new Error(`${wave}/${name} is not JSON: ${cause.message}`);
      }
      const findings = scan?.findings;
      if (!Array.isArray(findings)) {
        throw new Error(`${wave}/${name} has no findings array, so it is not scan JSON`);
      }
      const byRule = {};
      const bySeverity = {};
      for (const finding of findings) {
        if (typeof finding?.ruleId !== "string" || typeof finding?.severity !== "string") {
          throw new Error(`${wave}/${name} has a finding with no ruleId or severity`);
        }
        bump(byRule, finding.ruleId);
        bump(bySeverity, finding.severity);
      }
      repos[slug] = { total: findings.length, byRule, bySeverity };
    }
  }
  return { corpusDir: dir, waves, repos };
}

export function summarise(baseline) {
  let repos = 0;
  let total = 0;
  const rules = new Set();
  const severities = new Set();
  for (const entry of Object.values(baseline.repos)) {
    repos += 1;
    total += entry.total;
    for (const rule of Object.keys(entry.byRule)) rules.add(rule);
    for (const sev of Object.keys(entry.bySeverity)) severities.add(sev);
  }
  return { repos, findings: total, rules: rules.size, severities: [...severities].sort() };
}

export function labelKey(repo, rule) {
  return `${repo}${rule}`;
}

// The labels file names the moves we expect and why. `up` means the rule count must
// have risen, `down` must have fallen, `any` accepts either direction. A move in the
// other direction from the label is still a regression: the label was a prediction and
// the run did not keep it.
export function readLabels(path) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  const moves = Array.isArray(parsed?.moves) ? parsed.moves : [];
  const index = new Map();
  for (const move of moves) {
    if (typeof move?.repo !== "string" || typeof move?.rule !== "string") {
      throw new Error(`labels file ${path} has a move with no repo or rule`);
    }
    const direction = move.direction ?? "any";
    if (!["up", "down", "any"].includes(direction)) {
      throw new Error(`labels file ${path} has direction ${direction}, expected up, down or any`);
    }
    index.set(labelKey(move.repo, move.rule), move);
  }
  return { path, note: parsed?.note ?? "", moves, index };
}

function matchesDirection(move, delta) {
  if (move.direction === "up") return delta > 0;
  if (move.direction === "down") return delta < 0;
  return delta !== 0;
}

// Diff two count() results. Every changed repo/rule pair is returned, and every one is
// marked expected or unexpected. Repo presence changes are moves too.
export function diff(baseline, current, labels) {
  const labelIndex = labels?.index ?? new Map();
  const rows = [];
  const repos = new Set([...Object.keys(baseline.repos), ...Object.keys(current.repos)]);
  for (const repo of [...repos].sort()) {
    const before = baseline.repos[repo];
    const after = current.repos[repo];
    if (!before) {
      rows.push({ repo, rule: "*", before: 0, after: after.total, delta: after.total, status: "repo-added" });
      continue;
    }
    if (!after) {
      rows.push({ repo, rule: "*", before: before.total, after: 0, delta: -before.total, status: "repo-removed" });
      continue;
    }
    const rules = new Set([...Object.keys(before.byRule), ...Object.keys(after.byRule)]);
    for (const rule of [...rules].sort()) {
      const from = before.byRule[rule] ?? 0;
      const to = after.byRule[rule] ?? 0;
      if (from === to) continue;
      const delta = to - from;
      const move = labelIndex.get(labelKey(repo, rule));
      const status = move && matchesDirection(move, delta) ? "expected" : "unexpected";
      rows.push({ repo, rule, before: from, after: to, delta, status, reason: move?.reason ?? "" });
    }
    if (before.total !== after.total) {
      const delta = after.total - before.total;
      const accounted = rows
        .filter((row) => row.repo === repo && row.status !== "repo-added" && row.status !== "repo-removed")
        .reduce((sum, row) => sum + row.delta, 0);
      if (accounted !== delta) {
        rows.push({ repo, rule: "<total>", before: before.total, after: after.total, delta, status: "unreconciled" });
      }
    }
  }
  return rows;
}

export function renderDiff(rows) {
  const lines = [];
  for (const row of rows) {
    const sign = row.delta > 0 ? `+${row.delta}` : `${row.delta}`;
    if (row.status === "expected") {
      lines.push(`  expected  ${row.repo} ${row.rule} ${row.before} -> ${row.after} (${sign})${row.reason ? `  ${row.reason}` : ""}`);
    } else if (row.status === "unexpected") {
      lines.push(`  REGRESSION ${row.repo} ${row.rule} ${row.before} -> ${row.after} (${sign})`);
    } else {
      lines.push(`  ${row.status}  ${row.repo} ${row.rule} ${row.before} -> ${row.after} (${sign})`);
    }
  }
  return lines.join("\n");
}

const USAGE = `corpus-regression: count the 100-repo corpus and diff it against a baseline.

  node scripts/corpus-regression.mjs --dir <corpusDir> --write <baseline.json>
  node scripts/corpus-regression.mjs --dir <corpusDir> --compare <baseline.json> [--labels <labels.json>]

Defaults: --dir state/run/corpus, --labels <corpusDir>/expected-moves.json.
--compare exits 1 when any repo or rule count moved without a label naming it.`;

export function main(argv, io = {}) {
  const out = io.stdout ?? ((line) => process.stdout.write(`${line}\n`));
  const err = io.stderr ?? ((line) => process.stderr.write(`${line}\n`));
  let dir = "state/run/corpus";
  let write = null;
  let compare = null;
  let labelsPath = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      out(USAGE);
      return 0;
    }
    if (arg === "--dir" || arg === "--write" || arg === "--compare" || arg === "--labels") {
      const value = argv[i + 1];
      if (value === undefined) {
        err(`${arg} needs a path`);
        return 2;
      }
      i += 1;
      if (arg === "--dir") dir = value;
      if (arg === "--write") write = value;
      if (arg === "--compare") compare = value;
      if (arg === "--labels") labelsPath = value;
      continue;
    }
    err(`unknown argument ${arg}\n${USAGE}`);
    return 2;
  }
  if (!write && !compare) {
    err(`nothing to do. Pass --write <baseline> or --compare <baseline>.\n${USAGE}`);
    return 2;
  }

  let current;
  try {
    current = counts(dir);
  } catch (cause) {
    err(cause.message);
    return 2;
  }
  const stats = summarise(current);

  if (write) {
    const labels = labelsPath ?? join(dir, "expected-moves.json");
    const payload = {
      tool: "scripts/corpus-regression.mjs",
      note: "Counts only. No path, line, snippet or value. Built from the archived scan JSON.",
      corpusDir: dir,
      waves: current.waves,
      repoCount: stats.repos,
      findingCount: stats.findings,
      ruleCount: stats.rules,
      severities: stats.severities,
      repos: current.repos,
    };
    writeFileSync(write, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    out(`wrote ${write}: ${stats.repos} repos, ${stats.findings} findings, ${stats.rules} rules`);
    out(`labels file for --compare: ${labels}`);
    return 0;
  }

  const baseline = JSON.parse(readFileSync(compare, "utf8"));
  if (!baseline?.repos || typeof baseline.repos !== "object") {
    err(`${compare} is not a baseline written by --write (no repos object)`);
    return 2;
  }
  const labelsFile = labelsPath ?? join(dir, "expected-moves.json");
  let labels = { path: labelsFile, moves: [], index: new Map(), missing: true };
  try {
    labels = { ...readLabels(labelsFile), missing: false };
  } catch {
    labels.missing = true;
  }

  const rows = diff(baseline, current, labels);
  const unexpected = rows.filter((row) => row.status !== "expected");
  const expected = rows.filter((row) => row.status === "expected");

  out(`baseline ${compare}: ${Object.keys(baseline.repos).length} repos, ${stats.repos} now, ${rows.length} moved rows`);
  out(`labels ${labelsFile}${labels.missing ? " (not found, so nothing is expected)" : ` (${labels.moves.length} named moves)`}`);
  if (expected.length) {
    out(`expected moves (${expected.length}):`);
    out(renderDiff(expected));
  }
  if (unexpected.length) {
    out(`unnamed moves (${unexpected.length}):`);
    out(renderDiff(unexpected));
    out(`${unexpected.length} move(s) were not named in ${labelsPath ?? labelsFile}`);
    return 1;
  }
  out("no unnamed moves. Every count matches the baseline.");
  return 0;
}

// The repo path has spaces in it, so the URL is built rather than stringed.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2));
}
