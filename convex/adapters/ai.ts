"use node";

// AI lane: Gemini first, then OpenRouter free, then deterministic fallback.
// Every failure path is soft. AI explains, it never decides. Keys are read
// from server-only Convex environment variables and never leave this module.

declare const process: { env: Record<string, string | undefined> };

export const AI_TIMEOUT_MS = 20000;
export const AI_MAX_OUTPUT_TOKENS = 1200;

export type AiSource = "gemini" | "openrouter" | "deterministic";

export interface AiCallResult {
  ok: boolean;
  source: AiSource;
  json: unknown;
  model: string | null;
  latencyMs: number;
  error: string | null;
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ ok: boolean; text: string; error: string | null }> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
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

function extractOpenRouterText(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const choices = (data as Record<string, unknown>)["choices"];
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as Record<string, unknown>)["message"];
  if (typeof message !== "object" || message === null) return null;
  const content = (message as Record<string, unknown>)["content"];
  return typeof content === "string" && content.length > 0 ? content : null;
}

export async function callAiLane(prompt: string): Promise<AiCallResult> {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey !== undefined && geminiKey.length > 0) {
    const started = Date.now();
    const result = await postJson(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
      { "x-goog-api-key": geminiKey },
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
          responseMimeType: "application/json",
        },
      },
    );
    if (result.ok) {
      const text = extractGeminiText(safeParse(result.text));
      if (text !== null) {
        const json = extractJson(text);
        if (json !== null) {
          return {
            ok: true,
            source: "gemini",
            json,
            model: "gemini-2.0-flash",
            latencyMs: Date.now() - started,
            error: null,
          };
        }
      }
    }
  }

  const routerKey = process.env.OPENROUTER_API_KEY;
  if (routerKey !== undefined && routerKey.length > 0) {
    const started = Date.now();
    const result = await postJson(
      "https://openrouter.ai/api/v1/chat/completions",
      { Authorization: `Bearer ${routerKey}` },
      {
        model: "openrouter/free",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: AI_MAX_OUTPUT_TOKENS,
      },
    );
    if (result.ok) {
      const text = extractOpenRouterText(safeParse(result.text));
      if (text !== null) {
        const json = extractJson(text);
        if (json !== null) {
          return {
            ok: true,
            source: "openrouter",
            json,
            model: "openrouter/free",
            latencyMs: Date.now() - started,
            error: null,
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
  };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}