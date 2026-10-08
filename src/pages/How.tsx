import { SiteFrame } from "../features/site/SiteFrame";

export default function How() {
  return (
    <SiteFrame>
      <header className="hero" aria-labelledby="how-title">
        <h1 id="how-title">One way in, on your machine</h1>
        <p className="lead">
          Clone this repo, run the installer, paste one prompt. Your coding tool runs the check where your code sits.
        </p>
      </header>

      <section className="check-section" aria-labelledby="setup-title">
        <h2 id="setup-title">Setup</h2>
        <p>
          <a href="/connect">Connect</a> holds the one setup prompt. Paste it into Cursor, Claude Code, or Codex with your repo open.
        </p>
      </section>

      <section className="check-section" aria-labelledby="run-title">
        <h2 id="run-title">Run</h2>
        <p>
          Ask your tool to audit the repo. The harness reads the rules from the local MCP, guided by the skill, the .ls files, and your agent file.
        </p>
        <p>
          The model writes the audit, coached by that material. Accepted findings go in .ls/policy.yaml with a reason. Reports go in .ls/reports. Both stay on your machine.
        </p>
      </section>

      <section className="check-section" aria-labelledby="caps-title">
        <h2 id="caps-title">Caps</h2>
        <ul className="check-list">
          <li>The local read covers 5,000 files and 40MB in all, 100KB per file.</li>
          <li>OSV covers up to 50 packages. The rest stay not checked.</li>
          <li>A partial result is not a pass.</li>
          <li>Unknown never becomes fixed.</li>
          <li>No file text leaves your machine unless you opt in to anonymous counts.</li>
        </ul>
      </section>
    </SiteFrame>
  );
}
