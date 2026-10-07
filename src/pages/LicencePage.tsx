import { SiteFrame } from "../features/site/SiteFrame";
import LicenceScan from "../features/scan/LicenceScan";

// The licence door. It runs the same scan as the home page and renders only
// the licence rows, with a named count of what it did not show.
export default function LicencePage() {
  return (
    <SiteFrame>
      <header className="hero" aria-labelledby="licence-title">
        <h1 id="licence-title">What your repo declares</h1>
        <p className="lead">
          Paste a public GitHub URL. This page reads the licences your lockfile
          declares and names how many other findings it did not show.
        </p>
      </header>
      <LicenceScan />
    </SiteFrame>
  );
}
