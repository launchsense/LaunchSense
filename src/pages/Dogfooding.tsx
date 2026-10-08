import { SiteFrame } from "../features/site/SiteFrame";

export default function Dogfooding() {
  return (
    <SiteFrame>
      <header className="hero" aria-labelledby="dogfood-title">
        <p><a href="/blog">Blog</a></p>
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
          We have not scanned 100 repos. There is no such post to write yet, and no case study to claim from it.
          When that run happens, it will measure fix rates across repos with the same triage discipline above, and the
          numbers will land here and on the case studies page.
        </p>
      </section>
    </SiteFrame>
  );
}
