import { SiteFrame } from "../features/site/SiteFrame";

const POLICY_URL = "https://harmless-chihuahua-667.convex.site/mcp";

const SETUP_PROMPT = `Set up the local LaunchSense check from https://github.com/launchsense/LaunchSense. Clone it if it is not on this machine, run ./install.sh from its root, answer no to usage counts and yes to file read, and confirm both server entries are registered. Then read the policy source at ${POLICY_URL} with launchsense_get_skill and launchsense_get_rules, run a local review of my checkout, and show me the report. Nothing is uploaded.`;

const EXISTING_CURSOR_BLOCK = `    "launchsense": {
      "command": "node",
      "args": ["/path/to/LaunchSense/mcp/server.ts"],
      "env": {
        "LAUNCHSENSE_ROOT": "/path/to/myrepo",
        "LAUNCHSENSE_REVIEW": "/path/to/LaunchSense/mcp/review-entry.ts"
      }
    },
    "launchsense-policy": {
      "url": "${POLICY_URL}"
    }`;

export default function Start() {
  return (
    <SiteFrame>
      <header className="hero" aria-labelledby="start-title">
        <h1 id="start-title">Start here</h1>
        <p className="lead">
          One page, six steps. Local reads your files. Online serves the policies. Nothing is uploaded.
        </p>
      </header>

      <section className="check-section" aria-labelledby="step1-title">
        <h2 id="step1-title">1. Check Node</h2>
        <pre className="install-command">node --version</pre>
        <p>You need version 24 or newer. If the command is missing, install Node from nodejs.org, then check again.</p>
      </section>

      <section className="check-section" aria-labelledby="step2-title">
        <h2 id="step2-title">2. Clone and install</h2>
        <pre className="install-command">{`git clone https://github.com/launchsense/LaunchSense
cd LaunchSense && ./install.sh`}</pre>
        <p>On Windows, run it from Git Bash. The script copies the skill into your coding tools and asks two questions.</p>
      </section>

      <section className="check-section" aria-labelledby="step3-title">
        <h2 id="step3-title">3. Answer two questions</h2>
        <ul className="check-list">
          <li>Send anonymous usage counts? Answer no. This is the default. Nothing leaves your machine.</li>
          <li>Read your project files? Answer yes. This is the default. The read happens on your machine either way.</li>
        </ul>
      </section>

      <section className="check-section" aria-labelledby="step4-title">
        <h2 id="step4-title">4. Register the two servers in your tool</h2>
        <p>
          Two entries. <code>launchsense</code> reads your files on this machine. <code>launchsense-policy</code> serves
          skill, rules, checklists, and audit instructions only, never a scan. Replace the example paths with your own.
        </p>
        <h3>Cursor</h3>
        <p>The installer writes both entries into <code>~/.cursor/mcp.json</code> for you. If that file already existed, it was left alone. Open it and add the two entries inside its <code>mcpServers</code> object:</p>
        <pre className="install-command">{EXISTING_CURSOR_BLOCK}</pre>
        <h3>Claude Code</h3>
        <pre className="install-command">{`claude mcp add --env LAUNCHSENSE_ROOT=/path/to/myrepo --env LAUNCHSENSE_REVIEW=/path/to/LaunchSense/mcp/review-entry.ts --transport stdio launchsense -- node /path/to/LaunchSense/mcp/server.ts`}</pre>
        <pre className="install-command">{`claude mcp add --transport http launchsense-policy ${POLICY_URL}`}</pre>
        <h3>Codex</h3>
        <p>Add both blocks to <code>~/.codex/config.toml</code>:</p>
        <pre className="install-command">{`[mcp_servers.launchsense]
command = "node"
args = ["/path/to/LaunchSense/mcp/server.ts"]
[mcp_servers.launchsense.env]
LAUNCHSENSE_ROOT = "/path/to/myrepo"
LAUNCHSENSE_REVIEW = "/path/to/LaunchSense/mcp/review-entry.ts"

[mcp_servers.launchsense-policy]
url = "${POLICY_URL}"`}</pre>
        <h3>OpenCode</h3>
        <p>Add both blocks to <code>opencode.json</code> in your project root:</p>
        <pre className="install-command">{`{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "launchsense": {
      "type": "local",
      "command": ["node", "/path/to/LaunchSense/mcp/server.ts"],
      "enabled": true,
      "environment": {
        "LAUNCHSENSE_ROOT": "/path/to/myrepo",
        "LAUNCHSENSE_REVIEW": "/path/to/LaunchSense/mcp/review-entry.ts"
      }
    },
    "launchsense-policy": {
      "type": "remote",
      "url": "${POLICY_URL}",
      "enabled": true
    }
  }
}`}</pre>
        <h3>Antigravity</h3>
        <p>Add both blocks to the <code>mcpServers</code> object in <code>~/.gemini/config/mcp_config.json</code>:</p>
        <pre className="install-command">{`  "launchsense": {
    "command": "node",
    "args": ["/path/to/LaunchSense/mcp/server.ts"],
    "env": {
      "LAUNCHSENSE_ROOT": "/path/to/myrepo",
      "LAUNCHSENSE_REVIEW": "/path/to/LaunchSense/mcp/review-entry.ts"
    }
  },
  "launchsense-policy": {
    "serverUrl": "${POLICY_URL}"
  }`}</pre>
        <h3>Grok</h3>
        <p>On grok.com, only the policy address can be added. Open connectors, choose New Connector, then Custom, and paste the policy URL. Your files stay unread there, because a web page cannot reach your machine. For the file review, use Grok Build on your machine with both entries in <code>~/.grok/config.toml</code>:</p>
        <pre className="install-command">{`[mcp_servers.launchsense]
command = "node"
args = ["/path/to/LaunchSense/mcp/server.ts"]
[mcp_servers.launchsense.env]
LAUNCHSENSE_ROOT = "/path/to/myrepo"
LAUNCHSENSE_REVIEW = "/path/to/LaunchSense/mcp/review-entry.ts"

[mcp_servers.launchsense-policy]
url = "${POLICY_URL}"`}</pre>
        <h3>Another tool</h3>
        <p>Point any stdio entry at <code>node /path/to/LaunchSense/mcp/server.ts</code> with <code>LAUNCHSENSE_ROOT</code> set to your repo. Or skip MCP and run the review directly:</p>
        <pre className="install-command">node /path/to/LaunchSense/mcp/server.ts</pre>
        <pre className="install-command">node --experimental-strip-types /path/to/LaunchSense/mcp/review-entry.ts --root /path/to/myrepo</pre>
      </section>

      <section className="check-section" aria-labelledby="step5-title">
        <h2 id="step5-title">5. Paste the setup prompt</h2>
        <pre className="install-command">{SETUP_PROMPT}</pre>
        <p>Paste it into your coding tool with your repo open.</p>
      </section>

      <section className="check-section" aria-labelledby="step6-title">
        <h2 id="step6-title">6. What happens next</h2>
        <ul className="check-list">
          <li>Your tool reads the rules from the policy source.</li>
          <li>It runs the review against your working tree, including work you have not committed.</li>
          <li>It shows the findings, the coverage line, and the not-checked list as they are.</li>
          <li>You confirm each acceptance. It is written to <code>.ls/policy.yaml</code> with your reason, so a later review does not raise it again.</li>
        </ul>
        <p>A partial result is not a pass.</p>
      </section>

      <section className="check-section" aria-labelledby="stuck-title">
        <h2 id="stuck-title">If you get stuck</h2>
        <ul className="check-list">
          <li><code>node: command not found</code> means install Node 24 or newer first.</li>
          <li>The installer prints nothing about servers means it could not start Node. See step 1.</li>
          <li>Your tool lists no servers means restart the tool after editing its config.</li>
          <li>The review names the wrong folder means <code>LAUNCHSENSE_ROOT</code> points at the wrong place. Point it at your repo root and ask again.</li>
        </ul>
      </section>
    </SiteFrame>
  );
}
