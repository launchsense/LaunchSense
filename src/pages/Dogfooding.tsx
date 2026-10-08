import { SiteFrame } from "../features/site/SiteFrame";

export default function Dogfooding() {
  return (
    <SiteFrame>
      <header className="hero" aria-labelledby="dogfood-title">
        <p><a href="/notes">Notes</a></p>
        <h1 id="dogfood-title">LaunchSense on LaunchSense</h1>
        <p className="lead">
          We scan this repo with its own review after every change. These are the measured counts and what each one taught us. Nothing here is a customer story.
        </p>
      </header>

      <section className="check-section" aria-labelledby="counts-title">
        <h2 id="counts-title">The measured counts</h2>
        <ul className="check-list">
          <li>
            <strong>136 findings, 730 files read</strong>
            <p>The first scan of the full repo, web scan code included.</p>
          </li>
          <li>
            <strong>107 findings after deleting the web scan</strong>
            <p>29 findings belonged to deleted hosted code. Deleting code deletes its findings. The count drop proved the deletion was real.</p>
          </li>
          <li>
            <strong>952 checks green</strong>
            <p>Typecheck, lint, claim guard, and the full test run pass on every change. A green gate is the receipt, not the work.</p>
          </li>
          <li>
            <strong>28 not-checked lines, quoted every time</strong>
            <p>Skipped trees, capped files, and unqueried lockfiles go back line for line. The list never shrinks because it is inconvenient.</p>
          </li>
        </ul>
      </section>

      <section className="check-section" aria-labelledby="learned-title">
        <h2 id="learned-title">What each count taught us</h2>
        <ul className="check-list">
          <li>
            <strong>Tests pin copy, so docs cannot rot quietly</strong>
            <p>Every promise on the website is asserted by a test against the code it names. A stale doc fails the build instead of aging in place. Writing copy got slower. Trusting copy got cheaper.</p>
          </li>
          <li>
            <strong>Fixtures and findings look alike to a scanner</strong>
            <p>Most findings fire on test fixtures that exist to prove a rule works. Each one is triaged in writing: fixed now, false positive with a reason, or deferred with a reason. A count without triage is noise.</p>
          </li>
          <li>
            <strong>Caps belong in the report, not in a footnote</strong>
            <p>5,000 files and 40MB in all, 100KB per file, OSV for 50 packages. Past a cap, the file is listed as not checked. A partial result is never a pass, and the report says which part is missing.</p>
          </li>
        </ul>
      </section>

      <section className="check-section" aria-labelledby="hundred-title">
        <h2 id="hundred-title">On scanning 100 repos</h2>
        <p>
          In addition to our own repo, we ran the same offline review across 100 public repos in ten waves.
          Depth-1 clones, reviewed and removed. No code was changed. Shapes were recorded, values never were.
        </p>
        <ul className="check-list">
          <li>
            <strong>Hits per wave, as counted</strong>
            <p>Wave counts came back between 12 and 1,285 findings. Volume tracks repo size and ecosystem, not quality. Every HIGH and MEDIUM finding was judged against the real file at the reported line.</p>
          </li>
          <li>
            <strong>No live key verified, with an honest gap</strong>
            <p>No live key was verified in any of the 100. That gap is stated, not hidden: two credential families were never surfaced by the harness, so absence there is unmeasured, not clean. Real non-live literals turned up throughout: scaffold defaults, expired test tokens, seed passwords, and tutorial values.</p>
          </li>
          <li>
            <strong>Precision is the blocker, not recall</strong>
            <p>The credential pattern fires on ordinary code across ecosystems. Eval flags model evaluation calls. Markup rules fire on generated code. License advice appears where a license file already exists. A global per-rule match cap fills silently with these, hiding rows behind them.</p>
          </li>
          <li>
            <strong>Thirteen fabricated rows, one rule bug</strong>
            <p>Thirteen rows pointed at a placeholder path that does not exist, all from one license rule. A reviewer cannot open them. They are counted as fabricated and deferred to a rule fix, not deleted.</p>
          </li>
          <li>
            <strong>The decision table held</strong>
            <p>Measured on development scans, the deterministic table ordered most reports, one provider rung ordered some, the fallback rung was never observed. No rung switch was proposed. No rescan reward was earned, since no repo was scanned twice.</p>
          </li>
        </ul>
        <p>
          Pattern-level stories from these waves, counts only and never names or values, are the only honest
          material for the case studies page. Each one needs explicit approval before it is published there.
        </p>
      </section>
    </SiteFrame>
  );
}
