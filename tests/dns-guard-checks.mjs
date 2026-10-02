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

  it("allows ordinary public addresses", () => {
    for (const addr of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700::1111"]) {
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