import type { ReactNode } from "react";
import { TopMenu } from "../auth/TopMenu";
import { ConsentRecorder } from "../auth/ConsentRecorder";
import { SiteFooter } from "./SiteFooter";

export function SiteFrame({ children }: { children: ReactNode }) {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <TopMenu />
      {/* Renders nothing. It writes the sign-in decision once the OAuth callback
          has made a session, and the callback can land on any page, so it lives
          here rather than in the sign-in panel that no longer exists. */}
      <ConsentRecorder />
      <main id="main-content" tabIndex={-1} className="home">
        {children}
        <SiteFooter />
      </main>
    </>
  );
}
