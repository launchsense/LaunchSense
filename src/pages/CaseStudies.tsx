import { SiteFrame } from "../features/site/SiteFrame";

export default function CaseStudies() {
  return (
    <SiteFrame>
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
    </SiteFrame>
  );
}
