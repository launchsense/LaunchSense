import { convexAuth } from "@convex-dev/auth/server";

// Skeleton only: enable email magic links after transport and confirmation UI exist.
// Do not enable password, anonymous, or OAuth providers.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [],
});
