import { SiteFrame } from "../features/site/SiteFrame";

export default function ResearchPost() {
  return (
    <SiteFrame>
      <header className="hero" aria-labelledby="research-title">
        <p><a href="/notes">Notes</a></p>
        <h1 id="research-title">What the research says</h1>
        <p className="lead">
          These studies are not a count of LaunchSense users, and they are not our scan results. They are why a person who just built an app still needs a check.
        </p>
      </header>

      <section className="check-section" aria-labelledby="studies-title">
        <h2 id="studies-title">The studies</h2>
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
    </SiteFrame>
  );
}
