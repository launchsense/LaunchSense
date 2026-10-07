// The MCP stdio transport, in both directions. One JSON message per line, no
// length header, a blank line is not a message. The reader is byte accurate:
// the newline counts toward the line, and an oversize line is refused before
// its bytes are kept.

import { maxMessageBytes } from "./limits.ts";
import type { RpcError } from "./limits.ts";

export type LineListener = (line: string, oversize: boolean) => void;

// LineReader turns a byte stream into lines. It holds at most one input chunk
// plus one line, so a 64 MiB line is refused without holding 64 MiB: once the
// running total passes the cap the bytes are dropped and only the newline that
// ends the line is still looked for.
export class LineReader {
  private readonly onLine: LineListener;
  private parts: Buffer[] = [];
  private total = 0;
  private oversize = false;

  constructor(onLine: LineListener) {
    this.onLine = onLine;
  }

  push(chunk: Buffer): void {
    let start = 0;
    for (;;) {
      const newline = chunk.indexOf(0x0a, start);
      if (newline === -1) {
        this.append(chunk.subarray(start), 0);
        return;
      }
      this.append(chunk.subarray(start, newline), 1);
      this.emitLine();
      start = newline + 1;
    }
  }

  // end reports the final line when a client closed its pipe without a trailing
  // newline. A stream that ended exactly on a boundary has nothing left.
  end(): void {
    if (this.oversize || this.total > 0 || this.parts.length > 0) {
      this.emitLine();
    }
  }

  private append(bytes: Buffer, newlineBytes: number): void {
    if (this.oversize) {
      return;
    }
    this.total += bytes.length + newlineBytes;
    if (this.total > maxMessageBytes) {
      this.oversize = true;
      this.parts = [];
      return;
    }
    this.parts.push(bytes);
  }

  private emitLine(): void {
    const oversize = this.oversize;
    const line = oversize
      ? ""
      : trimTrailingNewlines(Buffer.concat(this.parts)).toString("utf8");
    this.parts = [];
    this.total = 0;
    this.oversize = false;
    this.onLine(line, oversize);
  }
}

// trimTrailingNewlines is the bytes.TrimRight(line, "\r\n") the Go reader used.
// A CRLF session therefore sees the same message a newline one does.
function trimTrailingNewlines(bytes: Buffer): Buffer {
  let end = bytes.length;
  while (end > 0 && (bytes[end - 1] === 0x0a || bytes[end - 1] === 0x0d)) {
    end -= 1;
  }
  return bytes.subarray(0, end);
}

// buildResult builds one JSON-RPC message and its newline as a single string.
// JSON.stringify escapes every newline inside a string, so a message can never
// break the line framing, and one write of one whole string cannot interleave
// with another answer.
export function buildResult(
  id: unknown,
  result: unknown,
  rpcError: RpcError | null,
): string {
  const message: Record<string, unknown> = {
    jsonrpc: "2.0",
    id: id === undefined ? null : id,
  };
  if (rpcError) {
    message.error = { code: rpcError.code, message: rpcError.message };
  } else {
    message.result = result;
  }
  return `${JSON.stringify(message)}\n`;
}
