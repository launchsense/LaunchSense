// Writes the sign-in decisions this tab persisted, once there is a session.
//
// The person clicks Sign in, GitHub sends them back, and only then does a user id
// exist. Until then the click could only persist what they agreed to. This is the
// half that puts it in the database.
//
// Three things it will not do:
//
//   1. It records nothing when nothing was persisted. A person who signed in before
//      this existed, or who abandoned the redirect, gets no row, because a record
//      of a decision this product cannot point at would be a fiction.
//   2. It runs only when isAuthenticated is true. A Convex mutation with no
//      session is refused by the server anyway, and refusing here means nothing
//      is attempted and nothing is logged as a failure.
//   3. It renders nothing. There is no consent banner, no cookie notice, and no
//      second prompt. The record is written in the background or not at all.
//
// Mounted in SiteFrame rather than in the panel, because the panel is unmounted
// the moment the person is authenticated and the callback can land on any page.
// StrictMode runs an effect twice in development; the mutation upserts, so a
// second call updates the same rows instead of duplicating them.

import { useEffect, useRef } from "react";
import { useConvexAuth } from "@convex-dev/auth/react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { recordPendingDecision } from "./signInDecision";

export function ConsentRecorder() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const recordSignInDecisions = useMutation(api.consent.recordSignInDecisions);
  // Set once a decision has been sent, so a re-render or a second effect run does
  // not send it again. It is cleared when the send fails, because the persisted
  // decision is still there and the next attempt is the retry.
  const attempted = useRef(false);

  useEffect(() => {
    if (isLoading || !isAuthenticated || attempted.current) return;
    attempted.current = true;
    void recordPendingDecision(window.sessionStorage, recordSignInDecisions).then((outcome) => {
      if (outcome === "recording failed") attempted.current = false;
    });
  }, [isAuthenticated, isLoading, recordSignInDecisions]);

  return null;
}