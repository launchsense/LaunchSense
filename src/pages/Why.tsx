import { TopMenu } from "../features/auth/TopMenu";
import { SiteFooter } from "../features/site/SiteFooter";
import { SIGN_IN_POLICY } from "../../shared/copy/signIn";

export default function Why() {
  return (
    <>
      <TopMenu />
      <main id="main-content" tabIndex={-1} className="home">
        <header className="hero" aria-labelledby="why-title">
          <h1 id="why-title">Why LaunchSense</h1>
          <p className="lead">
            <a href="/#scan">Paste a public repo</a>
          </p>
        </header>

        <section className="check-section" id="why-launchsense" aria-labelledby="why-launchsense-title">
          <h2 id="why-launchsense-title">You do not need the name of the problem</h2>
          <p>
            You built the app with an AI coding tool. It works. You are about to share the repo. You do not know what to ask, so the check never starts.
          </p>
          <p>
            LaunchSense already knows what to ask. The checks are fixed. You leave with a prompt your coding tool can take. The report says what it did not read. It does not say if the app will sell.
          </p>
          <h3>What it solves</h3>
          <ul className="check-list">
            <li>
              <strong>A leaked key</strong>
              <p>A token, a password, or a private key left in a tracked file.</p>
            </li>
            <li>
              <strong>A license that does not fit</strong>
              <p>Missing terms, or copyleft terms, flagged for a person to decide. Not legal advice.</p>
            </li>
            <li>
              <strong>A dependency with a known hole</strong>
              <p>Or a dependency with no fixed version, so tomorrow installs different code.</p>
            </li>
            <li>
              <strong>Risky code</strong>
              <p>Eval, or a database query built from text.</p>
            </li>
            <li>
              <strong>A missing basic</strong>
              <p>No README, no tests, or no CI.</p>
            </li>
            <li>
              <strong>Duplicate files and huge files</strong>
              <p>Repeated functions, and a wider read of code bloat, are the next rules in this same layer. They are not checked yet.</p>
            </li>
          </ul>
          <h3>Why use it</h3>
          <ul>
            <li>You do not need the name of the problem. The report names it.</li>
            <li>The checks are fixed. A model does not invent a finding.</li>
            <li>You leave with a prompt you can paste into Codex, Cursor, or Claude.</li>
            <li>It says what it did not read. A gap is not a pass.</li>
            <li>It does not change your code, and it does not block a deploy.</li>
            <li>After you fix, scan again and see what changed.</li>
          </ul>
          <h3>Rules and the model</h3>
          <p>
            The rules are fixed. They look for a leaked key, a license that needs a person, a dependency with a known hole or no fixed version, risky code, a missing README, tests, or CI, and duplicate or huge files. Repeated functions are not checked yet.
          </p>
          <p>
            A finding can also sit on a standard: OWASP Top 10, OWASP ASVS, OSV, or CWE. That line is a signal with a caveat. It is not a certification.
          </p>
          <p>
            A model does not invent a finding. It may only reorder items that share a severity. If it does not answer, the order is severity and credential risk alone.
          </p>
        </section>

        <section className="check-section" id="harness" aria-labelledby="harness-title">
          <h2 id="harness-title">Why this sits next to your coding tool</h2>
          <p>
            The harness is the loop you already build in: Cursor, Codex, or Claude. It is not a plugin.
          </p>
          <p>
            The agent writes the product. A scanner that speaks in rule names gets closed. LaunchSense is the check before you share. Paste the repo. Copy one prompt. Scan again.
          </p>
          <p>
            A skill in the chat can read a repo. It still falls short. It runs only when you open a chat. It keeps no shared memory of the last check. It gives you no link a reviewer can open. It does not keep a fixed count of what was not read.
          </p>
          <p>
            A coding tool review that reads the files on your machine is not running yet. The report names Cursor, Codex, or Claude only when the repo shows that tool.
          </p>
          <p>
            We do not edit the repo. The prompt goes back into the same tool.
          </p>
        </section>

        <section className="check-section" id="our-job" aria-labelledby="our-job-title">
          <h2 id="our-job-title">Policy, checks, and standards are our job</h2>
          <p>
            You do not want to spend the evening on policy, checks, and standards. That book is our job.
          </p>
          <p>
            You stay on the product you are vibe coding. The report names one thing, in plain words, and hands you a prompt. You do not have to become the security team to ship the next version.
          </p>
          <p>
            The same words are how you get better. We hold the check now. The <a href="/blog/why-policy">blog</a> is there for the day you want to understand the decision yourself.
          </p>
        </section>

        <section className="check-section" id="questions" aria-labelledby="questions-title">
          <h2 id="questions-title">A few questions</h2>
          <h3>Why LaunchSense, not another chat with my coding tool?</h3>
          <p>
            The chat only runs when you know what to ask. This check already knows, and it lists what it did not read.
          </p>
          <h3>Why do I need it in the harness?</h3>
          <p>
            That is where the next line gets written. The prompt goes back into the same tool. We do not edit the repo.
          </p>
          <h3>Do I have to learn OWASP, licenses, and the rest first?</h3>
          <p>
            No. We run those checks. A standard line is a signal with a caveat. It is not a certification.
          </p>
          <h3>Does signing in read more of my repo?</h3>
          <p>
            Yes. A guest read stops at 200 files and about 2MB. Signed in, the same check reads up to 1,000 files and about 8MB, including one private repo you can already read. {SIGN_IN_POLICY}
          </p>
        </section>

        <section className="check-section" id="research" aria-labelledby="research-title">
          <h2 id="research-title">What the research says</h2>
          <p>
            These studies are not a count of LaunchSense users, and they are not our scan results.
          </p>
          <ul className="check-list">
            <li>
              <strong>More people are building with AI tools</strong>
              <p>
                In the Stack Overflow Developer Survey 2025, 84% of respondents use or plan to use AI tools in development, up from 76% in 2024. 51% of professional developers use them daily. 46% say they do not trust the accuracy of AI output, up from 31%.
                {" "}
                <a href="https://survey.stackoverflow.co/2025/ai/">Survey</a>
                {" "}
                and
                {" "}
                <a href="https://stackoverflow.co/company/press/archive/stack-overflow-2025-developer-survey/">press note</a>.
              </p>
            </li>
            <li>
              <strong>New people are learning to code with AI</strong>
              <p>
                44% of people learning to code used AI tools to learn, up from 37% in 2024.
                {" "}
                <a href="https://stackoverflow.blog/2025/12/29/developers-remain-willing-but-reluctant-to-use-ai-the-2025-developer-survey-results-are-here/">Stack Overflow</a>.
              </p>
            </li>
            <li>
              <strong>Most professional work is not called vibe coding</strong>
              <p>
                Nearly 77% said vibe coding is not part of their professional work. New people are arriving. Most professional developers do not describe their job that way.
                {" "}
                <a href="https://stackoverflow.co/company/press/archive/stack-overflow-2025-developer-survey/">Stack Overflow press note</a>.
              </p>
            </li>
            <li>
              <strong>AI pull requests carried more issues</strong>
              <p>
                CodeRabbit, December 2025, looked at 470 open-source pull requests. 320 were AI co-authored and 150 were human only. The AI ones had 10.83 issues each. The human ones had 6.45. That is about 1.7 times more.
                {" "}
                <a href="https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report">CodeRabbit</a>.
              </p>
            </li>
            <li>
              <strong>Models still miss known security issues in a lab task</strong>
              <p>
                Veracode, 2025, tested more than 100 models on 80 coding tasks in four languages. In 45% of tasks the sample failed a security test and introduced an OWASP Top 10 issue. Newer models were not clearly better at this.
                {" "}
                <a href="https://www.veracode.com/blog/genai-code-security-report/">Veracode</a>.
              </p>
            </li>
            <li>
              <strong>More secrets landed in public GitHub in 2025</strong>
              <p>
                GitGuardian counted 28.65 million new hardcoded secrets in public GitHub commits in 2025, up 34% from the year before. Leaked credentials for AI services rose 81%, to 1,275,105. Commits co-authored with Claude Code leaked secrets at about 3.2%, about twice a 1.5% baseline.
                {" "}
                <a href="https://www.gitguardian.com/state-of-secrets-sprawl-report-2026">GitGuardian</a>.
              </p>
            </li>
          </ul>
          <p>
            CodeRabbit reviewed pull requests that went through CodeRabbit. Veracode scored single functions written with no extra security guidance. GitGuardian counts public GitHub, and the Claude Code rate is one assistant for one year.
          </p>
        </section>

        <section className="check-section" aria-labelledby="checks-title">
          <h2 id="checks-title">What the report also shows</h2>
          <ul className="check-list">
            <li>
              <strong>Secrets and risky patterns</strong>
              <p>
                Secrets, risky patterns, eval, SQL shapes, and hardcoded keys are reported
                with proof. Redacted means the secret value is hidden and only the kind of
                finding is shown.
              </p>
            </li>
            <li>
              <strong>Dependencies</strong>
              <p>
                Manifests and lock files are checked for vulnerabilities, unpinned ranges,
                duplicates, and install scripts.
              </p>
            </li>
            <li>
              <strong>Licence</strong>
              <p>
                Missing terms and copyleft-looking language are flagged as legal review,
                not legal advice.
              </p>
            </li>
            <li>
              <strong>Live app</strong>
              <p>
                Optional live URL checks verify HTTPS, response, main action hint, and
                viewport meta. It is not a browser render claim.
              </p>
            </li>
            <li>
              <strong>Progress after a fix</strong>
              <p>
                Re-scan after a fix and compare the commit, so fixed, still broken, new,
                and unknown findings are clear.
              </p>
            </li>
            <li>
              <strong>Share with care</strong>
              <p>
                Share a page that shows counts, titles, and short explanations. It hides
                file paths, line numbers, and code. Links stay live once created, so read
                the page before you send it.
              </p>
            </li>
          </ul>
        </section>

        <section className="limits-section" aria-labelledby="limits-title">
          <h2 id="limits-title">Honest limits</h2>
          <p>
            The public paste is the free check. It reads a public repo, up to 200 files and about 2MB.
            Sign in to read one private repo, or more of a public one, up to 1,000 files and about 8MB.
          </p>
          <p>
            {SIGN_IN_POLICY} A coding tool review that reads the files on your machine is not running yet.
          </p>
          <ul>
            <li>Partial result is never a pass.</li>
            <li>Unknown never becomes fixed.</li>
            <li>No raw file contents are stored.</li>
            <li>We do not run a real browser from Convex yet.</li>
          </ul>
          <p>
            <a href="/#scan">Paste a public repo</a>
          </p>
        </section>

        <SiteFooter />
      </main>
    </>
  );
}
