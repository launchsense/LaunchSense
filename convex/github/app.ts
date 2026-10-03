"use node";

// The Convex Node runtime has these globals; Convex TypeScript does not supply them.
declare const process: { env: Record<string, string | undefined> };
declare const Buffer: {
  from(input: Uint8Array | string, encoding?: string): { toString(encoding: string): string };
};

type CreateSign = {
  update(data: string): CreateSign;
  sign(privateKey: string, encoding: string): string;
};
declare function require(name: string): {
  createSign: (algorithm: string) => CreateSign;
};
const { createSign } = require("node:crypto");

import { internalAction } from "../_generated/server";
import { v } from "convex/values";

// A GitHub App installation token proves that we may read the repositories
// explicitly installed by the user. It is minted per scan, never stored, and
// never returned to the browser.
export const getInstallationToken = internalAction({
  args: { installationId: v.string() },
  returns: v.object({
    token: v.string(),
    expiresAt: v.string(),
    permissions: v.array(v.string()),
  }),
  handler: async (_, args) => {
    const appId = process.env.GITHUB_APP_ID;
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
    if (!appId || !privateKey) {
      throw new Error("GitHub App ID or private key is not configured.");
    }

    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }),
    ).toString("base64url");
    const signature = createSign("RSA-SHA256")
      .update(`${header}.${payload}`)
      .sign(privateKey, "base64url");
    const jwt = `${header}.${payload}.${signature}`;

    const response = await fetch(`https://api.github.com/app/installations/${args.installationId}/access_tokens`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "launchsense",
        "Content-Length": "0",
      },
    });
    const body = (await response.json()) as {
      token?: string;
      expires_at?: string;
      permissions?: Record<string, string>;
    };
    if (!response.ok || typeof body.token !== "string") {
      throw new Error(`GitHub App installation token request failed with ${response.status}`);
    }
    return {
      token: body.token,
      expiresAt: body.expires_at ?? "",
      permissions: Object.keys(body.permissions ?? {}),
    };
  },
});
