// Writes the GDPR Article 30 processing activities register.
//
//   node scripts/processing-register.mjs              prints to stdout
//   node scripts/processing-register.mjs --out X.md   writes X.md and prints a summary
//
// The register is generated from shared/consent/register.ts, whose facts point at
// convex/schema.ts, the retention constants, and the purge calls. tests/consent-
// standards-checks.mjs reads those files and fails when a table, a window, or a
// purge named in the register is not in the code.
//
// Deterministic: same code in, same file out. No clock, so a committed register
// either matches the code or the diff shows a real change.
//
// No network. It reads no configuration and no environment value.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PROCESSING_ACTIVITIES, renderProcessingRegister } from "../shared/consent/register.ts";

// fileURLToPath, not URL.pathname: this checkout path contains spaces and the
// raw pathname keeps them percent encoded.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value === undefined || value.length === 0 ? null : value;
}

const markdown = renderProcessingRegister();
const out = arg("--out");

if (out === null) {
  process.stdout.write(`${markdown}\n`);
} else {
  mkdirSync(dirname(resolve(ROOT, out)), { recursive: true });
  writeFileSync(resolve(ROOT, out), markdown, "utf8");
  const retention = PROCESSING_ACTIVITIES.flatMap((activity) => activity.retention);
  const purged = retention.filter((line) => line.enforcement === "purge").length;
  const readWindows = retention.filter((line) => line.enforcement === "read_window").length;
  const gaps = retention.filter((line) => line.enforcement === "none").length;
  process.stdout.write(
    `Wrote ${out}: ${PROCESSING_ACTIVITIES.length} activities, ${purged} window(s) bound to a purge, ${readWindows} read window(s), ${gaps} with nothing behind them.\n`,
  );
}