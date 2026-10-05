import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canReadScan } from "../shared/reports/scanAccess.ts";

// U2. Report queries are keyed on the scan id, so a signed-in scan of a private
// repo must only be readable by the owner. A guest scan of a public repo stays
// id-addressed: anyone with the link can read it. This test pins the pure rule
// the four report queries apply.

describe("U2 canReadScan ownership", () => {
  it("lets the owner read their own signed-in scan", () => {
    assert.equal(canReadScan({ signedIn: true, userId: "user_owner" }, "user_owner"), true);
  });

  it("hides a signed-in scan from a second signed-in user", () => {
    assert.equal(canReadScan({ signedIn: true, userId: "user_owner" }, "user_other"), false);
  });

  it("hides a signed-in scan from a logged-out caller", () => {
    assert.equal(canReadScan({ signedIn: true, userId: "user_owner" }, null), false);
  });

  it("hides a signed-in scan that has no recorded owner from everyone but a null match", () => {
    assert.equal(canReadScan({ signedIn: true }, null), false);
    assert.equal(canReadScan({ signedIn: true, userId: null }, "user_other"), false);
    assert.equal(canReadScan({ signedIn: true, userId: undefined }, "user_owner"), false);
  });

  it("keeps a guest scan of a public repo readable by id with no viewer", () => {
    assert.equal(canReadScan({ signedIn: false }, null), true);
    assert.equal(canReadScan({}, null), true);
    assert.equal(canReadScan({ signedIn: undefined }, "user_other"), true);
  });
});
