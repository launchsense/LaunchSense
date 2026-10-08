import { Hero } from "../components/Hero";
import { LocalProofStrip } from "../components/LocalProofStrip";
import { TwoDoors } from "../components/TwoDoors";
import LocalPath from "../features/scan/LocalPath";
import { SiteFrame } from "../features/site/SiteFrame";

export default function Home() {
  return (
    <SiteFrame>
      <Hero
        id="launchsense-title"
        title="LaunchSense already asks."
        lead="For people who just built an app with an AI tool and do not know what to ask before they share it."
        primaryAction={{ href: "/start", label: "Start the check" }}
        secondaryAction={{ href: "/how", label: "How it works" }}
      />

      <LocalProofStrip />

      <TwoDoors small />

      <section className="check-section" id="local" aria-labelledby="local-title">
        <h2 id="local-title">One way. Your machine. No limit.</h2>
        <p>
          LaunchSense audits your repo where it sits, through your coding tool.
          It reads your working tree including work you have not committed, sends
          nothing to us, and has no hourly limit. Same checks, same plain report.
        </p>
        <LocalPath />
        <p>
          <a href="/start">Start here, everything in one place</a>
        </p>
      </section>
    </SiteFrame>
  );
}
