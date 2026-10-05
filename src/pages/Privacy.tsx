import { SiteFrame } from "../features/site/SiteFrame";

// The privacy policy, at a route a visitor can open. It used to exist only as
// docs/PRIVACY.md in the repository, which no visitor ever reaches, so the
// notice was never actually given. The headings here match that file, and
// tests/privacy-notice-checks.mjs compares them.
//
// The copy is written to what the code does today. Where something is not
// built, the page says so instead of describing it in the present tense. The
// load-bearing facts (the read caps, the snippet cap, the redirect cap, and the
// counter claim) are checked against the code's own constants in
// tests/privacy-notice-checks.mjs. The remaining sentences have no such check,
// so a person must review them when the code around them changes.

export default function Privacy() {
  return (
    <SiteFrame>
      <header className="hero" aria-labelledby="privacy-title">
        <h1 id="privacy-title">Privacy</h1>
        <p className="lead">
          Version 2026-10-05. This is the first version published at this address. The
          same text is in <code>docs/PRIVACY.md</code>. Tests compare the two, so the
          headings and the load-bearing facts cannot drift apart.
        </p>
      </header>

      <section className="check-section" aria-labelledby="who-we-are">
        <h2 id="who-we-are">1. Who we are</h2>
        <p>
          LaunchSense is a code review tool. The maintainer publishes it at www.withkeshav.com.
        </p>
        <p>
          We have not published a registered company name, a registered address, or a named
          data protection officer. We know that a privacy notice without them is incomplete. If
          you need one for a compliance record, ask at www.withkeshav.com and we will add it
          here rather than invent it.
        </p>
      </section>

      <section className="check-section" aria-labelledby="what-you-agree">
        <h2 id="what-you-agree">2. What you agree to when you use this</h2>
        <p>There are three ways in, and each one is a different exchange.</p>
        <ul className="check-list">
          <li>Paste a public repository URL. We read it on our server and store what we found.</li>
          <li>Sign in with GitHub. We use your token on our server to read one repository.</li>
          <li>
            Add the coding tool address from the <a href="/connect">Connect page</a>. Your tool
            asks our server to read one public repository at a time.
          </li>
        </ul>
        <p>
          We do not read your machine in any of the three. We store no copy of your code in our
          database. We never change your code and we never write to your repository.
        </p>
        <p>Nothing on this site is pre-ticked. Every box that asks for a decision starts unticked.</p>
      </section>

      <section className="check-section" aria-labelledby="what-you-paste">
        <h2 id="what-you-paste">3. What you paste, and what we store from it</h2>
        <ul className="check-list">
          <li>Repo owner and name, commit SHA, and file paths.</li>
          <li>Finding records: rule, file, line, and a redacted snippet, capped at 200 characters.</li>
          <li>Per file: its path, size, and a content hash. Nothing more.</li>
          <li>Scan results, so a re-scan of the same commit can be compared against the last one.</li>
        </ul>
        <p>
          Raw secret values are never stored. Every snippet passes through redaction before it
          is written, and the redaction runs before the value can reach storage. File contents
          in any form are never stored. We read them in memory during a scan and keep only the
          numbers above.
        </p>
        <p>A guest read uses the shared GitHub quota and stops at 200 files and about 2MB.</p>
        <p>
          If you give a live app URL, our server makes a plain HTTP request to that address and
          reads the returned HTML. It refuses to contact loopback, private, link-local, or cloud
          metadata addresses, including hostnames that resolve to one. It follows up to three
          redirects and re-checks every hop.
        </p>
        <p>
          Our server fetches public repo data from GitHub, either as a file list or as one
          repository archive. Your browser only sends the URL and shows the results.
        </p>
        <p>
          First-party analytics writes are limited by event kind and day, so the public endpoint
          cannot write an unbounded stream of rows.
        </p>
        <h3>A note on deleted schemas</h3>
        <p>
          Convex does not drop fields from records that already exist. When we removed the
          file-content column, rows written before that change could still carry a copy of the
          file text. The schema no longer has that column, and the purge that deletes stale
          file-content rows runs at the start of every analyze. If we ever remove a field like
          that again, the same purge runs before the change ships.
        </p>
      </section>

      <section className="check-section" aria-labelledby="what-sign-in-stores">
        <h2 id="what-sign-in-stores">4. What we store when you sign in</h2>
        <p>
          Your GitHub token, stored as a plaintext string at rest. It is not encrypted. The token
          is readable only by our server's internal functions. The functions a signed-in user
          can call return a boolean or nothing, never the token.
        </p>
        <p>
          Signing out from the menu deletes the token. The token is not deleted when a session
          expires on its own, so it stays until you sign out. A signed-in read gets a higher cap
          of up to 1,000 files and about 8MB. Scans you run while signed in are linked to your
          account id in our database. The guest scan does not use your token.
        </p>
      </section>

      <section className="check-section" aria-labelledby="what-an-ai-provider-receives">
        <h2 id="what-an-ai-provider-receives">5. What an AI provider receives</h2>
        <p>
          Only when you press the Explain in plain words button. Nothing is sent on any other
          press, and a scan does not send anything to a provider by itself.
        </p>
        <p>
          The request carries a finding fingerprint, the severity, the title, and the reason. It
          does not carry the file path and it does not carry file contents. It goes to Google
          Gemini first, then to Ollama Cloud if Gemini does not answer. If both fail, a fixed
          built-in wording is used and no provider is asked.
        </p>
      </section>

      <section className="check-section" aria-labelledby="what-the-connection-sends">
        <h2 id="what-the-connection-sends">6. What the coding tool connection sends</h2>
        <p>
          The repository URL your tool passes, and nothing from your machine. The tool runs on
          your machine. It asks our server to read one public repository, up to 200 files and
          about 2MB. We store the repository name, the commit, the file paths, and what we
          found.
        </p>
        <p>
          This address needs no account and signs you in to nothing. We keep a rate limit counter
          so the service stays available. It is not linked to an account, and the counter holds
          no part of your network address. Those rows are not deleted automatically today.
        </p>
      </section>

      <section className="check-section" aria-labelledby="fonts-and-browser">
        <h2 id="fonts-and-browser">7. Fonts and what the browser sends without asking</h2>
        <p>
          The site loads two font families from Google Fonts, so your browser contacts Google
          with your IP address before the page finishes drawing. We load no analytics script, no
          chat widget, and no advertising tag.
        </p>
        <p>
          Our own server sees your IP address on every request, as any web server does, and it
          stays in the server logs.
        </p>
      </section>

      <section className="check-section" aria-labelledby="how-long-we-keep">
        <h2 id="how-long-we-keep">8. How long we keep each thing</h2>
        <ul className="check-list">
          <li>
            Cached file metadata: deleted 24 hours after it was written, by a later scan of that
            repository.
          </li>
          <li>OSV vulnerability answers are reused for 7 days and then looked up again.</li>
          <li>
            Findings and evidence: kept so a re-scan can tell you what you fixed. There is no
            automatic deletion today.
          </li>
          <li>Quota counters: a single row, overwritten.</li>
          <li>Rate limit counters: no automatic deletion today, and no network address in them.</li>
          <li>
            Your GitHub token: kept until you sign out from the menu. It is not deleted when the
            session expires.
          </li>
        </ul>
      </section>

      <section className="check-section" aria-labelledby="who-can-see">
        <h2 id="who-can-see">9. Who can see it</h2>
        <p>Us, and four processors, and nobody else.</p>
        <ul className="check-list">
          <li>Convex holds the database and serves the site.</li>
          <li>GitHub serves the repository data we read.</li>
          <li>
            Google Gemini and Ollama Cloud receive the explain request described in section 5,
            and only after you press the button.
          </li>
          <li>Brevo is the intended email provider. No email is sent today.</li>
        </ul>
        <p>
          Our staff can read the database to run the service and to answer a support request.
          Nobody else is given access.
        </p>
      </section>

      <section className="check-section" aria-labelledby="your-choices">
        <h2 id="your-choices">10. Your choices</h2>
        <ul className="check-list">
          <li>Do not paste a URL and nothing is collected.</li>
          <li>Sign out and the token is deleted straight away.</li>
          <li>Do not press Explain in plain words and no provider is asked.</li>
          <li>
            The local review installer asks one question, and the default answer is no. Usage
            counts stay on your machine until you say yes. You can turn them off later with
            <code> LAUNCHSENSE_DIAGNOSTICS=off</code>.
          </li>
        </ul>
        <p>
          What is not built yet: turning off scan history from an account menu, and a Delete my
          data button. Ask at www.withkeshav.com and we do it by hand.
        </p>
      </section>

      <section className="check-section" aria-labelledby="delete-my-data">
        <h2 id="delete-my-data">11. How to delete your data</h2>
        <p>Signing out deletes your GitHub token immediately.</p>
        <p>
          There is no self-service deletion button. Ask at www.withkeshav.com and we delete your
          scans, findings, evidence, projects, and token rows by hand.
        </p>
        <p>
          What we cannot take back: a share link or a passport link you already published stays
          public, because a published link cannot be unpublished. Tell us what you published and
          we will list those links for you first.
        </p>
      </section>

      <section className="check-section" aria-labelledby="complain">
        <h2 id="complain">12. Who to complain to</h2>
        <p>
          In India, the Data Protection Board of India. In the European Union, the data
          protection authority where you live. We would rather you told us first at
          www.withkeshav.com.
        </p>
      </section>

      <section className="check-section" aria-labelledby="changes">
        <h2 id="changes">13. Changes</h2>
        <p>
          Version 2026-10-05, 5 October 2026. This is the first version. It added the /privacy
          route, the footer link, the sign-in purpose boxes, the Connect page disclosure, and the
          default-no question in the local installer. The installer used to write an agreement
          on your behalf before asking anything. It does not any more.
        </p>
      </section>
    </SiteFrame>
  );
}