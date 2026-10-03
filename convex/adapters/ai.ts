"use node";

// AI lane: Gemini first, then Ollama Cloud, then deterministic fallback.
// Every failure path is soft. AI explains, it never decides. Keys are read
// from server-only Convex environment variables and never leave this module.

declare const process: { env: Record<string, string | undefined> };

export const AI_TIMEOUT_MS = 20000;
// Measured on a real findings prompt, Ollama Cloud took about 78 seconds because
// the model spends several thousand tokens on reasoning before it writes the
// answer. It needs its own long ceiling, otherwise the fallback lane is always
// cut off before it can reply. Gemini answers the same prompt in about 2 seconds,
// so this cost is only paid when Gemini is unavailable.
export const OLLAMA_TIMEOUT_MS = 90000;
export const AI_MAX_OUTPUT_TOKENS = 1200;

// gemini-2.0-flash was retired and now answers 404. 2.5-flash is the current
// stable fast tier and stays on the Google AI Studio free tier.
export const GEMINI_MODEL = "gemini-2.5-flash";

// Ollama Cloud is reachable over an OpenAI-compatible endpoint. The default
// model is a small mixture-of-experts model with about 3.5B active parameters,
// so it stays cheap per call. Override with OLLAMA_MODEL if needed.
export const OLLAMA_BASE_URL = "https://ollama.com/v1";
export const OLLAMA_DEFAULT_MODEL = "nemotron-3-nano:30b-cloud";

export type AiSource = "gemini" | "ollama" | "deterministic";

export interface AiCallResult {
  ok: boolean;
  source: AiSource;
  json: unknown;
  model: string | null;
  latencyMs: number;
  error: string | null;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number = AI_TIMEOUT_MS,
): Promise<{ ok: boolean; text: string; error: string | null }> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return { ok: false, text: "", error: `HTTP ${response.status}` };
    }
    return { ok: true, text: await response.text(), error: null };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return { ok: false, text: "", error: name === "TimeoutError" ? "timeout" : "network" };
  }
}

// Pulls the first balanced JSON object out of a model reply.
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as unknown;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function extractGeminiText(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const candidates = (data as Record<string, unknown>)["candidates"];
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const content = (candidates[0] as Record<string, unknown>)["content"];
  if (typeof content !== "object" || content === null) return null;
  const parts = (content as Record<string, unknown>)["parts"];
  if (!Array.isArray(parts)) return null;
  let out = "";
  for (const part of parts) {
    if (typeof part !== "object" || part === null) continue;
    const text = (part as Record<string, unknown>)["text"];
    if (typeof text === "string") out += text;
  }
  return out.length > 0 ? out : null;
}

function extractGeminiUsage(data: unknown): {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
} {
  if (typeof data !== "object" || data === null) return { inputTokens: null, outputTokens: null, totalTokens: null };
  const usage = (data as Record<string, unknown>)["usageMetadata"];
  if (typeof usage !== "object" || usage === null) return { inputTokens: null, outputTokens: null, totalTokens: null };
  const record = usage as Record<string, unknown>;
  const input = typeof record["promptTokenCount"] === "number" ? record["promptTokenCount"] : null;
  const output = typeof record["candidatesTokenCount"] === "number" ? record["candidatesTokenCount"] : null;
  const total = typeof record["totalTokenCount"] === "number" ? record["totalTokenCount"] : null;
  return { inputTokens: input, outputTokens: output, totalTokens: total };
}

export function extractOllamaText(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const choices = (data as Record<string, unknown>)["choices"];
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as Record<string, unknown>)["message"];
  if (typeof message !== "object" || message === null) return null;
  const content = (message as Record<string, unknown>)["content"];
  return typeof content === "string" && content.length > 0 ? content : null;
}

export function extractOllamaUsage(data: unknown): {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
} {
  if (typeof data !== "object" || data === null) {
    return { inputTokens: null, outputTokens: null, totalTokens: null };
  }
  const usage = (data as Record<string, unknown>)["usage"];
  if (typeof usage !== "object" || usage === null) {
    return { inputTokens: null, outputTokens: null, totalTokens: null };
  }
  const record = usage as Record<string, unknown>;
  const input = typeof record["prompt_tokens"] === "number" ? record["prompt_tokens"] : null;
  const output = typeof record["completion_tokens"] === "number" ? record["completion_tokens"] : null;
  const total = typeof record["total_tokens"] === "number" ? record["total_tokens"] : null;
  return { inputTokens: input, outputTokens: output, totalTokens: total };
}

export async function callAiLane(prompt: string): Promise<AiCallResult> {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey !== undefined && geminiKey.length > 0) {
    const started = Date.now();
    const result = await postJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      { "x-goog-api-key": geminiKey },
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
          responseMimeType: "application/json",
          // Gemini 2.5 defaults to spending output tokens on internal reasoning.
          // Left on, it consumed the whole budget and returned no JSON at all,
          // which silently pushed every scan to the plain wording fallback.
          thinkingConfig: { thinkingBudget: 0 },
        },
      },
    );
    if (result.ok) {
      const parsed = safeParse(result.text);
      const text = extractGeminiText(parsed);
      if (text !== null) {
        const json = extractJson(text);
        if (json !== null) {
          return {
            ok: true,
            source: "gemini",
            json,
            model: GEMINI_MODEL,
            latencyMs: Date.now() - started,
            error: null,
            usage: extractGeminiUsage(parsed),
          };
        }
      }
    }
  }

  const ollamaKey = process.env.OLLAMA_API_KEY;
  if (ollamaKey !== undefined && ollamaKey.length > 0) {
    const model = process.env.OLLAMA_MODEL !== undefined && process.env.OLLAMA_MODEL.length > 0
      ? process.env.OLLAMA_MODEL
      : OLLAMA_DEFAULT_MODEL;
    const started = Date.now();
    const result = await postJson(
      `${OLLAMA_BASE_URL}/chat/completions`,
      { Authorization: `Bearer ${ollamaKey}` },
      {
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: AI_MAX_OUTPUT_TOKENS,
        response_format: { type: "json_object" },
      },
      OLLAMA_TIMEOUT_MS,
    );
    if (result.ok) {
      const parsed = safeParse(result.text);
      const text = extractOllamaText(parsed);
      if (text !== null) {
        const json = extractJson(text);
        if (json !== null) {
          return {
            ok: true,
            source: "ollama",
            json,
            model,
            latencyMs: Date.now() - started,
            error: null,
            usage: extractOllamaUsage(parsed),
          };
        }
      }
    }
  }

  return {
    ok: false,
    source: "deterministic",
    json: null,
    model: null,
    latencyMs: 0,
    error: "No AI provider available.",
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
  };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}