import { useState } from "react";
import { SiteFrame } from "../features/site/SiteFrame";

const MCP_URL = "https://harmless-chihuahua-667.convex.site/mcp";

export default function Connect() {
  const [read, setRead] = useState(false);

  return (
    <SiteFrame>
      <header className="hero" aria-labelledby="connect-title">
        <h1 id="connect-title">Connect the check</h1>
        <p className="lead">
          Add this address. Your tool calls our server. You do not clone this repo. Alpha has no login.
        </p>
      </header>

      <section className="check-section" aria-labelledby="address-title">
        <h2 id="address-title">The address</h2>
        <pre className="install-command">{MCP_URL}</pre>
        <p>Cursor, in <code>~/.cursor/mcp.json</code>:</p>
        <pre className="install-command">{`{
  "mcpServers": {
    "launchsense": {
      "url": "${MCP_URL}"
    }
  }
}`}</pre>
        <p>Claude Code:</p>
        <pre className="install-command">{`claude mcp add launchsense --transport http ${MCP_URL}`}</pre>
      </section>

      <section className="check-section" aria-labelledby="runs-title">
        <h2 id="runs-title">What that connection runs</h2>
        <ul className="check-list">
          <li>The tool <code>launchsense_scan_public</code> reads one public GitHub repo on our server. Same caps as the sample: 200 files and about 2MB.</li>
          <li>Secrets, code shapes, dependency names, license text, project hygiene, duplicate files, and large files.</li>
          <li>OSV for up to 50 packages. The rest stay not checked. deps.dev is not asked.</li>
          <li>The tool <code>launchsense_get_report</code> reads a report by scan id.</li>
          <li>The hosted read keeps 200 scans an hour for the shared hosted bucket, and 600 in total across the hosted lane. Then this route pauses until the window resets. The counter holds no part of your network address.</li>
          <li>A private repo uses Sign in with GitHub on the sample. This address does not read a repo that exists only on your laptop.</li>
        </ul>
        <p>A partial result is not a pass. License lines are signals, not legal advice.</p>
<p>
          A model may reorder the findings inside one severity band, and only when a
          server key for one is configured. It never decides a finding, a severity, a
          licence fact, consent, who a caller is, or whether a request is allowed. Its
          <code>humanOversightLevel</code> is <code>prompt_guided</code> in the C2PA Technical
          Specification 2.4 vocabulary: you asked for the scan and nobody approved the
          order afterwards. We borrow that one word. It is not a C2PA conformance
          claim.
        </p>
      </section>

      <section className="check-section" aria-labelledby="before-title">
        <h2 id="before-title">Before you add this address</h2>
        <p>
          Adding the address lets your coding tool ask our server to read one <strong>public</strong>{" "}
          GitHub repository at a time, up to 200 files and about 2MB.
        </p>
        <p>
          We store the repository name, the commit, the file paths, and what we found. We do not
          read the repository on your machine. We do not read private repositories through this
          address.
        </p>
        <p>
          We do not need an account for this address. We keep a rate limit counter so the
          service stays available. It is not linked to an account, and the counter holds no
          part of your network address.
        </p>
        <p>
          You can send an optional LaunchSense credential in an Authorization header. If you
          do, we store a hash of it and never the credential itself, and the rate limit
          counter holds that credential&apos;s own id so one tool cannot spend another
          tool&apos;s budget. A credential you send that we refuse gets no scan at all.
        </p>
        <p>
          <a href="/privacy">Read the privacy notice</a>
        </p>
        <fieldset>
          <legend>Disclosure</legend>
          <div>
            <input
              id="connect-ack"
              type="checkbox"
              checked={read}
              onChange={(event) => setRead(event.target.checked)}
            />
            <label htmlFor="connect-ack">I have read what this connection does and what it stores.</label>
          </div>
          <p role="status">
            {read
              ? "You ticked the box. It records nothing here and changes nothing on our side."
              : "The box is unticked. You can add the address without ticking it."}
          </p>
          <p>
            This box is a disclosure, not an agreement. The MCP protocol has no place to ask for
            consent, so this page is where we say what the connection does. Ticking it does not
            create an account and does not sign you in. It changes nothing on our side, and you
            can leave it unticked and still add the address.
          </p>
        </fieldset>
      </section>
    </SiteFrame>
  );
}
