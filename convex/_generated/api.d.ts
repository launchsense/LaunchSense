/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as adapters_github from "../adapters/github.js";
import type * as auth from "../auth.js";
import type * as health from "../health.js";
import type * as http from "../http.js";
import type * as scans_actions from "../scans/actions.js";
import type * as scans_internal from "../scans/internal.js";
import type * as scans_queries from "../scans/queries.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "adapters/github": typeof adapters_github;
  auth: typeof auth;
  health: typeof health;
  http: typeof http;
  "scans/actions": typeof scans_actions;
  "scans/internal": typeof scans_internal;
  "scans/queries": typeof scans_queries;
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
