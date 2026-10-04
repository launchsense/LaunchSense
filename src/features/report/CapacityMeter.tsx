import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

// Live capacity, shown before a scan starts. Users should never discover the
// quota by failing.
export default function CapacityMeter(props: {
  waiting: number;
  running: number;
  quota: {
    remaining: number;
    limit: number;
    resetAt: number;
    scansPerHour: number;
  } | null;
}) {
  const live = useQuery(api.scans.queries.getCapacity, {});
  // A stable per-render clock. Calling Date.now() in render is impure, so the
  // tick counter drives it instead.
  // `now` is written by a timer, never read from the clock during render. That
// keeps the component pure and still lets the reset countdown move.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);

  const quota = live?.quota ?? props.quota;
  const waiting = live?.waiting ?? props.waiting;
  const running = live?.running ?? props.running;
  const limit = live?.limit ?? 6;

  const resetsInMs = quota === null ? null : quota.resetAt - now;
  const low = quota !== null && quota.remaining < Math.max(20, quota.limit * 0.05);
  const exhausted = quota !== null && quota.remaining <= 0;

  return (
    <div aria-label="Scan capacity">
      <h3>Right now</h3>
      <ul>
        <li>
          {running} of {limit} scanning slots busy, {waiting} waiting
          {waiting > 0 && " (this page holds your place while you wait here)"}
        </li>
        {quota === null ? (
          <li>Quota not measured yet. Your first scan will measure it.</li>
        ) : (
          <>
            <li>
              <strong>{quota.scansPerHour}</strong> more scan{quota.scansPerHour === 1 ? "" : "s"}{" "}
              available this hour ({quota.remaining} of {quota.limit} GitHub requests left).
            </li>
            <li>
              Quota resets at {new Date(quota.resetAt).toLocaleTimeString()}, in{" "}
              {resetsInMs === null
                ? "unknown"
                : resetsInMs <= 0
                  ? "under a minute"
                  : `${Math.max(1, Math.round(resetsInMs / 60000))} min`}
              .
            </li>
            {exhausted && (
              <li>
                No quota left right now. Your scan will still run and report
                partial, with the not-checked list telling you what was skipped.
              </li>
            )}
            {low && !exhausted && (
              <li>
                Running low. If a scan comes back partial, that is the quota, not
                your repo.
              </li>
            )}
          </>
        )}
      </ul>
      <p>
        <strong>What to check, in order:</strong> secrets first, then your live
        app, then dependencies and licenses, then repo hygiene. Each scan is
        pinned to one commit, so re-scanning after a fix checks that same
        commit again. Guest scans use a shared quota, so a busy hour can come back partial.
      </p>
      <p>
        If a scan says partial, the not-checked list tells you exactly what was
        skipped. We never report a skipped check as a pass.
      </p>
    </div>
  );
}