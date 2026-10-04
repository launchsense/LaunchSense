import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import GuestScan from "../features/scan/GuestScan";
import { TopMenu } from "../features/auth/TopMenu";
import { SiteFooter } from "../features/site/SiteFooter";

export default function Home() {
  const health = useQuery(api.health.status);
  return (
    <>
      <TopMenu />
      <main id="main-content" tabIndex={-1} className="home">
      <header className="hero" aria-labelledby="launchsense-title">
        <h1 id="launchsense-title">LaunchSense checks the codebase, not the business.</h1>
        <p className="lead">
          It looks for problems a vibe coder has no name for, so they never ask Codex. It says what is wrong, in plain words, and gives a prompt to fix it. It does not say if the app will sell.
        </p>
        {health === undefined && <p role="status">Connecting...</p>}
      </header>

      <section className="scan-section" id="scan" aria-labelledby="scan-title">
        <h2 id="scan-title">Paste a public repo URL</h2>
        <p>
          No account needed. Guest scans read public repos only and produce a clear partial report when files are skipped.
        </p>
        <GuestScan />
        <p>
          Guest reads stop at 200 files and about 2MB. A partial result is not a pass. Read the <a href="https://github.com/launchsense/LaunchSense/blob/main/docs/LIMITS.md">limits</a>.
        </p>
      </section>

      <nav className="check-section" aria-label="Why LaunchSense">
        <ul className="check-list">
          <li><a href="/why#why-launchsense">Why LaunchSense</a></li>
          <li><a href="/why#harness">Why it sits next to your coding tool</a></li>
          <li><a href="/why#our-job">Why you do not have to study the policy book</a></li>
        </ul>
      </nav>

      <SiteFooter />
      </main>
    </>
  );
}
