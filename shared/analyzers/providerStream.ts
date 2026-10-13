export interface ProviderStreamHit {
  ruleId: 'secret.aws-key' | 'secret.github-token' | 'secret.private-key' | 'secret.client-exposure';
  path: string;
  line: number;
  column: number;
  byteOffset: number;
}

export interface ProviderStreamResult {
  hits: ProviderStreamHit[];
  detectedMatches: number;
  withheldMatches: number;
  bytesChecked: number;
  maxBufferedBytes: number;
}

interface Signature {
  prefix: string;
  ruleId: ProviderStreamHit['ruleId'];
  suffixLength: number;
  alphabet: 'aws' | 'github' | 'fine' | 'none';
}

// These are public signature labels, never input-derived strings. PEM support is
// deliberately limited to these standard BEGIN labels, not custom PEM labels.
const signatures: Signature[] = [
  { prefix: 'AKIA', ruleId: 'secret.aws-key', suffixLength: 16, alphabet: 'aws' },
  ...['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_'].map((prefix): Signature => ({
    prefix, ruleId: 'secret.github-token', suffixLength: 20, alphabet: 'github',
  })),
  { prefix: 'github_pat_', ruleId: 'secret.github-token', suffixLength: 20, alphabet: 'fine' },
  ...['', 'RSA ', 'EC ', 'DSA ', 'OPENSSH ', 'ENCRYPTED '].map((label): Signature => ({
    prefix: `-----BEGIN ${label}PRIVATE KEY-----`,
    ruleId: 'secret.private-key', suffixLength: 0, alphabet: 'none',
  })),
];

interface PrefixState {
  next: Int32Array;
  fallback: number;
  outputs: number[];
}

// Compile a fixed ASCII prefix automaton once. Its transitions include fallback
// edges, so every input byte costs one lookup, even for nested prefix starts.
function compilePrefixes(): PrefixState[] {
  const makeState = (): PrefixState => ({ next: new Int32Array(128).fill(-1), fallback: 0, outputs: [] });
  const states = [makeState()];
  for (let index = 0; index < signatures.length; index++) {
    let state = 0;
    for (const character of signatures[index].prefix) {
      const byte = character.charCodeAt(0);
      if (states[state].next[byte] === -1) {
        states[state].next[byte] = states.length;
        states.push(makeState());
      }
      state = states[state].next[byte];
    }
    states[state].outputs.push(index);
  }
  const queue: number[] = [];
  for (let byte = 0; byte < 128; byte++) {
    const child = states[0].next[byte];
    if (child === -1) states[0].next[byte] = 0;
    else queue.push(child);
  }
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const state = queue[cursor];
    const fallback = states[state].fallback;
    for (let byte = 0; byte < 128; byte++) {
      const child = states[state].next[byte];
      if (child === -1) {
        states[state].next[byte] = states[fallback].next[byte];
      } else {
        const childFallback = states[fallback].next[byte];
        states[child].fallback = childFallback;
        states[child].outputs.push(...states[childFallback].outputs);
        queue.push(child);
      }
    }
  }
  return states;
}

const prefixStates = compilePrefixes();

interface PendingSuffix {
  signature: number;
  remaining: number;
  line: number;
  column: number;
  byteOffset: number;
}

function accepts(byte: number, alphabet: Signature['alphabet']): boolean {
  const upper = byte >= 65 && byte <= 90;
  const digit = byte >= 48 && byte <= 57;
  if (alphabet === 'aws') return upper || digit;
  return upper || digit || (byte >= 97 && byte <= 122) || (alphabet === 'fine' && byte === 95);
}

/**
 * Scan explicit ASCII provider signatures in arbitrary bytes, including comments
 * and strings. Columns count UTF8 bytes, not decoded characters; only LF advances
 * the line. No filesystem, decoding, or source execution is involved.
 *
 * A qualifying start is counted at its minimum suffix length, exactly once.
 * Pending candidates expire within 20 bytes, including overlapping starts. The
 * fixed automaton retains only public-prefix states; suffixes retain counters and
 * positions, never bytes. maxBufferedBytes is therefore always zero. Listed hits
 * are bounded and in qualification order. Counts continue after that limit.
 */
export function createProviderStreamScanner(
  path: string,
  options?: { maxListedMatches?: number },
): { write(chunk: Uint8Array): void; finish(): ProviderStreamResult } {
  if (typeof path !== 'string' || path.length === 0) throw new TypeError('path must be a nonempty string');
  if (options !== undefined && (options === null || typeof options !== 'object' || Array.isArray(options))) {
    throw new TypeError('options must be an object');
  }
  const limit = options?.maxListedMatches === undefined ? 20 : options.maxListedMatches;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 0 || limit > 20) {
    throw new RangeError('maxListedMatches must be an integer from 0 to 20');
  }
  const client = path.startsWith('public/') || path.endsWith('.html');
  const hits: ProviderStreamHit[] = [];
  const pending: PendingSuffix[] = [];
  let state = 0;
  let line = 1;
  let column = 1;
  let bytesChecked = 0;
  let detectedMatches = 0;
  let finished = false;

  function record(signature: number, position: { line: number; column: number; byteOffset: number }): void {
    detectedMatches++;
    if (hits.length < limit) {
      hits.push({
        ruleId: client ? 'secret.client-exposure' : signatures[signature].ruleId,
        path, line: position.line, column: position.column, byteOffset: position.byteOffset,
      });
    }
  }

  return {
    write(chunk: Uint8Array): void {
      if (finished) throw new Error('scanner is finished');
      if (!(chunk instanceof Uint8Array)) throw new TypeError('chunk must be a Uint8Array');
      if (!Number.isSafeInteger(bytesChecked + chunk.length)) throw new RangeError('byte count exceeds safe integer range');
      for (let index = 0; index < chunk.length; index++) {
        const byte = chunk[index];
        let retained = 0;
        // There is at most one suffix-producing prefix ending at each byte and
        // every candidate expires within 20 bytes: at most 20 candidates exist.
        for (let candidateIndex = 0; candidateIndex < pending.length; candidateIndex++) {
          const candidate = pending[candidateIndex];
          if (!accepts(byte, signatures[candidate.signature].alphabet)) continue;
          candidate.remaining--;
          if (candidate.remaining === 0) record(candidate.signature, candidate);
          else pending[retained++] = candidate;
        }
        pending.length = retained;
        state = byte < 128 ? prefixStates[state].next[byte] : 0;
        for (const signatureIndex of prefixStates[state].outputs) {
          const signature = signatures[signatureIndex];
          // All signature prefixes are ASCII and contain no line breaks.
          const position = {
            line, column: column - signature.prefix.length + 1,
            byteOffset: bytesChecked - signature.prefix.length + 1,
          };
          if (signature.suffixLength === 0) record(signatureIndex, position);
          else pending.push({ signature: signatureIndex, remaining: signature.suffixLength, ...position });
        }
        bytesChecked++;
        if (byte === 10) { line++; column = 1; }
        else column++;
      }
    },
    finish(): ProviderStreamResult {
      if (finished) throw new Error('scanner is finished');
      finished = true;
      pending.length = 0;
      state = 0;
      return { hits, detectedMatches, withheldMatches: detectedMatches - hits.length, bytesChecked, maxBufferedBytes: 0 };
    },
  };
}
