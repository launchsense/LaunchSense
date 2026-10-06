import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

// One question with fixed answers, asked once per report. There is no text
// box on purpose: the analytics rule forbids free text on an analytics row,
// so the reason travels as one of six closed labels, never as typed words.
const REASONS = [
  { value: "found_issue", label: "It found a real issue" },
  { value: "fix_prompt_helped", label: "The fix prompt helped" },
  { value: "too_noisy", label: "Too noisy, mostly false alarms" },
  { value: "confusing", label: "Confusing, hard to act on" },
  { value: "missing_check", label: "Missed something I expected" },
  { value: "other", label: "Something else" },
] as const;

type Reason = (typeof REASONS)[number]["value"];

export default function ReportFeedback(props: { scanId: Id<"scans">; visitorId: string | undefined }) {
  const logEvent = useMutation(api.scans.queries.logEvent);
  const [useful, setUseful] = useState<boolean | null>(null);
  const [reason, setReason] = useState<Reason | null>(null);
  const [sent, setSent] = useState(false);
  if (sent) {
    return <p>Thanks. Your answer is counted, nothing about you is stored.</p>;
  }
  return (
    <div aria-label="Report feedback">
      <p>Was this report useful?</p>
      <button type="button" disabled={useful === true} onClick={() => setUseful(true)}>
        Yes
      </button>{" "}
      <button type="button" disabled={useful === false} onClick={() => setUseful(false)}>
        No
      </button>
      {useful !== null && (
        <label>
          Why?
          <select
            value={reason ?? ""}
            onChange={(event) => setReason(event.target.value === "" ? null : (event.target.value as Reason))}
          >
            <option value="">Pick one</option>
            {REASONS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {useful !== null && reason !== null && (
        <button
          type="button"
          onClick={() => {
            void logEvent({
              kind: "report_feedback",
              scanId: props.scanId,
              visitorId: props.visitorId,
              feedbackUseful: useful,
              feedbackReason: reason,
            });
            setSent(true);
          }}
        >
          Send
        </button>
      )}
    </div>
  );
}
