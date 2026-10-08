import { SiteFrame } from "../features/site/SiteFrame";

export default function PrivateSetup() {
  return (
    <SiteFrame>
      <header className="hero" aria-labelledby="private-title">
        <p><a href="/notes">Notes</a></p>
        <h1 id="private-title">Make it fully private</h1>
        <p className="lead">
          The check runs on your machine at every level. This note is about where the rules come from, and how to get the engine without any network at all.
        </p>
      </header>

      <section className="check-section" aria-labelledby="default-title">
        <h2 id="default-title">Level 1: the default</h2>
        <p>
          Install the public repo. It holds the check engine and the skill. The rules come from our policy source over
          the network. Usage counts stay off unless you say yes, and the file read happens on your machine either way.
        </p>
        <pre className="install-command">{`git clone https://github.com/launchsense/LaunchSense
cd LaunchSense && ./install.sh`}</pre>
        <p>Answer no to usage counts. Answer yes to the file read. Your code never leaves the machine.</p>
      </section>

      <section className="check-section" aria-labelledby="strict-title">
        <h2 id="strict-title">Level 2: stricter</h2>
        <p>
          Answer no to the file read as well. Agent instruction files like AGENTS.md are then listed as not checked,
          never read silently. To lock counts off for every run after this one:
        </p>
        <pre className="install-command">LAUNCHSENSE_DIAGNOSTICS=off sh install.sh</pre>
      </section>

      <section className="check-section" aria-labelledby="offline-title">
        <h2 id="offline-title">Level 3: fully local and private</h2>
        <p>
          The public repo gives you the engine. It does not give you the policy and governance engine, which is the part
          that decides what counts as a finding. That part is private.
        </p>
        <p>
          If you want the whole thing on your machine with no policy source and no network at all, ask the creator for
          access to the policy and governance engine. It is for people who need the rules in their own hands, offline,
          with nothing reaching out.
        </p>
        <pre className="install-command">Ask at https://www.withkeshav.com</pre>
        <p>Everything already runs offline on your machine. This only changes where the rules live.</p>
      </section>
    </SiteFrame>
  );
}
