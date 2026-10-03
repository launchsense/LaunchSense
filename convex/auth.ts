import { convexAuth } from "@convex-dev/auth/server";
import GitHub from "@auth/core/providers/github";
import Resend from "@auth/core/providers/resend";

// Guest scanning works without this module. When GitHub auth variables are
// present, this provider creates one internal user per GitHub account.
// Resend is optional email delivery only, not a login password.
declare const process: { env: Record<string, string | undefined> };
const providers = [];
if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) {
  providers.push(
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
    }),
  );
}
if (process.env.AUTH_RESEND_KEY && process.env.AUTH_EMAIL_FROM) {
  providers.push(
    Resend({
      apiKey: process.env.AUTH_RESEND_KEY,
      from: process.env.AUTH_EMAIL_FROM,
    }),
  );
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers,
});
