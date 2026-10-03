import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import GuestScan from "../features/scan/GuestScan";
import { AuthPanel } from "../features/auth/AuthPanel";
import { TopMenu } from "../features/auth/TopMenu";

const DOCS = {
  howItWorks: "https://github.com/launchsense/LaunchSense/blob/main/docs/HOW-IT-WORKS.md",
  limits: "https://github.com/launchsense/LaunchSense/blob/main/docs/LIMITS.md",
  privacy: "https://github.com/launchsense/LaunchSense/blob/main/docs/PRIVACY.md",
  about: "https://github.com/launchsense/LaunchSense/blob/main/docs/ABOUT.md",
  roadmap: "https://github.com/launchsense/LaunchSense/blob/main/docs/ROADMAP.md",
};

export default function Home() {
  const health = useQuery(api.health.status);
  return (
    <main className="home">
      <TopMenu />
      <header className="hero" aria-labelledby="launchsense-title">
        <p className="eyebrow">LAUNCHSENSE · CHECK BEFORE SHARING</p>
        <h1 id="launchsense-title">Check your public repo before you share it.</h1>
        <p className="lead">
          Paste a repo link. LaunchSense reads what it can, shows proof for every finding, and helps you recheck after a fix.
        </p>
        {health === undefined && <p role="status">Connecting…</p>}
      </header>

      <section className="scan-section" aria-labelledby="scan-title">
        <h2 id="scan-title">Run a guest scan</h2>
        <p>
          No account needed. Guest scans read public repos only and produce a clear partial report when files are skipped.
        </p>
        <GuestScan />
      </section>

      <section className="connect-section" aria-labelledby="connect-title">
        <h2 id="connect-title">Connect only when you want more.</h2>
        <p>
          Sign in with GitHub only when you want a deeper scan or saved history. The guest path stays open.
        </p>
        <AuthPanel />
      </section>

      <section className="check-section" aria-labelledby="checks-title">
        <h2 id="checks-title">What it checks</h2>
        <div className="feature-grid">
          <article>
            <h3>Security</h3>
            <p>Secrets, risky patterns, eval, SQL shapes, and hardcoded keys are reported with redacted proof.</p>
          </article>
          <article>
            <h3>Dependencies</h3>
            <p>Manifests and lock files are checked for vulnerabilities, unpinned ranges, duplicates, and install scripts.</p>
          </article>
          <article>
            <h3>License</h3>
            <p>Missing terms and copyleft-looking language are flagged as legal review, not legal advice.</p>
          </article>
          <article>
            <h3>Live app</h3>
            <p>Optional live URL checks verify HTTPS, response, main action hint, and viewport meta. It is not a browser render claim.</p>
          </article>
          <article>
            <h3>Progress</h3>
            <p>Re-scan after a fix and compare the commit, so fixed, still broken, new, and unknown findings are clear.</p>
          </article>
          <article>
            <h3>Safe share</h3>
            <p>Share a redacted report page and a passport without exposing secrets, tokens, or private details.</p>
          </article>
        </div>
      </section>

      <section className="limits-section" aria-labelledby="limits-title">
        <h2 id="limits-title">Honest limits</h2>
        <p>
          Guest scans are capped, currently at 200 files and about 2MB. Public repos only. Private repositories, deeper reads, monitoring, and MCP are planned or separately permissioned, not forced into the guest path.
        </p>
        <ul>
          <li>Partial result is never a pass.</li>
          <li>Unknown never becomes fixed.</li>
          <li>No raw file contents are stored.</li>
          <li>We do not run a real browser from Convex yet.</li>
        </ul>
      </section>

      <footer className="home-footer" aria-label="Product details">
        <p>
          Read the <a href={DOCS.howItWorks}>how it works</a>,{" "}
          <a href={DOCS.limits}>limits</a>, <a href={DOCS.privacy}>privacy note</a>,{" "}
          <a href={DOCS.about}>about page</a>, and <a href={DOCS.roadmap}>roadmap</a>.
        </p>
      </footer>
    </main>
  );
}
