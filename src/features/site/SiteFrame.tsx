import type { ReactNode } from "react";
import { TopMenu } from "../auth/TopMenu";
import { SiteFooter } from "./SiteFooter";

export function SiteFrame({ children }: { children: ReactNode }) {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <TopMenu />
      <main id="main-content" tabIndex={-1} className="home">
        {children}
        <SiteFooter />
      </main>
    </>
  );
}
