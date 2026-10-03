import SharePage from "./pages/SharePage";
import PassportPage from "./pages/PassportPage";
import Home from "./pages/Home";

// The skip link is the first focusable thing on every page, so a keyboard user
// can jump the menu and the scan form straight to the report. The target gets a
// focusable id because a plain anchor target is not always focusable.
export default function App() {
  const path = typeof window === "undefined" ? "/" : window.location.pathname;

  const skip = (
    <a className="skip-link" href="#main-content">
      Skip to content
    </a>
  );

  if (path.startsWith("/s/")) {
    return (
      <>
        {skip}
        <SharePage shareId={path.slice(3).split("/")[0] ?? ""} />
      </>
    );
  }
  if (path.startsWith("/p/")) {
    return (
      <>
        {skip}
        <PassportPage passportId={path.slice(3).split("/")[0] ?? ""} />
      </>
    );
  }

  return (
    <>
      {skip}
      <Home />
    </>
  );
}