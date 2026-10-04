import { SiteFrame } from "../features/site/SiteFrame";

export default function WhyPolicy() {
  return (
    <SiteFrame>
      <header className="hero" aria-labelledby="policy-title">
        <p><a href="/blog">Blog</a></p>
        <h1 id="policy-title">Why a policy decision matters before you share</h1>
        <p className="lead">
          You built it in a chat. A license and a leaked key are still decisions, even if you never use the word policy.
        </p>
      </header>

      <section className="check-section" aria-labelledby="policy-meaning">
        <h2 id="policy-meaning">A policy is a rule you will stand behind</h2>
        <p>
          A policy is a rule you are willing to stand behind. What may ship. What must be flagged. What stays unknown.
        </p>
        <p>
          A license is one rule. A key left in a file is another. OWASP, ASVS, OSV, and CWE are maps. A line on the report is a signal. It is not a certification, and it is not a verdict that the product will sell.
        </p>
        <p>
          If nobody writes the rule down, the coding tool fills the gap with whatever it usually writes. The builder never sees that a choice was made.
        </p>
      </section>

      <section className="check-section" aria-labelledby="license-example">
        <h2 id="license-example">A missing license is a decision</h2>
        <p>
          This is a real check. If no license signals are found, the report flags it for a person. It is not legal advice.
        </p>
        <p>
          Accepting it means you are sharing without stated terms. That is a decision, even if you never use the word policy.
        </p>
      </section>

      <section className="check-section" aria-labelledby="key-example">
        <h2 id="key-example">A leaked key is a decision</h2>
        <p>
          This is a real check. A token, a password, or a private key left in a tracked file is reported. Redacted means the secret value is hidden and only the kind of finding is shown.
        </p>
        <p>
          Leaving it in the repo means anyone who can read the file can use it.
        </p>
      </section>

      <section className="check-section" aria-labelledby="policy-close">
        <h2 id="policy-close">You can learn the call later</h2>
        <p>
          You do not have to hold this book in your head while you build. LaunchSense runs the check and gives you one prompt.
        </p>
        <p>
          When you want to understand the call, this is the place. The point of the writing is the later stage, when you can say yes or no on purpose.
        </p>
        <p>
          <a href="/#scan">Run a sample check</a>
        </p>
      </section>
    </SiteFrame>
  );
}
