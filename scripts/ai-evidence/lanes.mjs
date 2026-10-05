// Lane selection for the AI evidence harness.
//
// Reaches the product's own lanes where it can, and says plainly where it could
// not. Four things this file will not do:
//
//   1. print a secret, a token, or an env value. It reads env NAMES only and
//      turns each into a boolean. There is no code path here that formats a
//      value, so there is nothing to leak by accident.
//   2. reach a paid or metered provider. The hosted rungs are reachable only
//      when this process was started with their key already set, which this
//      harness never does, and the report records the refusal.
//   3. reach anything but 127.0.0.1. The only URL it opens is the local
//      Ollama server, and it asserts the host before opening it.
//   4. send anything. Every prompt it builds comes from
//      scripts/ai-evidence/fixture.mjs, which is synthetic.

import { AI_MAX_OUTPUT_TOKENS, extractJson, extractOllamaText } from "../../convex/adapters/ai.ts";

export const LOCAL_OLLAMA_ROOT = "http://127.0.0.1:11434";
/** The product's decision rung path, unchanged from convex/adapters/decision.ts. */
export const LOCAL_DECISION_PATH = "/v1/systemone";
/** The OpenAI-compatible chat path the product's Ollama rung already speaks. */
export const LOCAL_CHAT_PATH = "/v1/chat/completions";

/** Env NAMES the product's lanes read. Presence is reported, never the value. */
const KEY_NAMES = [
  "GEMINI_API_KEY",
  "OLLAMA_API_KEY",
  "TYPESAFE_API_KEY",
  "PERPLEXITY_API_KEY",
  "LAUNCHSENSE_LOCAL_DECISION",
];

/** Names only. Returns booleans and lengths of rungs, and nothing else. */
export function keyPresence() {
  const out = {};
  for (const name of KEY_NAMES) {
    const value = process.env[name];
    out[name] = { set: typeof value === "string" && value.length > 0, length: typeof value === "string" ? value.length : 0 };
  }
  return out;
}

/** True when the local Ollama server answers. A status code, never a body. */
export async function localOllamaUp(timeoutMs = 3000) {
  try {
    const response = await fetch(`${LOCAL_OLLAMA_ROOT}/`, { signal: AbortSignal.timeout(timeoutMs) });
    return { up: response.ok, status: response.status };
  } catch {
    return { up: false, status: 0 };
  }
}

/**
 * True when a model tag names a metered cloud model.
 *
 * The check is deliberately not `:cloud`. Real tags are shaped
 * `name:30b-cloud` and `name:31b-cloud`, where the size tag sits between the
 * colon and the word, so a `":cloud"` substring test passes two billed models
 * through as local. Anything with `cloud` as a dash- or colon-delimited word is
 * treated as metered.
 */
export function isCloudTag(name) {
  return /(^|[:-])cloud($|[:-])/.test(String(name));
}

