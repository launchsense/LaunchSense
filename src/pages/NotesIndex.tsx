import { SiteFrame } from "../features/site/SiteFrame";

export default function NotesIndex() {
  return (
    <SiteFrame>
      <header className="hero" aria-labelledby="notes-title">
        <h1 id="notes-title">Notes</h1>
        <p className="lead">
          Short notes for the day you want to understand the check. You can ship without reading them.
        </p>
      </header>
      <section className="check-section" aria-labelledby="posts-title">
        <h2 id="posts-title">Notes</h2>
        <ul className="check-list">
          <li>
            <strong>Pinned: <a href="/notes/fully-private">Make it fully private</a></strong>
            <p>Three levels of private, with the commands. The only page that shows clone steps.</p>
          </li>
          <li>
            <strong><a href="/notes/why-policy">Why a policy decision matters before you share</a></strong>
            <p>A license and a leaked key are decisions, even if you never use the word policy.</p>
          </li>
          <li>
            <strong><a href="/notes/what-the-research-says">What the research says</a></strong>
            <p>Studies about AI-written code. They are not a count of LaunchSense users.</p>
          </li>
          <li>
            <strong><a href="/notes/self-scan">LaunchSense on LaunchSense</a></strong>
            <p>Our own measured scan counts and what each one taught us. No customer stories.</p>
          </li>
        </ul>
      </section>
    </SiteFrame>
  );
}
