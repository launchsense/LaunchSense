import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "@convex-dev/auth/react";

// Optional, never the first door. A guest can scan any public repo. Signing in
// unlocks private-repo depth, one selected repo, and later saved history.
export function AuthPanel() {
  const { signIn, signOut } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();

  if (isLoading) return <p role="status">Checking sign-in status…</p>;

  if (isAuthenticated) {
    return (
      <div className="auth-panel" aria-label="Connected account">
        <p>You are connected. LaunchSense keeps one selected repo, read-only, and it never stores your code.</p>
        <button type="button" onClick={() => void signOut()}>Sign out</button>
      </div>
    );
  }

  return (
    <div className="auth-panel" aria-label="Connect GitHub">
      <p>Want a deeper scan on your own repo? Sign in with GitHub only when you are ready.</p>
      <button type="button" onClick={() => void signIn("github")}>Connect GitHub</button>
    </div>
  );
}
