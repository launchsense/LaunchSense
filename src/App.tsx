import SharePage from "./pages/SharePage";
import PassportPage from "./pages/PassportPage";
import Home from "./pages/Home";

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
