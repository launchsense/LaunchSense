// Minimal tar reader for a GitHub tarball. One HTTP request replaces up to
// 200 per-file content requests, which is the difference between a working
// unauthenticated quota and a dead one.
//
// Pure and synchronous: no filesystem, no child process. Only regular files
// under the size cap are returned. Anything that could escape the root
// (absolute paths, .. segments, symlinks, hardlinks, devices) is skipped.

export interface TarEntry {
  path: string;
  content: string;
  size: number;
}

const BLOCK = 512;

function readString(block: Uint8Array, offset: number, length: number): string {
  let end = offset;
  const limit = offset + length;
  while (end < limit && block[end] !== 0) end++;
  let out = "";
  for (let i = offset; i < end; i++) out += String.fromCharCode(block[i] ?? 0);
  return out;
}

// Tar stores sizes as octal ASCII, sometimes with a base-256 encoding for
// values too large for octal.
function readSize(block: Uint8Array): number | null {
  const raw = readString(block, 124, 12).trim();
  if (raw.length === 0) return null;
  const first = block[124] ?? 0;
  if (first > 0x80) {
    // Base-256: the high bit of the first byte marks the encoding.
    let value = 0;
    for (let i = 124; i < 136; i++) {
      value = value * 256 + ((block[i] ?? 0) & (i === 124 ? 0x7f : 0xff));
    }
    return value;
  }
  if (!/^[0-7]+$/.test(raw)) return null;
  const value = parseInt(raw, 8);
  return Number.isSafeInteger(value) ? value : null;
}

function isSafePath(path: string): boolean {
  if (path.length === 0 || path.length > 512) return false;
  if (path.startsWith("/")) return false;
  if (path.includes("\0")) return false;
  const parts = path.split("/");
  for (const part of parts) {
    if (part === "..") return false;
  }
  return true;
}

function decode(bytes: Uint8Array): string | null {
  for (let i = 0; i < Math.min(bytes.length, 8000); i++) {
    if (bytes[i] === 0) return null;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export interface ExtractOptions {
  maxEntries: number;
  maxBytesPerFile: number;
  maxTotalBytes: number;
}

export function extractTar(
  gzipped: Uint8Array,
  gunzip: (data: Uint8Array) => Uint8Array,
  options: ExtractOptions,
): { entries: TarEntry[]; truncated: boolean } {
  let tar: Uint8Array;
  try {
    tar = gunzip(gzipped);
  } catch {
    return { entries: [], truncated: false };
  }
  const view = new DataView(tar.buffer, tar.byteOffset, tar.byteLength);
  const decoder = new TextDecoder("utf-8", { fatal: false });

  const entries: TarEntry[] = [];
  let totalBytes = 0;
  let truncated = false;
  let offset = 0;

  while (offset + BLOCK <= tar.length) {
    const block = tar.subarray(offset, offset + BLOCK);
    if (block.every((b) => b === 0)) break;

    const name = readString(block, 0, 100);
    const size = readSize(block);
    const typeFlag = String.fromCharCode(block[156] ?? 0);
    const prefix = readString(block, 345, 155);

    if (size === null) break;
    const dataStart = offset + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) break;

    // Only regular files ("0" or NUL). Symlinks, links and devices are skipped.
    const isRegular = typeFlag === "0" || typeFlag === "\0";
    if (isRegular && name.length > 0) {
      const full = prefix.length > 0 ? `${prefix}/${name}` : name;
      // GitHub tarballs wrap everything in a single commit-sha directory.
      const trimmed = full.includes("/") ? full.slice(full.indexOf("/") + 1) : full;
      const isDirEntry = name.endsWith("/");
      if (isSafePath(trimmed) && !isDirEntry) {
        if (entries.length >= options.maxEntries || totalBytes >= options.maxTotalBytes) {
          truncated = true;
        } else if (size <= options.maxBytesPerFile) {
          const text = decode(tar.subarray(dataStart, dataEnd));
          if (text !== null) {
            entries.push({ path: trimmed, content: text, size });
            totalBytes += size;
          }
        }
      }
    }

    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;
    void view;
    void decoder;
  }

  return { entries, truncated };
}