/** The model tags the local server will actually load, local ones only. */
export async function localModels(timeoutMs = 10000) {
  try {
    const response = await fetch(`${LOCAL_OLLAMA_ROOT}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return [];
    const body = await response.json();
    const models = Array.isArray(body.models) ? body.models : [];
    return models
      .map((m) => ({ name: m.name, cloud: isCloudTag(m.name), caps: m.capabilities ?? [] }))
      // A cloud tag is billed per token. This harness runs on free rungs only, so
      // a cloud tag is filtered out here rather than trusted to be avoided later.
      .filter((m) => !m.cloud);
  } catch {
    return [];
  }
}

function assertLocal(url) {
  const parsed = new URL(url);
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error(`refusing a non-local lane: ${parsed.hostname}`);
  }
  return url;
}

export class LocalChatLane {
  /**
   * The product's Ollama request shape, pointed at the local server.
   *
   * Two deliberate differences from convex/adapters/ai.ts, both stated because
   * they matter to how the numbers should be read:
   *   - the base URL is 127.0.0.1 instead of the hosted Ollama Cloud address,
   *     because no hosted key is set and this harness does not buy one;
   *   - `think: false` is sent, because the local qwen-family models spend the
   *     output budget on reasoning and return no JSON otherwise, exactly the
   *     bug tests/ai-lane-guards.mjs holds the Gemini rung against.
   *
   * Everything else is the product's: the same JSON extractor, the same
   * OpenAI-compatible response shape, the same output token cap.
   */
  constructor(model, { temperature = 0.2, timeoutMs = 180000 } = {}) {
    this.model = model;
    this.temperature = temperature;
    this.timeoutMs = timeoutMs;
    this.url = assertLocal(`${LOCAL_OLLAMA_ROOT}${LOCAL_CHAT_PATH}`);
    this.calls = 0;
    this.latencies = [];
    this.failures = 0;
  }

  get name() {
    return `local-chat:${this.model}`;
  }

  /**
   * One chat completion. `jsonMode` mirrors the product: the explain rung asks
   * for a JSON object, the licence lookup rung asks for one bare id and must
   * not be given a JSON mode it does not want.
   */
  async raw(prompt, { jsonMode = true } = {}) {
    const started = Date.now();
    this.calls += 1;
    try {
      const body = {
        model: this.model,
        messages: [{ role: "user", content: prompt }],
        temperature: this.temperature,
        max_tokens: AI_MAX_OUTPUT_TOKENS,
        think: false,
      };
      if (jsonMode) body.response_format = { type: "json_object" };
      const response = await fetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      this.latencies.push(Date.now() - started);
      if (!response.ok) {
        this.failures += 1;
        return { ok: false, text: null, error: `http_${response.status}`, latencyMs: Date.now() - started };
      }
      const parsed = await response.json();
      const text = extractOllamaText(parsed);
      // finish_reason and usage are read here because "the lane returned nothing"
      // is not an actionable finding on its own. A reply cut off at the output cap
      // is a different defect from a lane that answered with prose, and the report
      // has to be able to tell them apart. These are counts and a reason string,
      // never prompt text and never a key.
      const finishReason = parsed?.choices?.[0]?.finish_reason ?? null;
      const usage = parsed?.usage ?? null;
      if (text === null) {
        this.failures += 1;
        const cutOff = finishReason === "length";
        return {
          ok: false,
          text: null,
          error: cutOff ? "output_cap_reached_no_content" : "no_text_in_body",
          finishReason,
          usage,
          latencyMs: Date.now() - started,
        };
      }
      return { ok: true, text, error: null, finishReason, usage, latencyMs: Date.now() - started };
    } catch (error) {
      this.failures += 1;
      const name = error instanceof Error ? error.name : "";
      return {
        ok: false,
        text: null,
        error: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network",
        finishReason: null,
        usage: null,
        latencyMs: Date.now() - started,
      };
    }
  }

  /** The explain rung's call: the product's own JSON extractor on the reply. */
  async complete(prompt) {
    const result = await this.raw(prompt, { jsonMode: true });
    if (!result.ok) {
      return { ok: false, json: null, error: result.error, finishReason: result.finishReason, usage: result.usage, latencyMs: result.latencyMs };
    }
    const json = extractJson(result.text);
    if (json === null) {
      this.failures += 1;
      return {
        ok: false,
        json: null,
        error: result.finishReason === "length" ? "output_cap_reached_truncated_json" : "no_json_in_body",
        finishReason: result.finishReason,
        usage: result.usage,
        latencyMs: result.latencyMs,
      };
    }
    return { ok: true, json, error: null, finishReason: result.finishReason, usage: result.usage, latencyMs: result.latencyMs };
  }

  /**
   * The licence lookup rung's call.
   *
   * The injected lane contract is "the bare id it would suggest, or null", so
   * the reply is unwrapped from quotes and backticks and then handed to the
   * product's classifier untouched. If the model answered in a sentence, that
   * is the model's mistake and the classifier, not this shim, must refuse it.
   */
  async lookupLane() {
    const asked = [];
    const lane = async ({ prompt }) => {
      asked.push(prompt);
      const result = await this.raw(prompt, { jsonMode: false });
      if (!result.ok || result.text === null) return null;
      return result.text.trim().replace(/^["'`]+|["'`]+$/g, "").trim();
    };
    lane.prompts = asked;
    return lane;
  }

  stats() {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    return {
      lane: this.name,
      calls: this.calls,
      failures: this.failures,
      latencyMs: {
        min: sorted[0] ?? 0,
        median: sorted[Math.floor(sorted.length / 2)] ?? 0,
        max: sorted[sorted.length - 1] ?? 0,
      },
    };
  }
}

/**
 * A deterministic stand-in for the local lane.
 *
 * Used when no lane is reachable and by the committed checks, so the invariants
 * are still exercised on every `npm run check` with no model and no network.
 * `answers` is keyed by exact prompt string, so a stub can only answer prompts
 * it was written for; anything else returns the stub's fallback.
 */
export function stubChatLane(answers = {}, fallback = null) {
  const seen = [];
  return {
    name: "stub",
    async complete(prompt) {
      seen.push(prompt);
      const value = Object.prototype.hasOwnProperty.call(answers, prompt) ? answers[prompt] : fallback;
      return { ok: value !== null, json: value, error: value === null ? "no_stub_answer" : null, latencyMs: 0 };
    },
    prompts: seen,
    stats: () => ({ lane: "stub", calls: seen.length, failures: 0, latencyMs: { min: 0, median: 0, max: 0 } }),
  };
}