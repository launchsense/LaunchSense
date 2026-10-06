import GuestScan from "../features/scan/GuestScan";
import LocalPath from "../features/scan/LocalPath";
import { SiteFrame } from "../features/site/SiteFrame";

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
          <a className="button" href="/connect">Connect the check</a>
          <a href="/how">How it works</a>
        </p>
      </header>
      <section className="scan-section" id="scan" aria-labelledby="scan-title">
        <h2 id="scan-title">Taste it on a public repo</h2>
        <GuestScan />
        <p>The sample is a short public read. The check you keep is <a href="/connect">Connect</a>.</p>
      </section>
      <section className="check-section" id="local" aria-labelledby="local-title">
        <h2 id="local-title">Or run it on your own machine, with no limit</h2>
        <p>
          The sample above is a shared hosted read, so it can pause. The local check runs on
          your machine, reads your working tree including work you have not committed, sends
          nothing to us, and has no hourly limit. Same checks, same plain report.
        </p>
        <LocalPath />
        <p><a href="/connect">Both connections, in one place</a></p>
      </section>
    </SiteFrame>
  );
}
