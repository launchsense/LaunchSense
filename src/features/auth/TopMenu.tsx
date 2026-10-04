import { useState } from "react";
import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";

const LINKS = [
  { href: "/why", label: "Why" },
  { href: "/how", label: "How" },
  { href: "/connect", label: "Connect" },
  { href: "/blog", label: "Blog" },
] as const;

function currentPath(): string {
  const path = typeof window === "undefined" ? "/" : window.location.pathname;
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
}

function isCurrent(path: string, href: string): boolean {
  if (href === "/blog") return path === "/blog" || path.startsWith("/blog/");
  return path === href;
}

export function TopMenu() {
  const { signOut } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const clearGitHubToken = useMutation(api.github.sessionToken.clearMyGitHubToken);
  const path = currentPath();
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  async function signOutAndDropToken() {
    await clearGitHubToken();
    await signOut();
  }

  return (
    <header className="top-menu">
      <a className="brand" href="/">LaunchSense</a>
      <button
        type="button"
        className="text-button menu-toggle"
        aria-expanded={menuOpen}
        aria-controls="site-menu"
        onClick={() => setMenuOpen((open) => !open)}
      >
        Menu
      </button>
      <nav id="site-menu" className={menuOpen ? "menu-links is-open" : "menu-links"} aria-label="Main menu">
        {LINKS.map((link) => (
          <a
            key={link.href}
            href={link.href}
            aria-current={isCurrent(path, link.href) ? "page" : undefined}
            onClick={() => setMenuOpen(false)}
          >
            {link.label}
          </a>
        ))}
        {isLoading ? (
          <span className="auth-state">Checking...</span>
        ) : isAuthenticated ? (
          <span className="account">
            <button
              type="button"
              className="text-button"
              aria-expanded={accountOpen}
              onClick={() => setAccountOpen((open) => !open)}
            >
              Signed in
            </button>
            {accountOpen && (
              <span className="account-panel">
                <button type="button" className="text-button" onClick={() => void signOutAndDropToken()}>
                  Sign out
                </button>
              </span>
            )}
          </span>
        ) : null}
      </nav>
    </header>
  );
}
