import { SiteFrame } from "../features/site/SiteFrame";
import { AI_DISCLOSURE_WITH_LEVEL } from "../../shared/copy/aiDisclosure";

const POLICY_URL = "https://harmless-chihuahua-667.convex.site/mcp";

const SETUP_PROMPT = `Set up the local LaunchSense check from https://github.com/launchsense/LaunchSense. Clone it if it is not on this machine, run ./install.sh from its root, answer its two questions as I tell you, and confirm the launchsense server entry points LAUNCHSENSE_ROOT at my checkout. Then read the policy source at ${POLICY_URL} with launchsense_get_skill and launchsense_get_rules, run a local review of my checkout, and show me the report. Nothing is uploaded.`;

export default function Connect() {
  return (
    <SiteFrame>
      <header className="hero" aria-labelledby="connect-title">
        <h1 id="connect-title">Run it on your machine</h1>
        <p className="lead">
          Clone this repo, run one script, paste one prompt. Your tool does the rest. Nothing is uploaded.
        </p>
      </header>

      <section className="check-section" aria-labelledby="copy-title">
        <h2 id="copy-title">The setup prompt</h2>
        <pre className="install-command">{SETUP_PROMPT}</pre>
        <p>Paste it into Cursor, Claude Code, or Codex with your repo open.</p>
      </section>

      <section className="check-section" aria-labelledby="install-title">
        <h2 id="install-title">What the installer does</h2>
        <pre className="install-command">{`git clone https://github.com/launchsense/LaunchSense
cd LaunchSense && ./install.sh`}</pre>
        <ul className="check-list">
          <li>Installs the skill into your coding tool.</li>
          <li>Registers the local MCP server and points it at your repo. The local server reads your files.</li>
          <li>Registers the policy source. The policy source serves skill, rules, checklists, and audit instructions only, never a scan.</li>
          <li>Asks two questions. Usage counts default to no. File read defaults to yes.</li>
          <li>Needs Node 24 or newer on PATH. Without it the installer says so and registers nothing.</li>
        </ul>
      </section>

      <section className="check-section" aria-labelledby="doors-title">
        <h2 id="doors-title">Two addresses, two jobs</h2>
        <p>
          Local reads the files. Online serves the policies. Your tool reads the rules from online,
          guided by the skill, and the model writes the audit locally.
        </p>
        <pre className="install-command">{POLICY_URL}</pre>
        <p>The policy source answers five tools: skill, rules, checklist, audit instructions, and version. It takes no arguments and stores no code. A call is counted, with no gate.</p>
      </section>

      <section className="check-section" aria-labelledby="runs-title">
        <h2 id="runs-title">What that setup runs</h2>
        <ul className="check-list">
          <li>The review reads your working tree, including work you have not committed.</li>
          <li>Secrets, code shapes, dependency names, license text, project hygiene, duplicate files, and large files.</li>
          <li>OSV for up to 50 packages. The rest stay not checked.</li>
          <li>Accepted findings go in .ls/policy.yaml with a reason. Reports go in .ls/reports. Both stay on your machine.</li>
          <li>No hourly limit. Nothing is sent to us unless you opt in to anonymous counts.</li>
        </ul>
        <p>A partial result is not a pass. License lines are signals, not legal advice.</p>
        <p>{AI_DISCLOSURE_WITH_LEVEL}</p>
        <p>
          The <code>humanOversightLevel</code> is <code>prompt_guided</code>. It never decides a finding, a severity, a licence fact, consent, who a caller is, or whether a request is allowed.
        </p>
      </section>
    </SiteFrame>
  );
}
