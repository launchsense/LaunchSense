import { useState } from "react";

const LINKS = [
  { href: "/why", label: "Why" },
  { href: "/how", label: "How" },
  { href: "/start", label: "Start" },
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

// Archived sign-in: the menu holds no account state. Sign-in existed only to
// read a private repo for the web scan, so it went with it.
export function TopMenu() {
  const path = currentPath();
  const [menuOpen, setMenuOpen] = useState(false);

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
      </nav>
    </header>
  );
}
