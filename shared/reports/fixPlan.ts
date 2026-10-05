// Deterministic Fix Before You Share plan. Groups findings by rule, orders
// secrets first, and puts every finding either in an ordered step or in an
// explicit not-actionable bucket. No AI wording: plain template text only.

import type { Severity } from "../policies/severity";

export interface PlanFinding {
  ruleId: string;
  path: string;
  severity: Severity;
  title: string;
}

export interface FixStep {
  order: number;
  ruleId: string;
  title: string;
  why: string;
  files: string[];
  checklist: string[];
}

export interface FixPlan {
  steps: FixStep[];
  notActionable: PlanFinding[];
}

const STEP_TEXT: Record<string, { title: string; why: string; checklist: string[] }> = {
  "secret.tracked-env": {
    title: "Remove tracked environment files from git",
    why: "Anyone with repo access can read everything in a tracked .env file.",
    checklist: [
      "Copy real values out of git into a local .env that stays untracked.",
      "Keep only template names in .env.example with placeholder values.",
      "Remove the tracked file from git history or rotate every value it held.",
    ],
  },
  "secret.private-key": {
    title: "Remove private keys and rotate them",
    why: "A committed private key must be treated as public from that moment on.",
    checklist: [
      "Revoke the exposed key wherever it was registered.",
      "Generate a fresh key and store it outside the repository.",
      "Confirm no backup copy of the old key remains tracked.",
    ],
  },
  "secret.github-token": {
    title: "Revoke the exposed GitHub token",
    why: "Tokens in tracked files can be used by anyone who can read the repo.",
    checklist: [
      "Revoke the token in GitHub settings.",
      "Issue a replacement with the smallest scope that works.",
      "Move the replacement into untracked local config or a secret store.",
    ],
  },
  "secret.aws-key": {
    title: "Revoke the exposed cloud key",
    why: "Automated scanners harvest committed cloud keys within minutes.",
    checklist: [
      "Deactivate the key in the cloud console and create a replacement.",
      "Move the replacement out of the repository.",
      "Check billing and audit logs for unexpected use.",
    ],
  },
  "secret.credential-pattern": {
    title: "Move hardcoded credentials out of code",
    why: "Passwords and API keys in source travel everywhere the code goes.",
    checklist: [
      "Replace each value with an environment lookup.",
      "Rotate every credential that was committed.",
      "Add the pattern to your pre-commit checks.",
    ],
  },
  "secret.client-exposure": {
    title: "Remove secrets shipped to browsers",
    why: "Anything in public files or pages is visible to every visitor.",
    checklist: [
      "Move the secret to a server-only call.",
      "Rotate the exposed value.",
      "Confirm the built site no longer contains it.",
    ],
  },
  "secret.eval-use": {
    title: "Replace eval with a safe alternative",
    why: "Eval runs strings as code and turns small injections into full control.",
    checklist: [
      "Replace eval with JSON parsing or a lookup table.",
      "Remove the call and re-test the surrounding feature.",
    ],
  },
  "secret.debugger-statement": {
    title: "Remove debugger statements",
    why: "A debugger statement freezes the app for anyone who opens it.",
    checklist: [
      "Delete every debugger statement.",
      "Open the app once after removing them to confirm nothing hangs.",
    ],
  },
  "secret.debug-leftover": {
    title: "Clean up debug output",
    why: "Console noise leaks internals and looks unfinished to anyone reviewing.",
    checklist: ["Remove console noise, keeping one intentional error log per failure path."],
  },
  "secret.sql-pattern": {
    title: "Check the query shape",
    why: "The line matches SELECT ... FROM. That does not prove injection.",
    checklist: ["Read the flagged line.", "Use a parameter if the query is built from text."],
  },
  "code.eval-use": {
    title: "Review eval calls",
    why: "Eval turns text into code. This is the shape of a call, not proof it is reachable.",
    checklist: ["Find the eval call.", "Replace it if the string is not fully trusted."],
  },
  "code.debugger-statement": {
    title: "Remove debugger statements",
    why: "A debugger statement can freeze the app for anyone who opens it.",
    checklist: ["Delete the debugger statement."],
  },
  "code.debug-leftover": {
    title: "Clean up debug output",
    why: "Console output can leak internals.",
    checklist: ["Remove console noise you do not mean to ship."],
  },
  "code.sql-pattern": {
    title: "Check the query shape",
    why: "The line matches SELECT ... FROM. That does not prove injection.",
    checklist: ["Read the flagged line.", "Use a parameter if the query is built from text."],
  },
  "code.inner-html": {
    title: "Review innerHTML assignments",
    why: "Assigning innerHTML can run markup as HTML.",
    checklist: ["Confirm the value is not attacker-controlled."],
  },
  "code.child-process": {
    title: "Review child process exec calls",
    why: "exec passes a string to a shell. This review did not run it.",
    checklist: ["Prefer execFile with an argument list when a shell is not required."],
  },
  "code.weak-crypto": {
    title: "Review weak hash or cipher calls",
    why: "md5, sha1, or createCipher showed up as a call.",
    checklist: ["Use a current hash or cipher if this protects a secret."],
  },
  "code.cors-wildcard": {
    title: "Review the CORS wildcard",
    why: "A star origin allows any site to call this response.",
    checklist: ["Confirm a star origin is intended."],
  },
  "deps.vulnerability": {
    title: "Patch vulnerable dependencies",
    why: "Public vulnerability records exist for these exact installed versions.",
    checklist: [
      "Update each listed package to a fixed version.",
      "Re-run the scan to confirm the record no longer matches.",
    ],
  },
  "deps.install-script": {
    title: "Review install scripts",
    why: "The manifest names a lifecycle script. The scan did not run it.",
    checklist: ["Read the named lifecycle script.", "Remove any you did not write or no longer need."],
  },
  "deps.unpinned-version": {
    title: "Pin dependency versions",
    why: "Floating ranges install different code tomorrow than they do today.",
    checklist: ["Pin each listed range to an exact version.", "Record why an exception exists if one must float."],
  },
  "deps.duplicate": {
    title: "Deduplicate dependencies",
    why: "The same package twice means two copies to patch and two behaviors.",
    checklist: ["Keep one copy at one version.", "Move shared use into that single copy."],
  },
  "license.policy": {
    title: "Confirm the license situation",
    why: "Reviewers and users check whether they may reuse the code.",
    checklist: [
      "If no license file was found, add a LICENSE file or confirm the intended terms with a human.",
      "If a license file was found, check that the package field matches it. This is not legal advice.",
    ],
  },
  "license.dependency": {
    title: "Confirm each dependency's declared terms",
    why: "A dependency you ship brings its licence's conditions with it.",
    checklist: [
      "Read the obligation quoted on each row. It is what that licence text asks for, not a clearance.",
      "Add the notices this product can generate to the distribution, then have a person read the copyleft rows.",
      "If a dependency moved licence since the last scan, read that row first: the change is on the rescan, not only here.",
    ],
  },
};

