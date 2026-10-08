import Home from "./pages/Home";
import Start from "./pages/Start";
import Why from "./pages/Why";
import How from "./pages/How";
import NotesIndex from "./pages/NotesIndex";
import PrivateSetup from "./pages/PrivateSetup";
import Dogfooding from "./pages/Dogfooding";
import CaseStudies from "./pages/CaseStudies";
import WhyPolicy from "./pages/WhyPolicy";
import ResearchPost from "./pages/ResearchPost";
import Privacy from "./pages/Privacy";
import { SiteFrame } from "./features/site/SiteFrame";

function Archived() {
  return (
    <SiteFrame>
      <h1>Archived</h1>
      <p>This page is archived. LaunchSense now runs on your machine only.</p>
      <p><a href="/">Run the local check</a></p>
    </SiteFrame>
  );
}

function pagePath(): string {
  const path = typeof window === "undefined" ? "/" : window.location.pathname;
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
}

export default function App() {
  const path = pagePath();

  if (path.startsWith("/s/")) return <Archived />;
  if (path.startsWith("/p/")) return <Archived />;
  if (path === "/start") return <Start />;
  if (path === "/why") return <Why />;
  if (path === "/how") return <How />;
  if (path === "/connect") return <Archived />;
  if (path === "/privacy") return <Privacy />;
  if (path === "/licence") return <Archived />;
  if (path === "/blog/why-policy") return <Archived />;
  if (path === "/blog/what-the-research-says") return <Archived />;
  if (path === "/blog/fully-private") return <Archived />;
  if (path === "/blog/self-scan") return <Archived />;
  if (path === "/blog") return <Archived />;
  if (path === "/notes/why-policy") return <WhyPolicy />;
  if (path === "/notes/what-the-research-says") return <ResearchPost />;
  if (path === "/notes/fully-private") return <PrivateSetup />;
  if (path === "/notes/self-scan") return <Dogfooding />;
  if (path === "/case-studies") return <CaseStudies />;
  if (path === "/notes") return <NotesIndex />;
  return <Home />;
}
