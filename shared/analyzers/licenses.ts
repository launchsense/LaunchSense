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
  { id: "MIT", pattern: /\bmit license\b|permission is hereby granted, free of charge/i },
  { id: "Apache-2.0", pattern: /apache license[^]*version 2\.0|licensed under the apache license/i },
  { id: "GPL-3.0", pattern: /gnu general public license[^]*version 3/i },
  { id: "GPL-2.0", pattern: /gnu general public license[^]*version 2/i },
  { id: "AGPL-3.0", pattern: /affero general public license/i },
  { id: "LGPL", pattern: /lesser general public license/i },
  { id: "MPL-2.0", pattern: /mozilla public license,? (?:v(?:ersion)? )?2\.0/i },
  { id: "BSD-3-Clause", pattern: /bsd 3-clause|redistribution and use in source and binary forms[^]*neither the name/i },
  { id: "BSD-2-Clause", pattern: /bsd 2-clause|redistribution and use in source and binary forms/i },
  { id: "ISC", pattern: /isc license|permission to use, copy, modify, and\/or distribute this software/i },
  { id: "Unlicense", pattern: /the unlicense|this is free and unencumbered software released into the public domain/i },
  { id: "CC0-1.0", pattern: /cc0 1\.0|creative commons zero/i },
  { id: "BUSL-1.1", pattern: /business source license/i },
  { id: "SSPL-1.0", pattern: /server side public license/i },
  { id: "Commons-Clause", pattern: /commons clause/i },
  { id: "Prosperity", pattern: /prosperity public license/i },
  { id: "Elastic-2.0", pattern: /elastic license 2\.0/i },
];

const SIGNAL = "Signal, not legal advice.";

/** Map a manifest license string to detected ids, preserving SPDX suffixes and OR. */
function addPackageLicense(detected: Set<string>, lic: string): void {
  if (/^UNLICENSED$/i.test(lic)) { detected.add("UNLICENSED"); return; }
  if (/\bOR\b/.test(lic)) { detected.add(lic); return; }
  // A single SPDX id, kept verbatim so `GPL-3.0-or-later` stays or-later.
  const known = /^(MIT|Apache-2\.0|ISC|BSD-2-Clause|BSD-3-Clause|MPL-2\.0|Unlicense|CC0-1\.0)$/i;
  if (known.test(lic)) { detected.add(lic === "Apache-2.0" ? "Apache-2.0" : lic); return; }
  if (/GPL|AGPL|LGPL/i.test(lic)) { detected.add(lic); return; }
  detected.add(lic);
}

function noticeSentence(found: string[], files: Array<{ path: string }>): string {
  if (!found.includes("Apache-2.0")) return "";
  const hasNotice = files.some((file) => {
    const base = (file.path.split("/").pop() ?? "").toUpperCase();
    return base === "NOTICE" || base.startsWith("NOTICE.");
  });
  return hasNotice
    ? " Apache-2.0 was found, and a NOTICE file was in this read."
    : " Apache-2.0 was found. No NOTICE file was in this read.";
}

function mismatchSentence(packageLicense: string | null, fileDetected: ReadonlySet<string>): string {
  if (packageLicense === null || fileDetected.size === 0) return "";
  const aligned = [...fileDetected].some((id) => id.toLowerCase() === packageLicense.toLowerCase());
  if (aligned) return "";
  return ` Two facts: package.json says ${packageLicense}. The license files read say ${[...fileDetected].join(", ")}.`;
}

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

/** A licence file at the repo root. NOTICE is a companion file, not the licence. */
function isRootLicenseFile(path: string): boolean {
  if (path.includes("/")) return false;
  const base = path.toUpperCase();
  if (base === "NOTICE" || base.startsWith("NOTICE.")) return false;
  return isLicenseFile(path);
}

