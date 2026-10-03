import { convexAuth } from "@convex-dev/auth/server";
import GitHub from "@auth/core/providers/github";

// Guest scanning works without this module. When GitHub auth variables are
// present, this provider creates one internal user per GitHub account.
// Do not add password, anonymous, or OAuth providers beyond GitHub.
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

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers,
});
