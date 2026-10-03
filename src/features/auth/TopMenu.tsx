import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";

// A small top menu. Sign-in is a choice, never the front door.
export function TopMenu() {
  const { signIn, signOut } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();

  return (
    <nav className="top-menu" aria-label="Main menu">
      <a className="brand" href="/">LaunchSense</a>
      <div className="menu-links">
        <a href="https://github.com/launchsense/LaunchSense/blob/main/docs/ROADMAP.md">Roadmap</a>
        <a href="https://github.com/launchsense/LaunchSense">GitHub</a>
        {isLoading ? (
          <span className="auth-state">Checking…</span>
        ) : isAuthenticated ? (
          <button type="button" className="ghost" onClick={() => void signOut()}>Sign out</button>
        ) : (
          <button type="button" className="ghost" onClick={() => {
            signIn("github").catch(() => {
              alert("GitHub sign-in is not configured yet. Please try later.");
            });
          }}>Sign in with GitHub</button>
        )}
      </div>
    </nav>
  );
}
