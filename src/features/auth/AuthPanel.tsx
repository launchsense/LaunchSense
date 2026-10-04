import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { resetLocalAuthState } from "./resetLocalAuthState";
import { SIGN_IN_OFFER, SIGN_IN_POLICY } from "../../../shared/copy/signIn";

// Shown only in the cap dialog, while signed out. Signed-in people use Sign out in the menu.
export function AuthPanel() {
  const { signIn } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();

  if (isLoading || isAuthenticated) return null;

  return (
    <div className="auth-panel" aria-label="Connect GitHub">
      <p>{SIGN_IN_OFFER}</p>
      <p>{SIGN_IN_POLICY}</p>
      <button type="button" onClick={() => {
        resetLocalAuthState();
        signIn("github").catch(() => {
          alert("GitHub sign-in could not start. Please refresh and try again.");
        });
      }}>Sign in with GitHub</button>
    </div>
  );
}
