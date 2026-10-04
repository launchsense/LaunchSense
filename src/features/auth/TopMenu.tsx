import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { resetLocalAuthState } from "./resetLocalAuthState";

// A small top menu. Sign-in is a choice, never the front door.
function currentPath(): string {
  const path = typeof window === "undefined" ? "/" : window.location.pathname;
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
}

export function TopMenu() {
  const { signIn, signOut } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const clearGitHubToken = useMutation(api.github.sessionToken.clearMyGitHubToken);
  const path = currentPath();

  async function signOutAndDropToken() {
    await clearGitHubToken();
    await signOut();
  }

  return (
    <nav className="top-menu" aria-label="Main menu">
      <a className="brand" href="/">LaunchSense</a>
      <div className="menu-links">
        <a href="/" aria-current={path === "/" ? "page" : undefined}>Check</a>
        <a href="/why" aria-current={path === "/why" ? "page" : undefined}>Why</a>
        <a href="/blog" aria-current={path === "/blog" || path.startsWith("/blog/") ? "page" : undefined}>Blog</a>
        <a href="https://github.com/launchsense/LaunchSense/blob/main/docs/ROADMAP.md">Roadmap</a>
        <a href="https://github.com/launchsense/LaunchSense">GitHub</a>
        {isLoading ? (
          <span className="auth-state">Checking...</span>
        ) : isAuthenticated ? (
          <button type="button" className="ghost" onClick={() => void signOutAndDropToken()}>Sign out</button>
        ) : (
          <button type="button" className="ghost" onClick={() => {
            resetLocalAuthState();
            signIn("github").catch(() => {
              alert("GitHub sign-in could not start. Please refresh and try again.");
            });
          }}>Sign in with GitHub</button>
        )}
      </div>
    </nav>
  );
}
