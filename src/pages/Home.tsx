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
          This page is the first look. The review you keep using runs in your coding tool, on the files already there. <a href="#install">Install that review</a>.
        </p>
        <p>
          No account needed. Guest scans read public repos only and produce a clear partial report when files are skipped.
        </p>
        <GuestScan />
        <p>
          Guest reads stop at 200 files and about 2MB. A partial result is not a pass. Read the <a href="https://github.com/launchsense/LaunchSense/blob/main/docs/LIMITS.md">limits</a>.
        </p>
      </section>

      <section className="check-section" id="install" aria-labelledby="install-title">
        <h2 id="install-title">Install the review on your machine</h2>
        <p>
          The box above is the public paste. It does not run the extra checks. Those run after you install the review into your coding tool. The review reads files already on your machine. It does not download GitHub. Alpha has no login.
        </p>
        <p>From a checkout of the repo:</p>
        <pre className="install-command">{`git clone https://github.com/launchsense/LaunchSense.git
cd LaunchSense
sh install.sh`}</pre>
        <p>
          That installs one command and one skill, <code>launchsense</code>. The script is{" "}
          <a href="https://github.com/launchsense/LaunchSense/blob/main/install.sh">install.sh</a>.
        </p>
        <h3>What the installed review checks</h3>
        <ul className="check-list">
          <li>Secrets, code shapes, dependency names, license text, and project hygiene. The paste on this page runs these too.</li>
          <li>An npm lockfile, with direct and transitive packages listed apart. A missing lockfile stays incomplete.</li>
          <li>OSV for up to 50 of those exact versions. The rest are listed as not queried.</li>
          <li>deps.dev, then ClearlyDefined if that is empty: terms, a publish date, and a deprecated flag. Archived status stays unknown.</li>
          <li>Repeated function text, duplicate files, a named host, a model card, and a generated marker.</li>
          <li>Unknown stays unknown. A model may quote one next look. That quote is not a finding.</li>
        </ul>
        <p>A partial result is not a pass. License lines are signals, not legal advice.</p>
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
