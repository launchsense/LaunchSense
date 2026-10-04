import SharePage from "./pages/SharePage";
import PassportPage from "./pages/PassportPage";
import Home from "./pages/Home";
import Why from "./pages/Why";
import BlogIndex from "./pages/BlogIndex";
import CaseStudies from "./pages/CaseStudies";
import WhyPolicy from "./pages/WhyPolicy";

// The skip link is the first focusable thing on every page, so a keyboard user
// can jump the menu and the scan form straight to the report. The target gets a
// focusable id because a plain anchor target is not always focusable.
function pagePath(): string {
  const path = typeof window === "undefined" ? "/" : window.location.pathname;
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
}

export default function App() {
  const path = pagePath();

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
  if (path === "/why") {
    return (
      <>
        {skip}
        <Why />
      </>
    );
  }
  if (path === "/blog/why-policy") {
    return (
      <>
        {skip}
        <WhyPolicy />
      </>
    );
  }
  if (path === "/case-studies") {
    return (
      <>
        {skip}
        <CaseStudies />
      </>
    );
  }
  if (path === "/blog") {
    return (
      <>
        {skip}
        <BlogIndex />
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