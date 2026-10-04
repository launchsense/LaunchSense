import { convexAuth } from "@convex-dev/auth/server";
import GitHub from "@auth/core/providers/github";
import Resend from "@auth/core/providers/resend";
import { writeScanToken } from "./github/sessionToken";

// Guest scanning works without this module. When GitHub auth variables are
// present, this provider creates one internal user per GitHub account.
// Resend is optional email delivery only, not a login password.
//
// Repository contents are read-only. This login is a GitHub App, so Contents:
// Read is set on the app, not by an OAuth write scope. A classic `repo` scope
// would include write, so it is not requested.
declare const process: { env: Record<string, string | undefined> };

type GitHubProfile = {
  id?: string | number;
  name?: string | null;
  login?: string;
  email?: string | null;
  avatar_url?: string;
};

type TokenBundle = { access_token?: string };

const providers = [];
if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) {
  providers.push(
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
      authorization: { params: { scope: "read:user user:email" } },
      profile(profile: GitHubProfile, tokens?: TokenBundle) {
        const id = profile.id;
        const accessToken = tokens?.access_token;
        return {
          id: id === undefined ? "" : String(id),
          name: profile.name ?? profile.login,
          email: profile.email ?? undefined,
          image: profile.avatar_url,
          scanToken: typeof accessToken === "string" && accessToken.length > 0 ? accessToken : undefined,
        };
      },
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
  callbacks: {
    async createOrUpdateUser(ctx, args) {
      const raw = args.profile;
      const scanToken = typeof raw["scanToken"] === "string" ? raw["scanToken"] : undefined;
      const name = typeof raw["name"] === "string" ? raw["name"] : undefined;
      const email = typeof raw["email"] === "string" ? raw["email"] : undefined;
      const image = typeof raw["image"] === "string" ? raw["image"] : undefined;
      const userData: {
        name?: string;
        email?: string;
        image?: string;
        emailVerificationTime?: number;
      } = {};
      if (name !== undefined) userData.name = name;
      if (email !== undefined) userData.email = email;
      if (image !== undefined) userData.image = image;
      if (args.type === "oauth" && email !== undefined) userData.emailVerificationTime = Date.now();

      let userId = args.existingUserId ?? null;
      if (userId !== null) {
        await ctx.db.patch("users", userId, userData);
      } else {
        userId = await ctx.db.insert("users", userData);
      }
      if (scanToken !== undefined) {
        await writeScanToken(ctx, userId, scanToken);
      }
      return userId;
    },
  },
});
