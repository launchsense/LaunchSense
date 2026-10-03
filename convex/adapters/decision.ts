"use node";

// Decision lane. A typed-decision call, not a chat call.
//
// Code asks a closed set of questions about a state and gets typed answers with
// probabilities: is this worth fixing, which kind of fix is it, how urgent. The
// model can only pick from options we enumerated, so it cannot invent a finding,
// a check, or a tool. That is the safety property, and it holds by construction.
//
// This lane NEVER decides what is a finding. The deterministic checks do that, and
// the writing lane explains them. This lane only orders and prioritises what the
// checks already found. That distinction is a promise the product makes in three
// public docs, and there are tests that hold it in place.
//
// Provider order: TypeSafe Jev, then Perplexity pplx-decider, then the rule table.
// Both hosted providers speak the exact same request and response shape, so this
// is one adapter with two addresses, not two integrations. The contract was verified
// against https://docs.perplexity.ai/docs/decisions/quickstart on 2026-10-03.
//
// A local Ollama decision model sits first on the operator's tower, but a hosted
// deployment cannot reach a developer's localhost, so it is not a rung here.
//
// Every failure path is soft. A scan never fails because this lane failed.

declare const process: { env: Record<string, string | undefined> };

export const DECISION_TIMEOUT_MS = 20000;
export const DECISION_MAX_RETURNED_QUESTIONS = 128;

// TypeSafe Jev. Direct, not through a router, per the operator rule against paid
// OpenRouter. Early access at time of writing, so verify the endpoint and quota
// before making it load-bearing in production.
export const JEV_URL = "https://api.typesafe.ai/v1/systemone";
export const JEV_DEFAULT_MODEL = "jev-latest";

// Perplexity Decisions API. Verified: POST, one JSON endpoint, no trailing slash,
// Authorization: Bearer. Model name must be exact or the API returns 400.
export const PERPLEXITY_URL = "https://api.perplexity.ai/v1/decisions";
export const PERPLEXITY_MODEL = "pplx-decider-v1-27b";

export type DecisionSource = "jev" | "perplexity" | "table";

/** The three question types the contract defines. Nothing else is allowed. */
export type QuestionType = "noul" | "choice" | "score";

export interface NoulQuestion {
  type: "noul";
  instructions: string;
  /** Optional. Defines what counts as true and what counts as false. */
  criteria?: Record<string, string>;
}

export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  /** Option name to description. A null description lets the name speak. */
  criteria: Record<string, string | null>;
}

export interface ScoreQuestion {
  type: "score";
  instructions: string;
  /** Ordered, lowest first. Index is the score. Two to ten levels. */
  criteria: string[];
}

export type DecisionQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export interface NoulAnswer {
  type: "noul";
  noul: number;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface ScoreAnswer {
  type: "score";
  score: number;
  confidence: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
}

export type DecisionAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface DecisionResult {
  ok: boolean;
  source: DecisionSource;
  model: string | null;
  answers: Record<string, DecisionAnswer> | null;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Which rungs were tried, in order, and why each stopped. Never the payload. */
  attempts: Array<{ provider: string; ok: boolean; error: string | null }>;
  error: string | null;
}

// Refused before any request leaves the machine. Deliberately narrow: these shapes
// are never legitimate content for a judgment call, and this lane sends text to a
// third party. Mirrors the operator's decision lane, which has already proven the
// shape of this guard in production.
const SECRET_SHAPES: Array<{ label: string; pattern: RegExp }> = [
  { label: "openrouter key", pattern: /sk-or-v1-[0-9a-fA-F]{16,}/ },
  { label: "bearer token", pattern: /\bbearer\s+[A-Za-z0-9._-]{20,}/i },
  { label: "generic api key", pattern: /\bsk-[A-Za-z0-9]{20,}/ },
  { label: "private key block", pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/ },
  { label: "aws key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: "github token", pattern: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/ },
];

/** Returns the label of the secret shape found, or null. Never returns the value. */
export function looksLikeSecret(state: unknown): string | null {
  const text = typeof state === "string" ? state : JSON.stringify(state);
  for (const { label, pattern } of SECRET_SHAPES) {
    if (pattern.test(text)) return label;
  }
  return null;
}

/** Local validation before spending a call. A malformed question is never sent. */
export function validateQuestions(questions: Record<string, DecisionQuestion>): string[] {
  const problems: string[] = [];
  const ids = Object.keys(questions);
  if (ids.length === 0) return ["questions must be a non-empty map of id to question"];
  if (ids.length > DECISION_MAX_RETURNED_QUESTIONS) {
    problems.push(`too many questions: ${ids.length}, limit is ${DECISION_MAX_RETURNED_QUESTIONS}`);
  }
  for (const [id, q] of Object.entries(questions)) {
    if (q === null || typeof q !== "object") {
      problems.push(`${id}: question must be an object`);
      continue;
    }
    if (q.type !== "noul" && q.type !== "choice" && q.type !== "score") {
      problems.push(`${id}: type must be noul, choice, or score`);
      continue;
    }
    if (typeof q.instructions !== "string" || q.instructions.length === 0) {
      problems.push(`${id}: instructions is required`);
    }
    if (q.type === "choice") {
      const options = Object.keys(q.criteria ?? {});
      if (options.length < 2) problems.push(`${id}: choice needs at least 2 options`);
      if (options.length > 255) problems.push(`${id}: choice allows at most 255 options`);
    }
    if (q.type === "score") {
      const levels = q.criteria ?? [];
      if (levels.length < 2) problems.push(`${id}: score needs at least 2 levels`);
      if (levels.length > 10) problems.push(`${id}: score allows at most 10 levels`);
    }
  }
  return problems;
}

async function postJson(
  url: string,
  key: string,
  body: unknown,
  timeoutMs: number,
): Promise<{ status: number; text: string; error: string | null }> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      // Read the body so error.message can be logged, but never surfaced raw.
      await response.text().catch(() => "");
      return { status: response.status, text: "", error: `http_${response.status}` };
    }
    return { status: response.status, text: await response.text(), error: null };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return {
      status: 0,
      text: "",
      error: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network",
    };
  }
}

