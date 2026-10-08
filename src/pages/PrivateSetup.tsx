import { SiteFrame } from "../features/site/SiteFrame";

export default function PrivateSetup() {
  return (
    <SiteFrame>
      <header className="hero" aria-labelledby="private-title">
        <p><a href="/notes">Notes</a></p>
        <h1 id="private-title">Make it fully private</h1>
        <p className="lead">
          Three levels, from the default to fully offline. Every step is a command your agent can run. Nothing here is advice about your threat model, it is what each switch does.
        </p>
      </header>

      <section className="check-section" aria-labelledby="default-title">
        <h2 id="default-title">Level 1: the default</h2>
        <p>
          Clone the code, run the installer, answer its two questions. Usage counts stay off unless you say yes.
          The file read defaults to yes and happens on your machine either way.
        </p>
        <pre className="install-command">{`git clone https://github.com/launchsense/LaunchSense
cd LaunchSense && ./install.sh`}</pre>
        <p>Answer no to usage counts. Answer yes to the file read.</p>
      </section>

      <section className="check-section" aria-labelledby="strict-title">
        <h2 id="strict-title">Level 2: stricter</h2>
        <p>
          Answer no to the file read as well. Agent instruction files like AGENTS.md are then listed as not
          checked, never read silently. To lock counts off for every run after this one:
        </p>
        <pre className="install-command">LAUNCHSENSE_DIAGNOSTICS=off sh install.sh</pre>
      </section>

      <section className="check-section" aria-labelledby="offline-title">
        <h2 id="offline-title">Level 3: fully offline</h2>
        <p>
          Disconnect and use only the installed skill copy. The review runs the same fixed checks. The trade is
          honest: online rules stop arriving, so a policy change reaches you only when you reconnect and update.
        </p>
        <pre className="install-command">node --experimental-strip-types mcp/review-entry.ts --root /path/to/myrepo</pre>
        <p>Point root at your repo. Read the report it prints. Nothing leaves the machine at any level.</p>
      </section>
    </SiteFrame>
  );
}
