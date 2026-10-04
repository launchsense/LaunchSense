import GuestScan from "../features/scan/GuestScan";
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
    </SiteFrame>
  );
}
