export type ArtifactCheckId = 'provider-signatures' | 'generic-credentials' | 'code-shapes' | 'whole-file-content';
export type ArtifactCoverageState = 'Checked' | 'Partial' | 'Not checked' | 'Unknown';

export interface ArtifactCheckCoverage {
  checkId: ArtifactCheckId;
  state: ArtifactCoverageState;
  bytesChecked: number;
  reason: string | null;
}

export interface ArtifactCoverage {
  path: string;
  profile: 'provider-stream-v1';
  totalBytes: number;
  bytesRead: number;
  checks: ArtifactCheckCoverage[];
}

export interface ArtifactCoverageInput {
  path: string;
  totalBytes: number;
  bytesRead: number;
  providerBytesChecked: number;
  readComplete: boolean;
  stable: boolean;
  failure: null | 'byte-budget' | 'read-error' | 'file-changed' | 'binary-content';
}

const OTHER_REASON = 'The provider-only pass does not judge this check.';
const BUDGET_REASON = 'The byte budget prevented a complete provider-signature check.';
const UNKNOWN_REASONS = {
  'read-error': 'A read error invalidated provider-signature coverage.',
  'file-changed': 'The file changed, invalidating provider-signature coverage.',
  'binary-content': 'Binary content invalidated provider-signature coverage.',
} as const;
const CHECK_IDS: readonly ArtifactCheckId[] = [
  'provider-signatures', 'generic-credentials', 'code-shapes', 'whole-file-content',
];

function requireCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new TypeError(`Invalid artifact coverage: ${message}`);
}

function requireFields(value: unknown, fields: readonly string[]): asserts value is Record<string, unknown> {
  requireCondition(typeof value === 'object' && value !== null && !Array.isArray(value), 'expected an object');
  for (const field of fields) {
    requireCondition(Object.hasOwn(value, field), `missing ${field}`);
  }
}

function requireCount(value: unknown): asserts value is number {
  requireCondition(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, 'expected a nonnegative safe integer byte count');
}

function requireBase(value: unknown): asserts value is Record<string, unknown> & { path: string; totalBytes: number; bytesRead: number } {
  requireFields(value, ['path', 'totalBytes', 'bytesRead']);
  requireCondition(typeof value.path === 'string' && value.path.length > 0, 'expected a nonempty path');
  requireCount(value.totalBytes);
  requireCount(value.bytesRead);
  requireCondition(value.bytesRead <= value.totalBytes, 'bytes read exceed total bytes');
}

export function createArtifactCoverage(input: ArtifactCoverageInput): ArtifactCoverage {
  requireBase(input);
  requireFields(input, ['providerBytesChecked', 'readComplete', 'stable', 'failure']);
  requireCount(input.providerBytesChecked);
  requireCondition(input.providerBytesChecked <= input.bytesRead, 'provider bytes exceed bytes read');
  requireCondition(typeof input.readComplete === 'boolean' && typeof input.stable === 'boolean', 'expected boolean completion and stability');

  let state: ArtifactCoverageState;
  let reason: string | null;
  if (input.failure === null) {
    requireCondition(input.stable && input.readComplete && input.bytesRead === input.totalBytes && input.providerBytesChecked === input.totalBytes, 'successful coverage must be stable and complete');
    state = 'Checked';
    reason = null;
  } else if (input.failure === 'byte-budget') {
    requireCondition(input.stable && !input.readComplete && input.bytesRead < input.totalBytes, 'budget coverage must be a stable incomplete prefix');
    state = input.providerBytesChecked === 0 ? 'Not checked' : 'Partial';
    reason = BUDGET_REASON;
  } else {
    requireCondition(input.failure === 'read-error' || input.failure === 'file-changed' || input.failure === 'binary-content', 'unrecognized failure');
    requireCondition(!input.readComplete && input.providerBytesChecked === 0, 'failed coverage must discard provider bytes and cannot be complete');
    if (input.failure === 'file-changed') {
      requireCondition(!input.stable, 'a changed file cannot be stable');
    }
    state = 'Unknown';
    reason = UNKNOWN_REASONS[input.failure];
  }

  return {
    path: input.path,
    profile: 'provider-stream-v1',
    totalBytes: input.totalBytes,
    bytesRead: input.bytesRead,
    checks: CHECK_IDS.map((checkId) => checkId === 'provider-signatures'
      ? { checkId, state, bytesChecked: input.providerBytesChecked, reason }
      : { checkId, state: 'Not checked', bytesChecked: 0, reason: OTHER_REASON }),
  };
}

function validateRecord(record: ArtifactCoverage): ArtifactCheckCoverage {
  requireBase(record);
  requireFields(record, ['profile', 'checks']);
  requireCondition(record.profile === 'provider-stream-v1', 'unrecognized profile');
  requireCondition(Array.isArray(record.checks) && record.checks.length === CHECK_IDS.length, 'expected exactly four checks');
  const seen = new Set<ArtifactCheckId>();
  let provider: ArtifactCheckCoverage | undefined;
  for (const check of record.checks) {
    requireFields(check, ['checkId', 'state', 'bytesChecked', 'reason']);
    requireCondition(CHECK_IDS.includes(check.checkId) && !seen.has(check.checkId), 'unrecognized or duplicate check');
    seen.add(check.checkId);
    requireCount(check.bytesChecked);
    requireCondition(check.bytesChecked <= record.bytesRead, 'checked bytes exceed read bytes');
    if (check.checkId !== 'provider-signatures') {
      requireCondition(check.state === 'Not checked' && check.bytesChecked === 0 && check.reason === OTHER_REASON, 'provider-only coverage cannot judge other checks');
      continue;
    }
    provider = check;
    switch (check.state) {
      case 'Checked':
        requireCondition(record.bytesRead === record.totalBytes && check.bytesChecked === record.totalBytes && check.reason === null, 'checked provider coverage must cover every byte');
        break;
      case 'Partial':
      case 'Not checked':
        requireCondition(record.bytesRead < record.totalBytes && check.reason === BUDGET_REASON, 'budget coverage must be incomplete');
        requireCondition(check.state === 'Partial' ? check.bytesChecked > 0 : check.bytesChecked === 0, 'budget state contradicts checked bytes');
        break;
      case 'Unknown':
        requireCondition(check.bytesChecked === 0 && Object.values(UNKNOWN_REASONS).some((reason) => reason === check.reason), 'unknown coverage must discard checked bytes and explain failure');
        break;
      default:
        throw new TypeError('Invalid artifact coverage: unrecognized coverage state');
    }
  }
  requireCondition(provider !== undefined, 'missing provider check');
  return provider;
}

export function summarizeArtifactCoverage(records: readonly ArtifactCoverage[]): {
  files: number;
  bytesRead: number;
  providerBytesChecked: number;
  providerIncompleteFiles: number;
  providerOnlyFiles: number;
} {
  requireCondition(Array.isArray(records), 'expected a records array');
  const summary = { files: 0, bytesRead: 0, providerBytesChecked: 0, providerIncompleteFiles: 0, providerOnlyFiles: 0 };
  const paths = new Set<string>();
  for (const record of records) {
    const provider = validateRecord(record);
    requireCondition(!paths.has(record.path), 'duplicate path');
    paths.add(record.path);
    summary.files += 1;
    summary.bytesRead += record.bytesRead;
    summary.providerBytesChecked += provider.bytesChecked;
    requireCount(summary.bytesRead);
    requireCount(summary.providerBytesChecked);
    if (provider.state !== 'Checked') summary.providerIncompleteFiles += 1;
    summary.providerOnlyFiles += 1;
  }
  return summary;
}
