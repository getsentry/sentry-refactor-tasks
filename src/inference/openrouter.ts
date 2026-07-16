import { resolveOpenRouterModel } from "./models.ts";
import type { InferenceProvider, InferenceRequest } from "./types.ts";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Read the OpenRouter API key from the environment. Kept in one place so the key
 * is only ever sourced from `OPENROUTER_API_KEY` and never logged or persisted.
 */
export function openRouterApiKey(): string | undefined {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  return key ? key : undefined;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

/**
 * Inference via OpenRouter's OpenAI-compatible chat completions API. The API key
 * is read from `OPENROUTER_API_KEY`; the base URL can be overridden with
 * `OPENROUTER_BASE_URL`. Structured output uses `response_format: json_schema`
 * so the returned content is JSON conforming to the requested schema.
 */
export const openRouterProvider: InferenceProvider = {
  name: "openrouter",

  async complete(req: InferenceRequest): Promise<string> {
    const apiKey = openRouterApiKey();
    if (!apiKey) {
      throw new Error(
        "OPENROUTER_API_KEY is not set. Export it in the environment to use the OpenRouter backend.",
      );
    }

    const baseUrl = (process.env.OPENROUTER_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(
      /\/+$/,
      "",
    );

    const messages: Array<{ role: string; content: string }> = [];
    if (req.system) {
      messages.push({ role: "system", content: req.system });
    }
    messages.push({ role: "user", content: req.prompt });

    const body: Record<string, unknown> = {
      model: resolveOpenRouterModel(req.model),
      messages,
    };

    if (req.jsonSchema) {
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: req.jsonSchema.name,
          strict: true,
          schema: req.jsonSchema.schema,
        },
      };
    }

    // OpenRouter recommends these headers for attribution; they are optional and
    // safe to send. They do not carry the key.
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/getsentry/sentry-refactor-tasks",
      "X-Title": "sentry-refactor-tasks",
    };

    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(req.timeoutMs ?? 120_000),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new Error(`OpenRouter request timed out after ${req.timeoutMs ?? 120_000}ms`);
      }
      throw err;
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `OpenRouter request failed: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`,
      );
    }

    const data = (await res.json()) as ChatCompletionResponse;
    if (data.error) {
      throw new Error(`OpenRouter error: ${data.error.message ?? "unknown error"}`);
    }

    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new Error("OpenRouter returned an empty response");
    }

    return content.trim();
  },
};
