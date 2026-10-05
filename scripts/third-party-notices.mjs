// Writes the third-party notice artifact for this repository.
//
// The scan can read the same inventory, but this file exists so a builder can
// produce the file they commit without running a hosted scan and without any
// network call. Offline, deterministic, same lockfile in and the same bytes out.
//
//   node scripts/third-party-notices.mjs            prints to stdout
//   node scripts/third-party-notices.mjs --out X.md writes X.md and prints a summary
//
// It reads package-lock.json plus, for an entry with no licence field, that
// package's own node_modules package.json. It reads nothing else, sends nothing,
// and never writes inside node_modules.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readNpmDependencyLicenses } from "../shared/licensing/dependencies.ts";
import { buildNoticeArtifact } from "../shared/licensing/notice.ts";

// fileURLToPath, not URL.pathname: this checkout path contains spaces and the
// raw pathname keeps them percent encoded.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function argOut() {
  const index = process.argv.indexOf("--out");
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value === undefined || value.length === 0 ? null : value;
}

function readInstalledManifest(name) {
  try {
    return readFileSync(join(ROOT, "node_modules", name, "package.json"), "utf8");
  } catch {
    return null;
  }
}

const lockPath = join(ROOT, "package-lock.json");
/** Names the manifest declares directly, so direct and transitive stay apart. */
function directNames() {
  try {
    const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const names = new Set();
    for (const group of ["dependencies", "devDependencies"]) {
      for (const name of Object.keys(manifest[group] ?? {})) names.add(name);
    }
    return names;
  } catch {
    // Without the manifest, nothing is claimed to be direct. Every package then
    // reads as transitive, which is the wider claim, not the narrower one.
    return new Set();
  }
}

let inventory;
try {
  inventory = readNpmDependencyLicenses(readFileSync(lockPath, "utf8"), {
    directNames: directNames(),
    readInstalledManifest,
  });
} catch {
  process.stderr.write("package-lock.json could not be read. Nothing was written.\n");
  process.exitCode = 1;
}

if (inventory !== undefined) {
  let project = "This project";
  try {
    project = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).name ?? project;
  } catch {
    // A missing or unreadable name changes only the header line.
  }
  const artifact = buildNoticeArtifact(inventory, { project });
  const out = argOut();
  if (out === null) {
    process.stdout.write(`${artifact.markdown}\n`);
  } else {
    writeFileSync(out, artifact.markdown, "utf8");
    process.stdout.write(
      `Wrote ${out}: ${artifact.componentCount} components, ${artifact.unknownCount} unknown. ${artifact.note}\n`,
    );
  }
}