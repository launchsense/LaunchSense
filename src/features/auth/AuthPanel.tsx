import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { resetLocalAuthState } from "./resetLocalAuthState";

// Optional, never the first door. Today sign-in stores no history and unlocks no
// extra scan. The guest path is the full product. Every string in this file must
// describe only what the code does today, never a connected scan that is not
// wired up yet.
export function AuthPanel() {
  const { signIn, signOut } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();

  if (isLoading) return <p role="status">Checking sign-in status...</p>;

  if (isAuthenticated) {
    return (
      <div className="auth-panel" aria-label="Connected account">
        <p>
          You are signed in. This changes nothing yet. Scans still read public
          repos only, and nothing is saved to your account.
        </p>
        <button type="button" onClick={() => void signOut()}>Sign out</button>
      </div>
    );
  }

  return (
    <div className="auth-panel" aria-label="Connect GitHub">
      <p>
        Guest scans need no login. Connected GitHub App scans are not available
        yet. Signing in today saves nothing and unlocks nothing.
      </p>
      <button type="button" onClick={() => {
        resetLocalAuthState();
        signIn("github").catch(() => {
          alert("GitHub sign-in could not start. Please refresh and try again.");
        });
      }}>Sign in with GitHub</button>
    </div>
  );
}
