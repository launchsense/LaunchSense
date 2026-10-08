import { Hero } from "../components/Hero";
import { StepRail, type StepItem } from "../components/StepRail";
import { SiteFrame } from "../features/site/SiteFrame";

const FLOW_STEPS: StepItem[] = [
  {
    number: 1,
    title: "1. Install",
    id: "step-install-title",
    content: (
      <p>
        Tell your agent to fetch the code and run the installer. It registers the local MCP server and the online
        policy source in your coding tool. The how is in <a href="/start">Start</a>.
      </p>
    ),
  },
  {
    number: 2,
    title: "2. Read rules online",
    id: "step-rules-title",
    content: (
      <p>
        Your coding harness reads the latest policies and checklists directly from the online policy source, guided by the skill. It processes no code on our servers.
      </p>
    ),
  },
  {
    number: 3,
    title: "3. Review runs locally",
    id: "step-review-title",
    content: (
      <p>
        The review executes on your machine against your checkout working tree, including uncommitted work. Nothing is uploaded.
      </p>
    ),
  },
  {
    number: 4,
    title: "4. Report",
    id: "step-report-title",
    content: (
      <p>
        The findings, coverage line, and not-checked list are written to <code>.ls/reports/</code> and presented in your chat.
      </p>
    ),
  },
  {
    number: 5,
    title: "5. Accept findings",
    id: "step-accept-title",
    content: (
      <p>
        Confirm any accepted finding. It is saved to <code>.ls/policy.yaml</code> with your reason so later reviews respect your decision.
      </p>
    ),
  },
];

export default function How() {
  return (
    <SiteFrame>
      <Hero
        id="how-title"
        lead="Run one installer, paste one prompt. Your coding tool runs the check where your code sits."
        primaryAction={{ href: "/start", label: "Start the check" }}
      >
        <h1 id="how-title">One way in, on your machine</h1>
      </Hero>

      <StepRail steps={FLOW_STEPS} />

      <section className="check-section" aria-labelledby="caps-title">
        <h2 id="caps-title">Caps</h2>
        <ul className="check-list">
          <li>The local read covers 5,000 files and 40MB in all, 100KB per file.</li>
          <li>OSV covers up to 50 packages. The rest stay not checked.</li>
          <li>A partial result is not a pass.</li>
          <li>Unknown never becomes fixed.</li>
          <li>No file text leaves your machine unless you opt in to anonymous counts.</li>
        </ul>
      </section>
    </SiteFrame>
  );
}
