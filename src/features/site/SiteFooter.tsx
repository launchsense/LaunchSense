const DOCS = {
  howItWorks: "https://github.com/launchsense/LaunchSense/blob/main/docs/HOW-IT-WORKS.md",
  limits: "https://github.com/launchsense/LaunchSense/blob/main/docs/LIMITS.md",
  privacy: "https://github.com/launchsense/LaunchSense/blob/main/docs/PRIVACY.md",
  about: "https://github.com/launchsense/LaunchSense/blob/main/docs/ABOUT.md",
  roadmap: "https://github.com/launchsense/LaunchSense/blob/main/docs/ROADMAP.md",
};

export function SiteFooter() {
  return (
    <footer className="home-footer" aria-label="Product details">
      <p>
        Read the <a href={DOCS.howItWorks}>how it works</a>,{" "}
        <a href={DOCS.limits}>limits</a>, <a href={DOCS.privacy}>privacy note</a>,{" "}
        <a href={DOCS.about}>about page</a>, and <a href={DOCS.roadmap}>roadmap</a>.
      </p>
    </footer>
  );
}
