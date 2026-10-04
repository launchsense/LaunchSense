/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as adapters_ai from "../adapters/ai.js";
import type * as adapters_decision from "../adapters/decision.js";
import type * as adapters_dnsGuard from "../adapters/dnsGuard.js";
import type * as adapters_github from "../adapters/github.js";
import type * as adapters_live from "../adapters/live.js";
import type * as adapters_osv from "../adapters/osv.js";
import type * as adapters_share from "../adapters/share.js";
import type * as adapters_tarball from "../adapters/tarball.js";
import type * as auth from "../auth.js";
import type * as crons from "../crons.js";
import type * as entitlements from "../entitlements.js";
import type * as github_app from "../github/app.js";
import type * as github_readToken from "../github/readToken.js";
import type * as github_sessionToken from "../github/sessionToken.js";
import type * as health from "../health.js";
import type * as http from "../http.js";
import type * as mcpHttp from "../mcpHttp.js";
import type * as mcpLimit from "../mcpLimit.js";
import type * as projects from "../projects.js";
import type * as scans_actions from "../scans/actions.js";
import type * as scans_aiExplain from "../scans/aiExplain.js";
import type * as scans_analyze from "../scans/analyze.js";
import type * as scans_internal from "../scans/internal.js";
import type * as scans_livecheck from "../scans/livecheck.js";
import type * as scans_queries from "../scans/queries.js";
import type * as scans_queue from "../scans/queue.js";
import type * as scans_quota from "../scans/quota.js";
import type * as scans_rankScan from "../scans/rankScan.js";
import type * as scans_rescan from "../scans/rescan.js";
import type * as scans_sharing from "../scans/sharing.js";
import type * as scans_store from "../scans/store.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "adapters/ai": typeof adapters_ai;
  "adapters/decision": typeof adapters_decision;
  "adapters/dnsGuard": typeof adapters_dnsGuard;
  "adapters/github": typeof adapters_github;
  "adapters/live": typeof adapters_live;
  "adapters/osv": typeof adapters_osv;
  "adapters/share": typeof adapters_share;
  "adapters/tarball": typeof adapters_tarball;
  auth: typeof auth;
  crons: typeof crons;
  entitlements: typeof entitlements;
  "github/app": typeof github_app;
  "github/readToken": typeof github_readToken;
  "github/sessionToken": typeof github_sessionToken;
  health: typeof health;
  http: typeof http;
  mcpHttp: typeof mcpHttp;
  mcpLimit: typeof mcpLimit;
  projects: typeof projects;
  "scans/actions": typeof scans_actions;
  "scans/aiExplain": typeof scans_aiExplain;
  "scans/analyze": typeof scans_analyze;
  "scans/internal": typeof scans_internal;
  "scans/livecheck": typeof scans_livecheck;
  "scans/queries": typeof scans_queries;
  "scans/queue": typeof scans_queue;
  "scans/quota": typeof scans_quota;
  "scans/rankScan": typeof scans_rankScan;
  "scans/rescan": typeof scans_rescan;
  "scans/sharing": typeof scans_sharing;
  "scans/store": typeof scans_store;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting">;
};
