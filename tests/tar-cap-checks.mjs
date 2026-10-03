import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gzipSync, gunzipSync } from "node:zlib";
import { extractTar } from "../shared/tar.ts";

function header(name, size) {
  const block = Buffer.alloc(512);
  block.write(name, 0, "utf8");
  block.write("0000644\0", 100, "utf8");
  block.write("0000000\0", 108, "utf8");
  block.write("0000000\0", 116, "utf8");
  block.write(size.toString(8).padStart(11, "0") + "\0", 124, "utf8");
  block.write("00000000000\0", 136, "utf8");
  block.write("        ", 148, "utf8");
  block.write("0", 156, "utf8");
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "utf8");
  return block;
}

function tarEntry(name, size) {
  const data = Buffer.alloc(size, "a");
  const padding = Buffer.alloc((512 - (size % 512)) % 512);
  return Buffer.concat([header(name, size), data, padding]);
}

describe("extractTar byte budget", () => {
  it("does not cross the total byte budget with one file over it", () => {
    const tar = Buffer.concat([
      tarEntry("pkg/a.txt", 2000),
      tarEntry("pkg/b.txt", 2000),
      Buffer.alloc(1024),
    ]);
    const result = extractTar(gzipSync(tar), (data) => gunzipSync(data), {
      maxEntries: 10,
      maxBytesPerFile: 4000,
      maxTotalBytes: 3000,
    });
    const total = result.entries.reduce((sum, entry) => sum + entry.size, 0);
    assert.ok(result.truncated);
    assert.ok(total <= 3000);
    assert.equal(result.entries.length, 1);
  });
});
