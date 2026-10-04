import { SiteFrame } from "../features/site/SiteFrame";

const MCP_URL = "https://harmless-chihuahua-667.convex.site/mcp";

export default function Connect() {
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
          <li>Two scans an hour from one caller, and eight an hour in total. Then this route pauses until the window resets.</li>
          <li>A private repo uses Sign in with GitHub on the sample. This address does not read a repo that exists only on your laptop.</li>
        </ul>
        <p>A partial result is not a pass. License lines are signals, not legal advice.</p>
      </section>
    </SiteFrame>
  );
}
