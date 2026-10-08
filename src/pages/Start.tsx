import { Hero } from "../components/Hero";
import { StepRail, type StepItem } from "../components/StepRail";
import { CodeBlock } from "../components/CodeBlock";
import { SiteFrame } from "../features/site/SiteFrame";

const POLICY_URL = "https://harmless-chihuahua-667.convex.site/mcp";

const PASTE_LINE = `Read ${POLICY_URL.replace("/mcp", "/install.txt")} and do everything it says in my open repo. Ask me the two permission questions first and use only my answers.`;

const SETUP_PROMPT = `Set up the local LaunchSense check. Tell it to fetch the code and install, answer no to usage counts and yes to file read, and confirm both server entries are registered. Then read the policy source at ${POLICY_URL} with launchsense_get_skill and launchsense_get_rules, run a local review of my checkout, and show me the report. Nothing is uploaded.`;

const STEPS: StepItem[] = [
  {
    number: 1,
    title: "1. Paste one line",
    id: "step1-title",
    content: (
      <>
        <CodeBlock code={PASTE_LINE} label="paste this into your coding tool" />
        <p>Paste it into your coding tool with your repo open. It fetches the code, installs, and registers both servers by itself.</p>
      </>
    ),
  },
  {
    number: 2,
    title: "2. Answer two questions",
    id: "step2-title",
    content: (
      <>
        <ul className="check-list">
          <li>Send anonymous usage counts? Answer no. This is the default. Nothing leaves your machine.</li>
          <li>Read your project files? Answer yes. This is the default. The read happens on your machine either way.</li>
        </ul>
        <p>
          Say yes to counts only if you want your anonymous rule hits to shape which checks get built next. Most people
          say no, and everything works the same either way. Policy page reads need no permission: they carry no code.
        </p>
      </>
    ),
  },
  {
    number: 3,
    title: "3. Paste the setup prompt",
    id: "step3-title",
    content: (
      <>
        <CodeBlock code={SETUP_PROMPT} label="setup prompt" />
        <p>Paste it into your coding tool with your repo open.</p>
      </>
    ),
  },
  {
    number: 4,
    title: "4. What happens next",
    id: "step4-title",
    content: (
      <>
        <ul className="check-list">
          <li>Your tool reads the rules from the policy source.</li>
          <li>It runs the review against your working tree, including work you have not committed.</li>
          <li>It shows the findings, the coverage line, and the not-checked list as they are.</li>
          <li>
            You confirm each acceptance. It is written to <code>.ls/policy.yaml</code> with your reason, so a later
            review does not raise it again.
          </li>
        </ul>
        <p>A partial result is not a pass.</p>
        <p>Findings come in plain words, ordered, with nothing added or dropped.</p>
      </>
    ),
  },
];

export default function Start() {
  return (
    <SiteFrame>
      <Hero
        id="start-title"
        lead="One page, three steps. Paste one line, answer two questions, read your report. Nothing is uploaded."
      >
        <h1 id="start-title">Start here</h1>
      </Hero>

      <StepRail steps={STEPS} />

      <section className="check-section" aria-labelledby="stuck-title">
        <h2 id="stuck-title">If you get stuck</h2>
        <ul className="check-list">
          <li>Your agent says Node is missing means install Node 24 or newer first.</li>
          <li>Your tool lists no servers means restart the tool and ask again.</li>
          <li>
            The review names the wrong folder means it points at the wrong place. Tell your agent which folder holds
            your repo and ask again.
          </li>
          <li>
            On grok.com only policies load, because a web page cannot reach your machine. Use Grok Build on your
            machine for the file review.
          </li>
        </ul>
        <p>
          Coding agent? Fetch <a href="/install.txt">/install.txt</a> for the full reference.
        </p>
      </section>
    </SiteFrame>
  );
}
