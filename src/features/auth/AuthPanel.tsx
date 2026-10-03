import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { resetLocalAuthState } from "./resetLocalAuthState";

// Optional, never the first door. A guest can scan any public repo. Signing in
// unlocks private-repo depth, one selected repo, and later saved history.
export function AuthPanel() {
  const { signIn, signOut } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();

  if (isLoading) return <p role="status">Checking sign-in status…</p>;

  if (isAuthenticated) {
    return (
      <div className="auth-panel" aria-label="Connected account">
        <p>You are signed in. Connected repo scans will be your next paid step after you install the GitHub App on selected repos.</p>
        <button type="button" onClick={() => void signOut()}>Sign out</button>
      </div>
    );
  }

  return (
    <div className="auth-panel" aria-label="Connect GitHub">
      <p>Want something beyond the guest scan? A connected GitHub App scan is being built. Guest scans do not need login.</p>
      <button type="button" onClick={() => {
        resetLocalAuthState();
        signIn("github").catch(() => {
          alert("GitHub sign-in could not start. Please refresh and try again.");
        });
      }}>Sign in with GitHub</button>
    </div>
  );
}
