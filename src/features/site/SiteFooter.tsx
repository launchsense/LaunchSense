export function SiteFooter() {
  return (
    <footer className="home-footer" aria-label="Product details">
      <p>
        <a href="/why">Why</a>, <a href="/how">How</a>, <a href="/start">Start</a>,{" "}
        <a href="/notes">Notes</a>, <a href="/case-studies">Case studies</a>,{" "}
        <a href="/privacy">Privacy</a>, <a href="/data">Data</a>
      </p>
      <p>
        <a href="https://github.com/launchsense/LaunchSense">GitHub</a>. The privacy notice is the data policy: what
        is kept, for how long, and what is never collected.
      </p>
      <p>
        Built by <a href="https://www.withkeshav.com" target="_blank" rel="noreferrer">Keshav Maheshwari</a>.
      </p>
    </footer>
  );
}