import LocalPath from "../features/scan/LocalPath";
import { SiteFrame } from "../features/site/SiteFrame";

const POLICY_URL = "https://harmless-chihuahua-667.convex.site/mcp";

const SETUP_PROMPT = `Set up the local LaunchSense check from https://github.com/launchsense/LaunchSense. Clone it if it is not on this machine, run ./install.sh from its root, answer its two questions as I tell you, and confirm the launchsense server entry points LAUNCHSENSE_ROOT at my checkout. Then read the policy source at ${POLICY_URL} with launchsense_get_skill and launchsense_get_rules, run a local review of my checkout, and show me the report. Nothing is uploaded.`;

export default function Home() {
  return (
    <SiteFrame>
      <header className="hero" aria-labelledby="launchsense-title">
        <p className="lead">
          For people who just built an app with an AI tool and do not know what to ask before they share it.
        </p>
        <p className="beat-early beat-1">You built it.</p>
        <p className="beat-early beat-2">You do not know what to ask.</p>
        <h1 className="beat" id="launchsense-title">LaunchSense already asks.</h1>
        <p className="home-actions">
          <a className="button" href="/connect">Run it on your machine</a>
          <a href="/how">How it works</a>
        </p>
      </header>
      <section className="check-section" id="local" aria-labelledby="local-title">
        <h2 id="local-title">One way. Your machine. No limit.</h2>
        <p>
          LaunchSense audits your repo where it sits, through your coding tool.
          It reads your working tree including work you have not committed, sends
          nothing to us, and has no hourly limit. Same checks, same plain report.
        </p>
        <LocalPath />
      </section>
      <section className="check-section" id="copy" aria-labelledby="copy-title">
        <h2 id="copy-title">Copy this into your coding tool</h2>
        <pre className="install-command">{SETUP_PROMPT}</pre>
        <p>
          Paste it into Cursor, Claude Code, or Codex with your repo open.
          Then ask it to audit the repo.
        </p>
        <p><a href="/connect">Local setup in one place</a></p>
      </section>
    </SiteFrame>
  );
}
