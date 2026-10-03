import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import GuestScan from "./features/scan/GuestScan";
import SharePage from "./pages/SharePage";
import PassportPage from "./pages/PassportPage";

// Docs live in the repo, not in the bundle, so link to the repo rather than
// serving a second copy that can drift.
const DOCS = {
  howItWorks: "https://github.com/withkeshav/LaunchSense/blob/main/docs/HOW-IT-WORKS.md",
  limits: "https://github.com/withkeshav/LaunchSense/blob/main/docs/LIMITS.md",
  privacy: "https://github.com/withkeshav/LaunchSense/blob/main/docs/PRIVACY.md",
  about: "https://github.com/withkeshav/LaunchSense/blob/main/docs/ABOUT.md",
};

export default function App() {
  const path = typeof window === "undefined" ? "/" : window.location.pathname;
  if (path.startsWith("/s/")) {
    return <SharePage shareId={path.slice(3).split("/")[0] ?? ""} />;
  }
  if (path.startsWith("/p/")) {
    return <PassportPage passportId={path.slice(3).split("/")[0] ?? ""} />;
  }

  return <Home />;
}

function Home() {
  const health = useQuery(api.health.status);
  return (
    <main>
      <p className="eyebrow">LAUNCHSENSE · CHECK BEFORE SHARING</p>
      <h1>Check your public repo before you share it.</h1>
      <p>See your code and your live app the way a stranger would. Public repos only.</p>
      {health === undefined && (
        <p role="status">Connecting…</p>
      )}
      <GuestScan />
      <footer aria-label="About this product">
        <p>
          Read the{" "}
          <a href={DOCS.howItWorks}>how it works</a>, the{" "}
          <a href={DOCS.limits}>limits</a>, the <a href={DOCS.privacy}>privacy note</a>, and the{" "}
          <a href={DOCS.about}>about page</a>. The report and docs are public, and the checks are free to use.
        </p>
      </footer>
    </main>
  );
}
