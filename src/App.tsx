import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";

export default function App() {
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
    <p className="eyebrow">LAUNCHSENSE · BUILD FOUNDATION</p>
    <h1>Check your app before sharing it.</h1>
    <p>The foundation is connected to Convex. Repository scanning is the next build stage.</p>
    <section aria-label="Connection status">
      <p role="status">{health ? "Convex is connected." : "Connecting to Convex…"}</p>
      <button disabled={checking || !health} onClick={() => void check()}>{checking ? "Checking…" : "Check connection"}</button>
      <p role="status">{result}</p>
    </section>
  </main>;
}
