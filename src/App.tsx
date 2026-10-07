import SharePage from "./pages/SharePage";
import PassportPage from "./pages/PassportPage";
import Home from "./pages/Home";
import Why from "./pages/Why";
import How from "./pages/How";
import Connect from "./pages/Connect";
import BlogIndex from "./pages/BlogIndex";
import CaseStudies from "./pages/CaseStudies";
import WhyPolicy from "./pages/WhyPolicy";
import ResearchPost from "./pages/ResearchPost";
import Privacy from "./pages/Privacy";
import LicencePage from "./pages/LicencePage";

function pagePath(): string {
  const path = typeof window === "undefined" ? "/" : window.location.pathname;
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
}

export default function App() {
  const path = pagePath();

  if (path.startsWith("/s/")) return <SharePage shareId={path.slice(3).split("/")[0] ?? ""} />;
  if (path.startsWith("/p/")) return <PassportPage passportId={path.slice(3).split("/")[0] ?? ""} />;
  if (path === "/why") return <Why />;
  if (path === "/how") return <How />;
  if (path === "/connect") return <Connect />;
  if (path === "/privacy") return <Privacy />;
  if (path === "/licence") return <LicencePage />;
  if (path === "/blog/why-policy") return <WhyPolicy />;
  if (path === "/blog/what-the-research-says") return <ResearchPost />;
  if (path === "/case-studies") return <CaseStudies />;
  if (path === "/blog") return <BlogIndex />;
  return <Home />;
}
