// Convex Auth stores its JWT, refresh token, and OAuth verifier in this
// origin's local storage. A stale token from an older auth config can block a
// new sign-in in a normal browser window while an incognito window works.
// Clear only Convex Auth keys. Never clear all site storage.
const CONVEX_AUTH_KEYS = [
  "__convexAuthJWT",
  "__convexAuthRefreshToken",
  "__convexAuthOAuthVerifier",
  "__convexAuthServerStateFetchTime",
];

export function resetLocalAuthState(): void {
  for (const key of CONVEX_AUTH_KEYS) {
    window.localStorage.removeItem(key);
  }
  window.sessionStorage.removeItem("__convexAuthOAuthVerifier");
}