"use node";

// Unguessable public IDs for share and passport links. 128 bits of randomness
// keeps links unfindable without the exact URL.

export function newPublicId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export function isPublicIdShape(value: string): boolean {
  return /^[0-9a-f]{32}$/.test(value);
}