const STEP_ORDER = [
  "secret.tracked-env",
  "secret.private-key",
  "secret.github-token",
  "secret.aws-key",
  "secret.credential-pattern",
  "secret.client-exposure",
  "secret.eval-use",
  "secret.debugger-statement",
  "secret.debug-leftover",
  "secret.sql-pattern",
  "code.eval-use",
  "code.debugger-statement",
  "code.debug-leftover",
  "code.sql-pattern",
  "code.inner-html",
  "code.child-process",
  "code.weak-crypto",
  "code.cors-wildcard",
  "deps.vulnerability",
  "deps.install-script",
  "deps.unpinned-version",
  "deps.duplicate",
  "license.dependency",
  "license.policy",
];

export function buildFixPlan(findings: PlanFinding[]): FixPlan {
  const steps: FixStep[] = [];
  const notActionable: PlanFinding[] = [];
  const byRule = new Map<string, PlanFinding[]>();

  for (const finding of findings) {
    if (finding.severity === "info") {
      notActionable.push(finding);
      continue;
    }
    const group = byRule.get(finding.ruleId) ?? [];
    group.push(finding);
    byRule.set(finding.ruleId, group);
  }

  let order = 1;
  for (const ruleId of STEP_ORDER) {
    const group = byRule.get(ruleId);
    if (group === undefined || group.length === 0) continue;
    const text = STEP_TEXT[ruleId];
    if (text === undefined) {
      notActionable.push(...group);
      continue;
    }
    const files = [...new Set(group.map((f) => f.path))].slice(0, 10);
    if (new Set(group.map((f) => f.path)).size > 10) {
      files.push(`+${new Set(group.map((f) => f.path)).size - 10} more`);
    }
    steps.push({
      order: order++,
      ruleId,
      title: text.title,
      why: text.why,
      files,
      checklist: text.checklist,
    });
  }

  for (const [ruleId, group] of byRule) {
    if (!STEP_ORDER.includes(ruleId)) notActionable.push(...group);
  }

  return { steps, notActionable };
}
