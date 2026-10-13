import { summarizeArtifactCoverage } from "./artifactCoverage.ts";
import type { ArtifactCoverage } from "./artifactCoverage.ts";
import type { ProviderStreamResult } from "../analyzers/providerStream.ts";

export interface StreamedArtifactScan {
  coverage: ArtifactCoverage;
  result: ProviderStreamResult | null;
  artifactSha256: string | null;
  maxReadBufferBytes: number;
}

export function summarizeStreamedArtifacts(records: readonly StreamedArtifactScan[]) {
  const coverage = summarizeArtifactCoverage(records.map(row => row.coverage));
  let knownDetectedMatches = 0, knownWithheldMatches = 0, unknownDetectionFiles = 0, maxReadBufferBytes = 0;
  for (const record of records) {
    if (!Number.isSafeInteger(record.maxReadBufferBytes) || record.maxReadBufferBytes < 0 || record.maxReadBufferBytes > 65536) throw new TypeError("Invalid streamed read buffer size");
    maxReadBufferBytes = Math.max(maxReadBufferBytes, record.maxReadBufferBytes);
    const check = record.coverage.checks.find(row => row.checkId === "provider-signatures");
    if (check === undefined) throw new TypeError("Missing provider coverage");
    const known = check.state === "Checked" || check.state === "Partial";
    if (!known) {
      if (record.result !== null || record.artifactSha256 !== null) throw new TypeError("Unverifiable provider coverage cannot retain observations");
      unknownDetectionFiles++;
      continue;
    }
    const result = record.result;
    if (result === null || result.bytesChecked !== check.bytesChecked) throw new TypeError("Provider observations do not match coverage");
    if (!Number.isSafeInteger(result.detectedMatches) || !Number.isSafeInteger(result.withheldMatches) || result.withheldMatches < 0 || result.detectedMatches !== result.hits.length + result.withheldMatches || result.hits.length > 20) throw new TypeError("Invalid provider listing counts");
    for (const hit of result.hits) {
      if (hit.path !== record.coverage.path || !Number.isSafeInteger(hit.byteOffset) || hit.byteOffset < 0 || hit.byteOffset >= check.bytesChecked || !Number.isSafeInteger(hit.line) || hit.line < 1 || !Number.isSafeInteger(hit.column) || hit.column < 1) throw new TypeError("Invalid provider hit coordinates");
    }
    if (check.state === "Checked") {
      if (typeof record.artifactSha256 !== "string" || !/^[a-f0-9]{64}$/.test(record.artifactSha256)) throw new TypeError("Complete provider coverage needs its artifact hash");
    } else if (record.artifactSha256 !== null) throw new TypeError("A prefix hash is not a complete artifact hash");
    knownDetectedMatches += result.detectedMatches;
    knownWithheldMatches += result.withheldMatches;
  }
  return { ...coverage, knownDetectedMatches, knownWithheldMatches, unknownDetectionFiles, maxReadBufferBytes };
}

export function streamedArtifactGaps(records: readonly StreamedArtifactScan[]): Array<{ scope: string; reason: string }> {
  summarizeStreamedArtifacts(records);
  const rows: Array<{ scope: string; reason: string }> = [];
  for (const record of records) {
    const coverage = record.coverage;
    const provider = coverage.checks.find(row => row.checkId === "provider-signatures");
    if (provider === undefined) throw new TypeError("Missing provider coverage");
    const reason = provider.state === "Checked"
      ? `Provider signatures checked over ${provider.bytesChecked} bytes. Generic credentials, code shapes and other content checks did not run.`
      : `${provider.reason ?? "Provider coverage could not be established."} ${provider.bytesChecked} of ${coverage.totalBytes} bytes judged by provider signatures; the remainder is not cleared. Generic credentials, code shapes and other content checks did not run.`;
    rows.push({ scope: coverage.path, reason });
    if (record.result !== null && record.result.withheldMatches > 0) {
      rows.push({ scope: coverage.path, reason: `${record.result.withheldMatches} further recognized provider signature(s) were not listed by the 20-match listing cap. Detection continued and the total is retained.` });
    }
  }
  return rows;
}
