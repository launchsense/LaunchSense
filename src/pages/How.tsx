import { SiteFrame } from "../features/site/SiteFrame";
import { SIGN_IN_POLICY } from "../../shared/copy/signIn";

export default function How() {
  return (
    <SiteFrame>
      <header className="hero" aria-labelledby="how-title">
        <h1 id="how-title">Two ways in, one check</h1>
        <p className="lead">
          Taste it on this site. Keep it in your coding tool. The tool calls our server. You do not clone this repo.
        </p>
      </header>

      <section className="check-section" aria-labelledby="taste-title">
        <h2 id="taste-title">Taste it here</h2>
        <p>
          Paste a public GitHub URL on the home page. That sample is the same public read as the website. A guest read stops at 200 files and about 2MB.
        </p>
        <p>
          <a href="/#scan">Run a sample check</a>
        </p>
      </section>

      <section className="check-section" aria-labelledby="keep-title">
        <h2 id="keep-title">Keep it in the coding tool</h2>
        <p>
          <a href="/connect">Connect</a> adds the MCP address. Your tool asks LaunchSense to read one public repo. Alpha has no login on that address.
        </p>
        <p>
          The connected call does not read a repo that exists only on your laptop. A private repo, or a larger public read, uses Sign in with GitHub on the sample after the guest cap.
        </p>
      </section>

      <section className="check-section" aria-labelledby="caps-title">
        <h2 id="caps-title">Caps</h2>
        <ul className="check-list">
          <li>A guest read stops at 200 files and about 2MB.</li>
          <li>Signed in, the same check reads up to 1,000 files and about 8MB, including one private repo you can already read.</li>
          <li>A partial result is not a pass.</li>
          <li>Unknown never becomes fixed.</li>
          <li>No raw file contents are stored.</li>
        </ul>
        <p>{SIGN_IN_POLICY}</p>
      </section>
    </SiteFrame>
  );
}
