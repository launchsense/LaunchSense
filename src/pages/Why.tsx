import { Hero } from "../components/Hero";
import { SiteFrame } from "../features/site/SiteFrame";

export default function Why() {
  return (
    <SiteFrame>
      <Hero
        id="why-title"
        lead="You used an AI coding tool. The app works. You are new to this, or you have been shipping fast, and you are about to share the repo."
        primaryAction={{ href: "/start", label: "Start the check" }}
        secondaryAction={{ href: "/how", label: "How it works" }}
      >
        <h1 id="why-title">This is for you if you just built it</h1>
      </Hero>

      <section className="check-section" aria-labelledby="who-title">
        <h2 id="who-title">Who it is for</h2>
        <p>
          A vibe coder who does not know the name of the problem. A person new to development who has a working screen and no checklist. The check starts because you do not know what to ask.
        </p>
      </section>

      <section className="check-section" aria-labelledby="names-title">
        <h2 id="names-title">What the check names</h2>
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
            <strong>Risky code, and a missing basic</strong>
            <p>Eval, or a database query built from text. No README, no tests, or no CI.</p>
          </li>
        </ul>
        <p>
          The checks are fixed. A model does not invent a finding. You leave with a prompt your coding tool can take.
        </p>
      </section>

      <section className="check-section" aria-labelledby="wont-title">
        <h2 id="wont-title">What it will not say</h2>
        <p>It does not say if the app will sell. It does not change your code, and it does not block a deploy.</p>
        <p>
          The longer writing is on the <a href="/blog">blog</a>. The steps are on <a href="/how">How</a>.
        </p>
      </section>
    </SiteFrame>
  );
}
