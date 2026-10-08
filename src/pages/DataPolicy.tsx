import { SiteFrame } from "../features/site/SiteFrame";

export default function DataPolicy() {
  return (
    <SiteFrame>
      <header className="hero" aria-labelledby="data-title">
        <h1 id="data-title">Data policy</h1>
        <p className="lead">
          Every place your data can sit, what sits there, and for how long. Each line names the code behind it.
        </p>
      </header>

      <section className="check-section" aria-labelledby="local-data">
        <h2 id="local-data">1. On your machine</h2>
        <p>
          The review reads your working tree: 5,000 files and 40MB in all, 100KB per file. It writes acceptances to{" "}
          <code>.ls/policy.yaml</code> and report copies to <code>.ls/reports/</code>. Both stay on your machine and
          stay out of git.
        </p>
        <p>File contents are read in memory and never uploaded. Raw secret values are never written anywhere.</p>
      </section>

      <section className="check-section" aria-labelledby="policy-calls">
        <h2 id="policy-calls">2. Policy calls</h2>
        <p>
          Each call to the policy source writes one row holding the method and the outcome: which tool ran and whether
          it worked. No arguments, no results, no code, no paths, no network address. The counter holds no part of
          your network address.
        </p>
        <p>Those rows are deleted after 30 days by a nightly job. The rolled-up daily counts are kept, and they hold no repository name.</p>
      </section>

      <section className="check-section" aria-labelledby="opt-in-counts">
        <h2 id="opt-in-counts">3. Opted-in counts</h2>
        <p>
          Only if you answer yes at install. The share carries rule id counts, the harness name, the version, how long
          the review took, and which order source ran. No code, no paths, no titles, no function names. Turn them off
          later with <code>LAUNCHSENSE_DIAGNOSTICS=off</code>.
        </p>
      </section>

      <section className="check-section" aria-labelledby="visitors">
        <h2 id="visitors">4. Website visitors</h2>
        <p>
          Page views pass through PostHog, cookieless, with no identity held. Session replay, click capture, surveys,
          and person profiles are all off. Anonymous visitor rows expire after 30 days. Folded distinct counts persist.
        </p>
      </section>

      <section className="check-section" aria-labelledby="choices">
        <h2 id="choices">5. Your choices</h2>
        <ul className="check-list">
          <li>Do not answer yes and nothing is collected from the review.</li>
          <li>Answer no to the file read and agent instruction files are listed as not checked.</li>
          <li>No account exists anywhere, so there is nothing to sign out of and no profile to delete.</li>
          <li>Ask at www.withkeshav.com and stored rows are deleted by hand.</li>
        </ul>
        <p>
          What is not built yet: a self-service deletion button. There is no automatic deletion today for opted-in
          diagnostic counts.
        </p>
      </section>
    </SiteFrame>
  );
}
