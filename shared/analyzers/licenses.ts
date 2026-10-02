// Deterministic license signals. Reports what was found and maps it to a
// review policy. This is not legal advice; copyleft and missing licenses
// always need a human decision before sharing.

export type LicensePolicy =
  | "Allowed"
  | "Review required"
  | "Not recommended"
  | "Unknown"
  | "Not checked";

export interface LicenseResult {
  detected: string[];
  files: string[];
  packageLicense: string | null;
  policy: LicensePolicy;
  note: string;
}

const LICENSE_MARKERS: Array<{ id: string; pattern: RegExp }> = [
  { id: "MIT", pattern: /mit license/i },
  { id: "Apache-2.0", pattern: /apache license[^]*version 2\.0/i },
  { id: "GPL-3.0", pattern: /gnu general public license[^]*version 3/i },
  { id: "GPL-2.0", pattern: /gnu general public license[^]*version 2/i },
  { id: "AGPL-3.0", pattern: /affero general public license/i },
  { id: "LGPL", pattern: /lesser general public license/i },
  { id: "MPL-2.0", pattern: /mozilla public license 2\.0/i },
  { id: "BSD-3-Clause", pattern: /bsd 3-clause/i },
  { id: "BSD-2-Clause", pattern: /bsd 2-clause/i },
  { id: "ISC", pattern: /isc license/i },
  { id: "Unlicense", pattern: /the unlicense/i },
  { id: "Proprietary", pattern: /all rights reserved|proprietary|unlicensed/i },
];

function isLicenseFile(path: string): boolean {
  const base = (path.split("/").pop() ?? path).toUpperCase();
  return (
    base === "LICENSE" ||
    base.startsWith("LICENSE.") ||
    base.startsWith("LICENSE-") ||
    base === "LICENCE" ||
    base.startsWith("LICENCE.") ||
    base === "NOTICE" ||
    base.startsWith("NOTICE.") ||
    base === "COPYING"
  );
}

export function analyzeLicenses(
  treeBlobs: string[],
  files: Array<{ path: string; content: string }>,
  filesFetched: boolean,
): LicenseResult {
  const licenseFiles = treeBlobs.filter(isLicenseFile);
  const detected = new Set<string>();

  for (const file of files) {
    if (!isLicenseFile(file.path)) continue;
    const head = file.content.slice(0, 4000);
    for (const marker of LICENSE_MARKERS) {
      if (marker.pattern.test(head)) detected.add(marker.id);
    }
  }

  let packageLicense: string | null = null;
  const pkg = files.find((f) => (f.path.split("/").pop() ?? "") === "package.json");
  if (pkg !== undefined) {
    try {
      const data = JSON.parse(pkg.content) as unknown;
      if (typeof data === "object" && data !== null) {
        const lic = (data as Record<string, unknown>)["license"];
        if (typeof lic === "string" && lic.length > 0) {
          packageLicense = lic;
          if (/^MIT$/i.test(lic)) detected.add("MIT");
          else if (/^Apache-2\.0$/i.test(lic)) detected.add("Apache-2.0");
          else if (/^ISC$/i.test(lic)) detected.add("ISC");
          else if (/^BSD-/i.test(lic)) detected.add(lic.toUpperCase());
          else if (/GPL|AGPL|LGPL/i.test(lic)) detected.add(lic.toUpperCase());
        }
      }
    } catch {
      // Unparseable manifest: no license signal from it.
    }
  }

  const found = [...detected];
  if (!filesFetched) {
    return {
      detected: found,
      files: licenseFiles,
      packageLicense,
      policy: "Not checked",
      note: "No file contents were fetched, so licenses could not be examined.",
    };
  }
  if (found.includes("AGPL-3.0") || found.includes("Proprietary")) {
    return {
      detected: found,
      files: licenseFiles,
      packageLicense,
      policy: "Not recommended",
      note: "Strong copyleft or proprietary wording was found. A human must decide before sharing. This is not legal advice.",
    };
  }
  if (found.some((d) => /GPL|LGPL|MPL/.test(d))) {
    return {
      detected: found,
      files: licenseFiles,
      packageLicense,
      policy: "Review required",
      note: "Copyleft wording was found. A human must decide before sharing. This is not legal advice.",
    };
  }
  if (found.length > 0) {
    return {
      detected: found,
      files: licenseFiles,
      packageLicense,
      policy: "Allowed",
      note: "Permissive license signals found. Still confirm the file covers the whole repo. This is not legal advice.",
    };
  }
  return {
    detected: found,
    files: licenseFiles,
    packageLicense,
    policy: "Unknown",
    note: "No license signals found. Add a LICENSE file or confirm the intended terms. This is not legal advice.",
  };
}
