import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateLiveUrl } from "../shared/ssrf.ts";
import { classifyAddress } from "../shared/dnsAddress.ts";

describe("classifyAddress", () => {
  it("blocks private, loopback, metadata, and reserved targets", () => {
    for (const [addr, word] of [
      ["127.0.0.1", "loopback"],
      ["0.0.0.0", "unspecified"],
      ["10.1.2.3", "private"],
      ["172.16.0.1", "private"],
      ["192.168.1.1", "private"],
      ["169.254.169.254", "metadata"],
      ["100.64.0.1", "carrier"],
      ["198.18.0.1", "benchmarking"],
      ["224.0.0.1", "multicast"],
      ["::1", "loopback"],
      ["fd00::1", "unique local"],
      ["fe80::1", "link-local"],
    ]) {
      const reason = classifyAddress(addr);
      assert.ok(reason !== null, `${addr} should be blocked`);
      assert.match(reason, new RegExp(word, "i"), `${addr}: ${reason}`);
    }
  });

  it("blocks IPv4-mapped and NAT64 forms that smuggle a private target", () => {
    assert.ok(classifyAddress("::ffff:169.254.169.254") !== null);
    assert.ok(classifyAddress("::ffff:127.0.0.1") !== null);
    assert.ok(classifyAddress("::ffff:10.0.0.1") !== null);
    assert.ok(classifyAddress("64:ff9b::169.254.169.254") !== null);
  });

  it("blocks the dotted form with the same reason words as the plain IPv4", () => {
    // The dotted mapped tail must classify exactly like the bare IPv4, not just
    // be "blocked somehow".
    const mapped = classifyAddress("::ffff:127.0.0.1");
    assert.ok(mapped !== null);
    assert.match(mapped, /loopback/i);
    const meta = classifyAddress("::ffff:169.254.169.254");
    assert.ok(meta !== null);
    assert.match(meta, /metadata/i);
  });

  it("blocks the HEX-form mapped address, which has no dotted tail to read", () => {
    // ::ffff:7f00:1 is 127.0.0.1 and ::ffff:a9fe:a9fe is 169.254.169.254. Neither
    // contains a dot, so a regex that only reads a dotted tail lets both through.
    for (const [addr, word] of [
      ["::ffff:7f00:1", "loopback"],
      ["::ffff:a9fe:a9fe", "metadata"],
      ["::ffff:a00:1", "private"],
    ]) {
      const reason = classifyAddress(addr);
      assert.ok(reason !== null, `${addr} should be blocked`);
      assert.match(reason, new RegExp(word, "i"), `${addr}: ${reason}`);
    }
  });

  it("blocks IPv4-compatible and NAT64 hex tails", () => {
    for (const [addr, word] of [
      ["::7f00:1", "loopback"],
      ["64:ff9b::7f00:1", "loopback"],
      ["64:ff9b::a9fe:a9fe", "metadata"],
    ]) {
      const reason = classifyAddress(addr);
      assert.ok(reason !== null, `${addr} should be blocked`);
      assert.match(reason, new RegExp(word, "i"), `${addr}: ${reason}`);
    }
  });

  it("blocks the whole fe80::/10 link-local range, not only the fe80 prefix", () => {
    // fe80::/10 spans fe80 through febf. fe90 through febf were slipping through.
    for (const addr of ["fe80::1", "fe90::1", "febf::1", "fea0::1234", "febf:ffff::1"]) {
      const reason = classifyAddress(addr);
      assert.ok(reason !== null, `${addr} should be blocked`);
      assert.match(reason, /link-local/i, `${addr}: ${reason}`);
    }
  });

  it("keeps fe00::/8 and febf-fc00 boundaries honest", () => {
    // fe00::/8 is not link-local (only fe80::/10 is), fc00::/7 is unique-local.
    assert.equal(classifyAddress("fe00::1"), null, "fe00 is not in fe80::/10");
    const unique = classifyAddress("fc00::1");
    assert.ok(unique !== null);
    assert.match(unique, /unique local/i);
    const multicast = classifyAddress("ff02::1");
    assert.ok(multicast !== null);
    assert.match(multicast, /multicast/i);
  });

  it("allows ordinary public addresses", () => {
    for (const addr of [
      "8.8.8.8",
      "1.1.1.1",
      "93.184.216.34",
      "2606:4700::1111",
      "2600:1f18::1",
      "64:ff9b::8.8.8.8",
    ]) {
      assert.equal(classifyAddress(addr), null, addr);
    }
  });
});

describe("literal host guard still applies", () => {
  it("rejects the bypass hostnames at the literal layer too where possible", () => {
    // These are the shapes an audit flagged. They must not pass the literal gate.
    for (const url of ["http://[::1]/", "http://127.0.0.1/", "http://169.254.169.254/"]) {
      assert.equal(validateLiveUrl(url).ok, false, url);
    }
  });
});