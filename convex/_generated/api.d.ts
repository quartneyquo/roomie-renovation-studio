/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as budget from "../budget.js";
import type * as crons from "../crons.js";
import type * as files from "../files.js";
import type * as handoff from "../handoff.js";
import type * as http from "../http.js";
import type * as jobs from "../jobs.js";
import type * as providers from "../providers.js";
import type * as rooms from "../rooms.js";
import type * as scenes from "../scenes.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  budget: typeof budget;
  crons: typeof crons;
  files: typeof files;
  handoff: typeof handoff;
  http: typeof http;
  jobs: typeof jobs;
  providers: typeof providers;
  rooms: typeof rooms;
  scenes: typeof scenes;
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

export declare const components: {};
