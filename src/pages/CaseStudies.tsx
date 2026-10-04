import { TopMenu } from "../features/auth/TopMenu";
import { SiteFooter } from "../features/site/SiteFooter";

export default function CaseStudies() {
  return (
    <>
      <TopMenu />
      <main id="main-content" tabIndex={-1} className="home">
        <header className="hero" aria-labelledby="cases-title">
          <h1 id="cases-title">Case studies</h1>
          <p className="lead">
            Stories of a real review. None are published yet.
          </p>
        </header>
        <section className="check-section" aria-labelledby="cases-empty">
          <h2 id="cases-empty">None published</h2>
          <p>
            A case study appears here only after a real scan story exists. This page does not invent users, logos, or quotes.
          </p>
        </section>
        <SiteFooter />
      </main>
    </>
  );
}
