import { fstatSync, readSync } from "node:fs";
import type { Stats } from "node:fs";
import { createHash } from "node:crypto";
import { createProviderStreamScanner } from "../shared/analyzers/providerStream.ts";
import { createArtifactCoverage } from "../shared/review/artifactCoverage.ts";
import type { ArtifactCoverageInput } from "../shared/review/artifactCoverage.ts";
import type { StreamedArtifactScan } from "../shared/review/streamedArtifacts.ts";

export const PROVIDER_READ_BUFFER_BYTES = 65536;

// The caller owns a freshly opened, identity-checked, no-follow regular file.
// This function reads only that descriptor, never reopens a pathname.
export function readProviderArtifact(fd: number, path: string, opened: Stats, byteBudget: number): StreamedArtifactScan {
  if (!Number.isSafeInteger(byteBudget) || byteBudget < 0 || !Number.isSafeInteger(opened.size) || opened.size < 0) throw new TypeError("Invalid provider byte budget or file size");
  const allowed = Math.min(opened.size, byteBudget);
  const buffer = Buffer.alloc(Math.min(PROVIDER_READ_BUFFER_BYTES, allowed));
  const scanner = createProviderStreamScanner(path);
  const hash = createHash("sha256");
  let bytesRead = 0;
  let failure: ArtifactCoverageInput["failure"] = null;
  while (bytesRead < allowed) {
    let count: number;
    try { count = readSync(fd, buffer, 0, Math.min(buffer.length, allowed - bytesRead), bytesRead); }
    catch { failure = "read-error"; break; }
    if (count === 0) { failure = "read-error"; break; }
    bytesRead += count;
    const chunk = buffer.subarray(0, count);
    if (chunk.includes(0)) { failure = "binary-content"; break; }
    scanner.write(chunk);
    hash.update(chunk);
  }
  let stable = true;
  try {
    const after = fstatSync(fd);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
      stable = false; failure = "file-changed";
    }
  } catch { stable = false; failure = "read-error"; }
  const result = scanner.finish();
  if (failure === null && bytesRead < opened.size) failure = "byte-budget";
  const verified = failure === null || (failure === "byte-budget" && bytesRead > 0);
  const coverage = createArtifactCoverage({ path, totalBytes: opened.size, bytesRead, providerBytesChecked: verified ? result.bytesChecked : 0, readComplete: failure === null, stable, failure });
  return { coverage, result: verified ? result : null, artifactSha256: failure === null ? hash.digest("hex") : null, maxReadBufferBytes: buffer.length };
}
