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

      <section className="meaning-section" aria-labelledby="meaning-title">
        <h2 id="meaning-title">What it solves</h2>
        <p>
          You built the app with an AI coding tool. It works. You are about to share the repo. You do not know what to ask, so the check never starts. LaunchSense already knows what to ask. The answer is about the code, not the market.
        </p>
        <ul className="check-list">
          <li>
            <strong>A leaked key</strong>
            <p>A token, a password, or a private key left in a tracked file.</p>
          </li>
          <li>
            <strong>A license that does not fit</strong>
            <p>Missing terms, or copyleft terms, flagged for a person to decide. Not legal advice.</p>
          </li>
          <li>
            <strong>A dependency with a known hole</strong>
            <p>Or a dependency with no fixed version, so tomorrow installs different code.</p>
          </li>
          <li>
            <strong>Risky code</strong>
            <p>Eval, or a database query built from text.</p>
          </li>
          <li>
            <strong>A missing basic</strong>
            <p>No README, no tests, or no CI.</p>
          </li>
          <li>
            <strong>Duplicate files and huge files</strong>
            <p>Repeated functions, and a wider read of code bloat, are the next rules in this same layer. They are not checked yet.</p>
          </li>
        </ul>
        <h3>Why use it</h3>
        <ul>
          <li>You do not need the name of the problem. The report names it.</li>
          <li>The checks are fixed. A model does not invent a finding.</li>
          <li>You leave with a prompt you can paste into Codex, Cursor, or Claude.</li>
          <li>It says what it did not read. A gap is not a pass.</li>
          <li>It does not change your code, and it does not block a deploy.</li>
          <li>After you fix, scan again and see what changed.</li>
        </ul>
        <h3>Rules and the model</h3>
        <p>
          The rules are fixed. They look for a leaked key, a license that needs a person, a dependency with a known hole or no fixed version, risky code, a missing README, tests, or CI, and duplicate or huge files. Repeated functions are not checked yet.
        </p>
        <p>
          A finding can also sit on a standard: OWASP Top 10, OWASP ASVS, OSV, or CWE. That line is a signal with a caveat. It is not a certification.
        </p>
        <p>
          A model does not invent a finding. It may only reorder items that share a severity. If it does not answer, the order is severity and credential risk alone.
        </p>
      </section>

      <section className="scan-section" aria-labelledby="scan-title">
        <h2 id="scan-title">Paste a public repo URL</h2>
        <p>
          No account needed. Guest scans read public repos only and produce a clear partial report when files are skipped.
        </p>
        <GuestScan />
      </section>

      <section className="connect-section" aria-labelledby="connect-title">
        <h2 id="connect-title">Sign in is optional.</h2>
        <p>
          Signing in does not change your scan today. GitHub login is the door for a
          private repo, and that scan is not running yet.
        </p>
        <AuthPanel />
      </section>

      <section className="check-section" aria-labelledby="checks-title">
        <h2 id="checks-title">What the report also shows</h2>
        <ul className="check-list">
          <li>
            <strong>Secrets and risky patterns</strong>
            <p>
              Secrets, risky patterns, eval, SQL shapes, and hardcoded keys are reported
              with proof. Redacted means the secret value is hidden and only the kind of
              finding is shown.
            </p>
          </li>
          <li>
            <strong>Dependencies</strong>
            <p>
              Manifests and lock files are checked for vulnerabilities, unpinned ranges,
              duplicates, and install scripts.
            </p>
          </li>
          <li>
            <strong>Licence</strong>
            <p>
              Missing terms and copyleft-looking language are flagged as legal review,
              not legal advice.
            </p>
          </li>
          <li>
            <strong>Live app</strong>
            <p>
              Optional live URL checks verify HTTPS, response, main action hint, and
              viewport meta. It is not a browser render claim.
            </p>
          </li>
          <li>
            <strong>Progress after a fix</strong>
            <p>
              Re-scan after a fix and compare the commit, so fixed, still broken, new,
              and unknown findings are clear.
            </p>
          </li>
          <li>
            <strong>Share with care</strong>
            <p>
              Share a page that shows counts, titles, and short explanations. It hides
              file paths, line numbers, and code. Links stay live once created, so read
              the page before you send it.
            </p>
          </li>
        </ul>
      </section>

      <section className="limits-section" aria-labelledby="limits-title">
        <h2 id="limits-title">Honest limits</h2>
        <p>
          Guest scans are capped, currently at 200 files and about 2MB. This box reads public repos. A private repo uses GitHub login, and that scan is not running yet. MCP for a private repo is work we will do.
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
    </>
  );
}
