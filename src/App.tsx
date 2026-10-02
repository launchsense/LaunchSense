import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import GuestScan from "./features/scan/GuestScan";
import SharePage from "./pages/SharePage";
import PassportPage from "./pages/PassportPage";

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
  const checkConnection = useMutation(api.health.checkConnection);
  const [result, setResult] = useState("");
  const [checking, setChecking] = useState(false);
  async function check() {
    setChecking(true);
    try {
      await checkConnection({});
      setResult("Connection check passed.");
    } catch {
      setResult("Connection check failed. Please try again.");
    } finally { setChecking(false); }
  }
  return <main>
    <p className="eyebrow">LAUNCHSENSE · CHECK BEFORE SHARING</p>
    <h1>Check your app before sharing it.</h1>
    <p>Paste a public repo link. Get a fix list with proof. Share a safe summary.</p>
    <section aria-label="Connection status">
      <p role="status">{health ? "Convex is connected." : "Connecting to Convex…"}</p>
      <button disabled={checking || !health} onClick={() => void check()}>{checking ? "Checking…" : "Check connection"}</button>
      <p role="status">{result}</p>
    </section>
    <GuestScan />
  </main>;
}
