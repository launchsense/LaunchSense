// Website visitor analytics, PostHog, cookieless.
//
// This is the website only. The hosted and local checks count their own work in
// Convex (convex/analytics), and the MCP surface loads no browser script at all.
// Nothing here reads or writes a Convex row.
//
// Cookieless mode is the point: PostHog sets no cookie and writes nothing to
// session or local storage, and it identifies a visitor with a privacy hash it
// computes on its own servers, so we never hold an identifier for a person.
// Session replay, autocapture, surveys, performance capture, and person profiles
// are all off, and only a page view and a page leave are allowed out. A person
// profile or a replay could name someone, so neither is collected.
//
// The key is a public client key. It is read from the build environment, so the
// repository holds no key, and when it is unset the whole module is a no-op.

const ALLOWED_EVENTS = new Set(["$pageview", "$pageleave"]);

const KEY = import.meta.env.VITE_POSTHOG_KEY;
const HOST = import.meta.env.VITE_POSTHOG_HOST || "https://eu.i.posthog.com";

let started = false;

// analyticsEnabled is true only when a public client key is present in the
// build. A missing key disables the counter rather than sending anything.
export function analyticsEnabled(): boolean {
  return typeof KEY === "string" && KEY.startsWith("phc_");
}

// startAnalytics loads and starts PostHog once, and does nothing without a key.
// It is called from the app entry point, so the script is a separate chunk that
// is only fetched when the key is set.
export function startAnalytics(): void {
  if (started || !analyticsEnabled()) {
    return;
  }
  started = true;
  void import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.init(KEY as string, {
        api_host: HOST,
        // No cookie and no browser storage. Identity is a hash PostHog computes
        // on its own servers.
        cookieless_mode: "always",
        persistence: "memory",
        // Count visits, never people.
        person_profiles: "never",
        autocapture: false,
        disable_session_recording: true,
        disable_surveys: true,
        capture_performance: false,
        capture_dead_clicks: false,
        capture_exceptions: false,
        capture_pageview: true,
        capture_pageleave: true,
        // One last gate: nothing but a page view or a page leave is sent,
        // whatever a future option or an autocapture default would add.
        before_send: (event) =>
          event && ALLOWED_EVENTS.has(event.event) ? event : null,
      });
    })
    .catch(() => {
      // Analytics must never break the page. If the script cannot load, the page
      // simply has no counter.
    });
}
