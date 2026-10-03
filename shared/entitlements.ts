export const FEATURE_KEYS = ["rendered_phone_check"] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export interface FeatureEntitlement {
  featureKey: FeatureKey;
  enabled: boolean;
  source: "paid" | "permitted";
  expiresAt: number | null;
}

export function canUseFeature(
  entitlement: FeatureEntitlement | null,
  featureKey: FeatureKey,
  now: number,
): boolean {
  if (entitlement === null) return false;
  if (entitlement.featureKey !== featureKey) return false;
  if (!entitlement.enabled) return false;
  if (entitlement.expiresAt !== null && entitlement.expiresAt <= now) return false;
  return true;
}

export function remainingRenderedCredits(
  monthlyLimit: number,
  used: number,
): number {
  return Math.max(0, monthlyLimit - used);
}