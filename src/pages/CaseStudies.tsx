import { SiteFrame } from "../features/site/SiteFrame";

export default function CaseStudies() {
  return (
    <SiteFrame>
      <header className="hero" aria-labelledby="cases-title">
        <h1 id="cases-title">Case studies</h1>
        <p className="lead">
          Five failure patterns from 100 public repos we scanned. Counts only. No repo names, no secret values.
        </p>
      </header>

      <section className="check-section" aria-labelledby="patterns-title">
        <h2 id="patterns-title">The five patterns</h2>
        <ul className="check-list">
          <li>
            <strong>Framework scaffold defaults, committed</strong>
            <p>Tracked signing secrets and scaffold keys turned up across waves, plus one weak committed database password. Liveness was never tested and nothing was executed. Never commit framework-generated secrets. Ignore local secret files and rotate anything already committed.</p>
          </li>
          <li>
            <strong>Expired and test tokens that look live</strong>
            <p>One wave alone held 119 expired scaffold and JWT rows. Expiry was read from text only, never checked against an issuer. Check expiry and audience before treating a token as live.</p>
          </li>
          <li>
            <strong>Placeholder and weak passwords in seeds and demos</strong>
            <p>Change-me, test123, and admin pairs in seed files and compose examples. Containers never ran, so exploitability is unmeasured. Seed files need obviously fake values plus a startup check that refuses defaults.</p>
          </li>
          <li>
            <strong>Tutorial, docs, and fixture tokens that are not leaks</strong>
            <p>Docs examples and tutorial values counted alongside real rows. Two credential families never surfaced at all, so absence there is unmeasured, not clean. Suppress docs, fixtures, vendored, and generated paths before counting leaks.</p>
          </li>
          <li>
            <strong>Placeholder paths that look like findings</strong>
            <p>Thirteen rows pointed at a path that does not exist, all from one license rule. A finding without an openable file and line anchor is not a finding.</p>
          </li>
        </ul>
      </section>

      <section className="check-section" aria-labelledby="method-title">
        <h2 id="method-title">How these were measured</h2>
        <p>
          Offline reviews of depth-1 clones, removed after each wave. No code was changed. Shapes were recorded,
          values never were. Every HIGH and MEDIUM finding was judged against the real file. This page does not
          invent users, logos, or quotes.
        </p>
      </section>
    </SiteFrame>
  );
}
