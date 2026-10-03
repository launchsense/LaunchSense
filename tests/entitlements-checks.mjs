import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canUseFeature, remainingRenderedCredits } from "../shared/entitlements.ts";

describe("entitlements", () => {
  const paid = { featureKey: "rendered_phone_check", enabled: true, source: "paid", expiresAt: null };

  it("allows a paid entitlement with no expiry", () => {
    assert.equal(canUseFeature(paid, "rendered_phone_check", 1000), true);
  });

  it("blocks missing, disabled, and expired entitlements", () => {
    assert.equal(canUseFeature(null, "rendered_phone_check", 1000), false);
    assert.equal(canUseFeature({ ...paid, enabled: false }, "rendered_phone_check", 1000), false);
    assert.equal(canUseFeature({ ...paid, expiresAt: 999 }, "rendered_phone_check", 1000), false);
  });

  it("never returns negative remaining credits", () => {
    assert.equal(remainingRenderedCredits(100, 3), 97);
    assert.equal(remainingRenderedCredits(10, 20), 0);
  });
});