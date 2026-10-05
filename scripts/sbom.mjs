// Writes the CycloneDX 1.7 SBOM for this repository.
//
//   node scripts/sbom.mjs                     prints to stdout
//   node scripts/sbom.mjs --out X.cdx.json    writes the file and prints a summary
//   node scripts/sbom.mjs --generated-at TS    sets metadata.timestamp from a real
//                                             build time, which is the only clock
//                                             reading this script will do
//
// Same lockfile in, byte-identical document out, which is why no timestamp is
// stamped by default: a build time is a fact about a build, and this script is not
// a build. Pass --generated-at when the caller really has one.
//
// It reads package-lock.json plus, for an entry with no licence field, that
// package's own node_modules package.json. It reads nothing else, sends nothing,
// never writes inside node_modules, and makes no request.

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readNpmDependencyLicenses } from "../shared/licensing/dependencies.ts";
import { buildSbom, renderSbom } from "../shared/licensing/sbom.ts";

// fileURLToPath, not URL.pathname: this checkout path contains spaces and the
// raw pathname keeps them percent encoded.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name) {
  const index = process.argv.indexOf(name);
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

function manifest() {
  try {
    return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

/** Names the manifest declares directly, so direct and transitive stay apart. */
function directNames(pkg) {
  const names = new Set();
  for (const group of ["dependencies", "devDependencies"]) {
    for (const name of Object.keys(pkg[group] ?? {})) names.add(name);
  }
  return names;
}

const pkg = manifest();
const lockText = readFileSync(join(ROOT, "package-lock.json"), "utf8");
const inventory = readNpmDependencyLicenses(lockText, {
  directNames: directNames(pkg ?? {}),
  readInstalledManifest,
});

const generatedAt = arg("--generated-at");
const document = await buildSbom(inventory, {
  project: {
    name: typeof pkg?.name === "string" ? pkg.name : "unknown-project",
    version: typeof pkg?.version === "string" ? pkg.version : "0.0.0-unknown",
  },
  ...(generatedAt === null ? {} : { generatedAt }),
});

const json = renderSbom(document);
const out = arg("--out");

if (out === null) {
  process.stdout.write(json);
} else {
  mkdirSync(dirname(resolve(ROOT, out)), { recursive: true });
  writeFileSync(resolve(ROOT, out), json, "utf8");
  process.stdout.write(
    `Wrote ${out}: CycloneDX ${document.specVersion}, ${document.components.length} components, ` +
      `${inventory.unknown} unknown licence(s), serial ${document.serialNumber ?? "not derived"}.\n` +
      `${generatedAt === null ? "No metadata.timestamp: pass --generated-at when a real build time is known.\n" : ""}`,
  );
}