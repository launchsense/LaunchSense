import { useState } from "react";
import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { resetLocalAuthState } from "./resetLocalAuthState";
import { buildSignInDecision, saveSignInDecision } from "./signInDecision";
import { SIGN_IN_OFFER, SIGN_IN_NOTICE_VERSION, SIGN_IN_POLICY } from "../../../shared/copy/signIn";

// Four separate purposes, four boxes, all unticked. One box that says "I agree"
// to a paragraph hides three things behind one tick, and the person cannot see
// which one they agreed to. Each purpose below names what leaves, in the words
// the code uses, so a copy change has to be a real change.
//
// Signing in turns on all four. There is no per-purpose switch behind these
// boxes yet, so the page says that instead of pretending each tick is a choice.
//
// These answers now leave the browser. The click persists them and
// ConsentRecorder writes them to the consentRecords table once the OAuth callback
// has made a session, so a signed-in person can read their own answers back.
// A person who signed in before that existed has no row, and none was invented
// for them.
const PURPOSES = [
  {
    id: "token",
    label: "Store my GitHub token so I do not sign in again",
    detail:
      "We keep the token on our server as a plaintext string, and we use it there to read one repository. We never change your code. Signing out from the menu deletes the token. A session that expires on its own does not delete it.",
  },
  {
    id: "read",
    label: "Read one repository on my token",
    detail:
      "The read runs on our server and stops at 1,000 files and about 8MB. We store the repository name, the commit, the file paths, and what we found.",
  },
  {
    id: "explain",
    label: "Explain findings in plain words with an AI provider",
    detail:
      "Only when you press Explain in plain words. We send the finding fingerprint, the severity, the title, and the reason to Google Gemini, then to Ollama Cloud if Gemini does not answer. We never send file contents.",
  },
  {
    id: "usage",
    label: "Send anonymous usage counts from the coding tool connection",
    detail:
      "Rule id counts, the harness name, the version, and how long the run took. No code, no paths, no titles, no email address. This one happens in your coding tool, not on this page.",
  },
] as const;

// Shown only in the cap dialog, while signed out. Signed-in people use Sign out in the menu.
export function AuthPanel() {
  const { signIn } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});

  if (isLoading || isAuthenticated) return null;

  const outstanding = PURPOSES.filter((purpose) => accepted[purpose.id] !== true);
  const ready = outstanding.length === 0;

  return (
    <div className="auth-panel" aria-label="Connect GitHub">
      <p>{SIGN_IN_OFFER}</p>
      <p>{SIGN_IN_POLICY}</p>
      <fieldset>
        <legend>Before you sign in, read what signing in does</legend>
        {PURPOSES.map((purpose) => (
          <div key={purpose.id}>
            <input
              id={`purpose-${purpose.id}`}
              type="checkbox"
              checked={accepted[purpose.id] === true}
              onChange={(event) =>
                setAccepted((current) => ({ ...current, [purpose.id]: event.target.checked }))
              }
            />
            <label htmlFor={`purpose-${purpose.id}`}>{purpose.label}</label>
            <p>{purpose.detail}</p>
          </div>
        ))}
        <p>
          Signing in turns on all four. There is no per-purpose switch behind these boxes yet.
          If you do not want one of them, do not sign in, and ask us at www.withkeshav.com first.
        </p>
        <p>
          <a href="/privacy">Read the privacy notice</a>
        </p>
      </fieldset>
      <button type="button" disabled={!ready} onClick={() => {
        // The click cannot record anything, because the person is anonymous until
        // GitHub sends them back. So the click only persists what they agreed to,
        // and ConsentRecorder writes the rows once there is a session. If the
        // redirect never comes back, nothing is recorded, which is correct: there
        // was no account to record it against.
        saveSignInDecision(
          window.sessionStorage,
          buildSignInDecision({
            noticeVersion: SIGN_IN_NOTICE_VERSION,
            decidedAt: Date.now(),
            purposeIds: PURPOSES.map((purpose) => purpose.id),
            grantedFor: (purposeId) => accepted[purposeId] === true,
          }),
        );
        resetLocalAuthState();
        signIn("github").catch(() => {
          alert("GitHub sign-in could not start. Please refresh and try again.");
        });
      }}>Sign in with GitHub</button>
      {outstanding.length > 0 && (
        <p role="status">
          {outstanding.length} box{outstanding.length === 1 ? "" : "es"} still unticked.
        </p>
      )}
    </div>
  );
}