export function analyzeLicenses(
  treeBlobs: string[],
  files: Array<{ path: string; content: string }>,
  filesFetched: boolean,
): LicenseResult {
  const licenseFiles = treeBlobs.filter(isLicenseFile);
  const detected = new Set<string>();
  const fileDetected = new Set<string>();
  let rootLicenseRead = false;
  let rootLicenseMatched = false;

  for (const file of files) {
    if (!isLicenseFile(file.path)) continue;
    const fromRoot = isRootLicenseFile(file.path);
    if (fromRoot) rootLicenseRead = true;
    const head = file.content.slice(0, 4000);
    for (const marker of LICENSE_MARKERS) {
      if (marker.pattern.test(head)) {
        detected.add(marker.id);
        fileDetected.add(marker.id);
        if (fromRoot) rootLicenseMatched = true;
      }
    }
  }

  // BSD-2 is a subset of BSD-3 text. When the endorsement clause is present, drop
  // the weaker BSD-2 so one BSD licence is reported, not two.
  if (fileDetected.has("BSD-3-Clause")) {
    detected.delete("BSD-2-Clause");
    fileDetected.delete("BSD-2-Clause");
  }

  let packageLicense: string | null = null;
  const pkg = files.find((f) => (f.path.split("/").pop() ?? "") === "package.json");
  if (pkg !== undefined) {
    try {
      const data = JSON.parse(pkg.content) as unknown;
      if (typeof data === "object" && data !== null) {
        const lic = (data as Record<string, unknown>)["license"];
        if (typeof lic === "string" && lic.length > 0) packageLicense = lic;
      }
    } catch {
      // Unparseable manifest: no license signal from it.
    }
  }

  // Non-npm manifests. A Rust crate declares its licence in Cargo.toml, a Python
  // project in pyproject.toml. Ignoring these is why every Rust crate read as
  // unlicensed. Read them as equal sources to the licence file.
  if (packageLicense === null) {
    const cargo = files.find((f) => (f.path.split("/").pop() ?? "") === "Cargo.toml");
    if (cargo !== undefined) {
      const m = /^license\s*=\s*"([^"]+)"/m.exec(cargo.content);
      if (m !== null && m[1] !== undefined) packageLicense = m[1];
    }
  }
  if (packageLicense === null) {
    const py = files.find((f) => (f.path.split("/").pop() ?? "") === "pyproject.toml");
    if (py !== undefined) {
      const m = /license\s*=\s*["']([^"']+)["']/.exec(py.content);
      if (m !== null && m[1] !== undefined) packageLicense = m[1];
    }
  }

  if (packageLicense !== null) {
    addPackageLicense(detected, packageLicense);
  }

  const found = [...detected];
  const suffix = `${noticeSentence(found, files)}${mismatchSentence(packageLicense, fileDetected)}`;
  if (!filesFetched) {
    return {
      detected: found,
      files: licenseFiles,
      packageLicense,
      policy: "Not checked",
      note: "No file contents were fetched, so licenses could not be examined.",
    };
  }
  const orChoice = found.some((id) => /\bOR\b/.test(id));
  const sourceAvailable = found.some((id) => /BUSL|SSPL|Commons-Clause|Prosperity|Elastic/.test(id));
  if (sourceAvailable) {
    return {
      detected: found,
      files: licenseFiles,
      packageLicense,
      policy: "Review required",
      note: `Source-available terms were read. They are not ordinary open source.${suffix} ${SIGNAL}`,
    };
  }
  if (found.includes("UNLICENSED")) {
    return {
      detected: found,
      files: licenseFiles,
      packageLicense,
      policy: "Review required",
      note: `UNLICENSED is not the Unlicense dedication.${suffix} ${SIGNAL}`,
    };
  }
  if (found.includes("AGPL-3.0")) {
    return {
      detected: found,
      files: licenseFiles,
      packageLicense,
      policy: "Not recommended",
      note: `AGPL text was found in the files read. A network use question needs a person.${suffix} ${SIGNAL}`,
    };
  }
  if (found.some((d) => /GPL|LGPL|MPL/.test(d))) {
    const orLater = found.some((d) => /-or-later/i.test(d));
    const widen = orLater
      ? " The license grants or-later, so a later version may be chosen."
      : " It is not stated as or-later.";
    return {
      detected: found,
      files: licenseFiles,
      packageLicense,
      policy: "Review required",
      note: `Copyleft wording was found. The exact id is listed.${widen}${suffix} ${SIGNAL}`,
    };
  }
  if (orChoice) {
    return {
      detected: found,
      files: licenseFiles,
      packageLicense,
      policy: "Review required",
      note: `An OR expression is a choice, not both licenses at once.${suffix} ${SIGNAL}`,
    };
  }
  // The root licence file is this repository's own terms. When it was read and no
  // marker matched it, the root licence is unrecognised, so a nested permissive
  // file or a manifest field must not set Allowed. Stricter verdicts above (source
  // available, copyleft, AGPL) still stand, and the other ids are listed as their
  // own facts in the note.
  if (rootLicenseRead && !rootLicenseMatched) {
    const otherIds =
      found.length > 0
        ? ` Other licence ids in this read, each its own fact: ${found.join(", ")}.`
        : " No other licence id was in this read.";
    return {
      detected: found,
      files: licenseFiles,
      packageLicense,
      policy: "Unknown",
      note: `The root licence file was read and no licence marker matched it, so the root licence is unrecognised.${otherIds}${suffix} ${SIGNAL}`,
    };
  }
  if (found.length > 0) {
    return {
      detected: found,
      files: licenseFiles,
      packageLicense,
      policy: "Allowed",
      note: `Permissive license signals found.${suffix} ${SIGNAL}`,
    };
  }
  return {
    detected: found,
    files: licenseFiles,
    packageLicense,
    policy: "Unknown",
    note: `No license signals in the license files and package.json field that were read. ${SIGNAL}`,
  };
}
