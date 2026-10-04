import { TopMenu } from "../features/auth/TopMenu";
import { SiteFooter } from "../features/site/SiteFooter";

export default function BlogIndex() {
  return (
    <>
      <TopMenu />
      <main id="main-content" tabIndex={-1} className="home">
        <header className="hero" aria-labelledby="blog-title">
          <h1 id="blog-title">Blog</h1>
          <p className="lead">
            Plain writing on the decisions a check is making, so you can stay on the product until you want to understand the call.
          </p>
        </header>
        <section className="check-section" aria-labelledby="posts-title">
          <h2 id="posts-title">Posts</h2>
          <ul className="check-list">
            <li>
              <strong><a href="/blog/why-policy">Why a policy decision matters before you share</a></strong>
              <p>
                A license and a leaked key are decisions, even if you never use the word policy.
              </p>
            </li>
          </ul>
        </section>
        <SiteFooter />
      </main>
    </>
  );
}