function parseAnswers(body: string): Record<string, DecisionAnswer> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const answers = (parsed as Record<string, unknown>)["answers"];
  if (typeof answers !== "object" || answers === null) return null;
  const out: Record<string, DecisionAnswer> = {};
  for (const [id, value] of Object.entries(answers as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) continue;
    const record = value as Record<string, unknown>;
    out[id] = record as unknown as DecisionAnswer;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function usageOf(body: string): { input: number | null; output: number | null } {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const usage = parsed["usage"];
    if (typeof usage !== "object" || usage === null) return { input: null, output: null };
    const u = usage as Record<string, unknown>;
    return {
      input: typeof u["input_tokens"] === "number" ? u["input_tokens"] : null,
      output: typeof u["output_tokens"] === "number" ? u["output_tokens"] : null,
    };
  } catch {
    return { input: null, output: null };
  }
}

interface Rung {
  name: DecisionSource;
  url: string;
  keyEnv: string;
  model: string;
}

/** The rungs, in order. A rung with no key is skipped, never fatal. */
export function decisionRungs(): Rung[] {
  return [
    { name: "jev", url: JEV_URL, keyEnv: "TYPESAFE_API_KEY", model: JEV_DEFAULT_MODEL },
    { name: "perplexity", url: PERPLEXITY_URL, keyEnv: "PERPLEXITY_API_KEY", model: PERPLEXITY_MODEL },
  ];
}

function failed(
  source: DecisionSource,
  latencyMs: number,
  attempts: DecisionResult["attempts"],
  error: string,
): DecisionResult {
  return {
    ok: false,
    source,
    model: null,
    answers: null,
    latencyMs,
    inputTokens: null,
    outputTokens: null,
    attempts,
    error,
  };
}

/**
 * Ask the decision lane. Never throws for a provider problem.
 *
 * ok true  -> answers carry one typed answer per question id
 * ok false -> the caller uses its own rule table instead
 */
export async function decide(
  state: unknown,
  questions: Record<string, DecisionQuestion>,
  timeoutMs: number = DECISION_TIMEOUT_MS,
): Promise<DecisionResult> {
  const problems = validateQuestions(questions);
  if (problems.length > 0) {
    return failed("table", 0, [], `invalid_questions: ${problems.join("; ")}`);
  }

  const secret = looksLikeSecret(state);
  if (secret !== null) {
    // Refused before the request is built. Never name the value.
    return failed("table", 0, [], `refused_secret_in_state: ${secret}`);
  }

  const attempts: DecisionResult["attempts"] = [];
  const startedAll = Date.now();

  for (const rung of decisionRungs()) {
    const key = process.env[rung.keyEnv];
    if (key === undefined || key.length === 0) {
      attempts.push({ provider: rung.name, ok: false, error: `no_key:${rung.keyEnv}` });
      continue;
    }

    const started = Date.now();
    const response = await postJson(
      rung.url,
      key,
      { model: rung.model, state, questions },
      timeoutMs,
    );

    if (response.error !== null) {
      attempts.push({ provider: rung.name, ok: false, error: response.error });
      continue;
    }

    const answers = parseAnswers(response.text);
    if (answers === null) {
      attempts.push({ provider: rung.name, ok: false, error: "no_answers_in_body" });
      continue;
    }

    // Every question must come back. A partial answer set is a bad answer set,
    // because downstream a missing answer is indistinguishable from a "no".
    const missing = Object.keys(questions).filter((id) => !(id in answers));
    if (missing.length > 0) {
      attempts.push({ provider: rung.name, ok: false, error: `missing_answers:${missing.length}` });
      continue;
    }

    const usage = usageOf(response.text);
    attempts.push({ provider: rung.name, ok: true, error: null });
    return {
      ok: true,
      source: rung.name,
      model: rung.model,
      answers,
      latencyMs: Date.now() - started,
      inputTokens: usage.input,
      outputTokens: usage.output,
      attempts,
      error: null,
    };
  }

  return failed("table", Date.now() - startedAll, attempts, "no_provider_answered");
}