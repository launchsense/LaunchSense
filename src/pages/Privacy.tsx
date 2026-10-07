import { SiteFrame } from "../features/site/SiteFrame";
import { AI_DISCLOSURE_SHORT } from "../../shared/copy/aiDisclosure";

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
          Our server fetches public repo data from GitHub, either as a file list or as one
          repository archive. Your browser only sends the URL and shows the results.
        </p>
        <p>
          First-party analytics writes are limited by event kind and day, so the public endpoint
          cannot write an unbounded stream of rows.
        </p>
        <p>
          Here is the rule our analytics runs on, in plain words. Analytics holds no personal
          information. No email address, no network address, and no free text is written to an
          analytics row. The only label that names anything is the coding tool that sent the
          call, which is a claim about a tool and not about a person. Analytics is allowed two
          identifiers and nothing else. The repository identifier, used for technical purposes
          only: running the scan, linking a rescan, and counting the funnel. And an anonymous
          visitor identifier, which is a random value our server mints, carries no personal
          information, and is used only to count distinct visitors. It cannot name a person, a
          device, or an address. Feedback on a report travels as a yes or no plus one of six
          fixed labels, never as typed words. Every
          other value on an analytics row is a count, a code, a time, or one of a closed set of
          labels.
        </p>
        <p>
          The list of columns behind that rule, field by field, is in{" "}
          <code>convex/analytics/inventory.ts</code>, and a test reads the database schema and
          fails if a column appears there that nobody classified.
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
        <p>
          When you sign in, we write your answers to the four purpose boxes into a table called{" "}
          <code>consentRecords</code> under your account id. Each row holds which purpose it
          was, whether you agreed to it, the version of the wording you read, the time you
          clicked, and the time our server wrote the row. We do not write anything else there: no
          token, no repository name, and no file paths. We do the same thing if you sign in again
          under different wording, so both answers stay on file. There is no export button on this
          site yet. Ask at www.withkeshav.com and we will read your rows back to you, or you can
          run the query against your own session.
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
        <p>{AI_DISCLOSURE_SHORT}</p>
        <p>
          The <code>humanOversightLevel</code> for that call is <code>prompt_guided</code>{" "}
          in the vocabulary of C2PA Technical Specification 2.4: a person pressed the button,{" "}
          and nobody approved the answer afterwards. We borrow that one word. We are not a C2PA
          claim generator, we hold no certificate chain, and this is not a conformance claim.
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
        <p>
          You can send an optional LaunchSense credential in an Authorization header. We keep
          a lookup id in the clear and a SHA-256 hash of the credential, never the credential
          itself, so a copy of our database cannot be replayed against the server. The rate
          limit counter then holds that credential&apos;s own id, which is why one tool cannot
          spend another tool&apos;s budget. Revoking a credential takes effect on the next
          request. A credential that is presented and refused gets no scan, rather than being
          quietly treated as anonymous.
        </p>
      </section>

      <section className="check-section" aria-labelledby="fonts-and-browser">
        <h2 id="fonts-and-browser">7. Fonts and what the browser sends without asking</h2>
        <p>
          The site loads two font families from Google Fonts, so your browser contacts Google
          with your IP address before the page finishes drawing. It also loads one analytics
          script, PostHog, from our own bundle, which counts page views. PostHog runs here in
          cookieless mode: it sets no cookie and writes nothing to your browser's storage, and it
          identifies a visitor with a privacy hash it computes on its own servers, which we never
          see or store. Session replay, click capture, surveys, and person profiles are all off,
          so the count is of visits and not of people. There is no chat widget and no advertising
          tag.
        </p>
        <p>
          Our own server sees your IP address on every request, as any web server does, and it
          stays in the server logs.
        </p>
      </section>

      <section className="check-section" aria-labelledby="how-long-we-keep">
        <h2 id="how-long-we-keep">8. How long we keep each thing</h2>
        <p>
          Every line below names the code that deletes the thing, or says that nothing does. A
          window with no job behind it is stated as a gap rather than as a promise.
        </p>
        <ul className="check-list">
          <li>
            Cached file metadata: deleted after 24 hours by a later scan of that repository.
            The window is <code>CONTENT_CACHE_TTL_MS</code> in <code>convex/scans/analyze.ts</code>,
            and the deletion is <code>purgeStaleContents</code> in <code>convex/scans/store.ts</code>,
            bounded at 500 rows a run.
          </li>
          <li>
            OSV vulnerability answers are reused for 7 days and then looked up again. That is a
            read window, not a purge: nothing deletes the <code>osvCache</code> table.
          </li>
          <li>
            Findings and evidence: kept so a re-scan can tell you what you fixed. There is no
            automatic deletion today.
          </li>
          <li>Quota counters: a single row, overwritten.</li>
          <li>
            Rate limit counters: no automatic deletion today, and no network address in them.
            When a credential resolved, the key holds that credential&apos;s own id.
          </li>
          <li>
            Coding tool usage rows on the hosted address: deleted after 30 days by a later
            nightly job. The window is <code>USAGE_EVENT_TTL_MS</code> in{" "}
            <code>convex/analytics/retention.ts</code> and the job is the{" "}
            <code>purge expired usage events</code> cron at 03:40 UTC, bounded at 500 rows a
            run. The daily counts folded from them are kept, and hold no repository name.
          </li>
          <li>
            Usage counts from the local installer: written to <code>usageDiagnostics</code>{" "}
            only after you answer yes at the install question. That table has no deletion
            window today. Nothing in this repository deletes it. The governance file is
            gitignored, so it is invisible to the hosted scan. Adoption is measured only
            from opted-in local diagnostics.
          </li>
          <li>
            Your GitHub token: kept until you sign out from the menu. It is not deleted when
            the session expires.
          </li>
          <li>
            Sign-in consent records: one row per purpose per account in{" "}
            <code>consentRecords</code>, kept while the account exists. Nothing in this
            repository deletes that table, so a stored decision cannot be taken back from the
            product today. There is no withdrawal button and no route that turns a decision off.
          </li>
          <li>
            Provider call rows from Explain in plain words: kept. Nothing deletes{" "}
            <code>providerCalls</code>.
          </li>
          <li>
            Server request logs: kept by the host, on the host&apos;s own schedule, which we
            neither control nor state.
          </li>
        </ul>
        <p>
          The full list, with the tables and the columns behind each line, is the register in{" "}
          <code>docs/PROCESSING-REGISTER.md</code>.
        </p>
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
          <li>
            The same installer asks a second question, about reading your own project files and
            your agent instruction files, such as AGENTS.md. That one defaults to yes, so it is an
            acknowledgement rather than consent, and it is described that way here and on the
            record. Nothing is uploaded either way: the read happens on your machine. Type no and
            those files are listed as not checked.
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
          scans, findings, evidence, projects, and token rows by hand. We delete your{" "}
          <code>consentRecords</code> rows the same way, on request. We will not quietly edit a
          decision instead: if you want a different answer, the record of the old one stays and
          the new one is written beside it.
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
        <p>
          6 October 2026. Section 4 now says that your answers to the four purpose boxes are
          written to <code>consentRecords</code>, and section 8 says that nothing deletes them.
          Before this, your answers were read by the page, kept in the browser for as long as
          the page was open, and never written down anywhere. Nobody&apos;s past answers have
          been reconstructed, so an account that signed in before this has no row and we did not
          invent one.
        </p>
      </section>
    </SiteFrame>
  );
}