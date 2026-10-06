import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  savePendingScan,
  readPendingScan,
  clearPendingScan,
  PENDING_SCAN_KEY,
} from "../src/features/auth/signInDecision.ts";
// Sign-in return. One defect class, one file of tests.
//
// The pain this fixes: signing in to read the full report dropped the person
// back on an empty box, so they had to paste their repo again. The scan id on
// screen is remembered across the OAuth round trip and read back once.
//
// Shape checks mirror the decision storage: anything unreadable is dropped
// rather than guessed, and an id is used once, never twice.

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

describe("the sign-in return lands back on the scan", () => {
  it("round-trips a valid row id", () => {
    const storage = memoryStorage();
    savePendingScan(storage, "mh7731d5tytw5c7zws4q43hg5h8fsr9c");
    assert.equal(readPendingScan(storage), "mh7731d5tytw5c7zws4q43hg5h8fsr9c");
  });

  it("stores nothing for a null or empty id", () => {
    const storage = memoryStorage();
    savePendingScan(storage, null);
    assert.equal(readPendingScan(storage), null);
    savePendingScan(storage, "");
    assert.equal(readPendingScan(storage), null);
  });

  it("drops anything that is not a row id shape", () => {
    const storage = memoryStorage();
    storage.setItem(PENDING_SCAN_KEY, "ada@example.com");
    assert.equal(readPendingScan(storage), null);
    storage.setItem(PENDING_SCAN_KEY, "SHORT");
    assert.equal(readPendingScan(storage), null);
    storage.setItem(PENDING_SCAN_KEY, "has-a-dash-and-is-long-enough-here");
    assert.equal(readPendingScan(storage), null);
  });

  it("survives storage that refuses to read or write", () => {
    const hostile = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    assert.doesNotThrow(() => savePendingScan(hostile, "mh7731d5tytw5c7zws4q43hg5h8fsr9c"));
    assert.equal(readPendingScan(hostile), null);
    assert.doesNotThrow(() => clearPendingScan(hostile));
  });

  it("clears after use, so a reload does not reopen it", () => {
    const storage = memoryStorage();
    savePendingScan(storage, "mh7731d5tytw5c7zws4q43hg5h8fsr9c");
    clearPendingScan(storage);
    assert.equal(readPendingScan(storage), null);
  });
});

describe("the wiring uses the helpers", () => {
  const panel = readFileSync(new URL("../src/features/auth/AuthPanel.tsx", import.meta.url), "utf8");
  const guest = readFileSync(new URL("../src/features/scan/GuestScan.tsx", import.meta.url), "utf8");

  it("passes the on-screen scan to both sign-in surfaces", () => {
    assert.match(guest, /<AuthPanel scanId=\{scanId\} \/>/);
    assert.match(guest, /<LiteReport[\s\S]{0,400}scanId=\{scanId\}/);
  });

  it("saves the on-screen scan at the sign-in click", () => {
    assert.match(panel, /savePendingScan\(window\.sessionStorage, props\.scanId \?\? null\)/);
  });

  it("starts from the stored scan and clears it once used", () => {
    assert.match(guest, /readPendingScan\(window\.sessionStorage/);
    assert.match(guest, /clearPendingScan\(window\.sessionStorage\)/);
  });
});
