/**
 * A single completion request, provider-agnostic. Both the local claude CLI and
 * the OpenRouter HTTP backend accept this shape and return the model's text.
 */
export interface InferenceRequest {
  /** The user prompt. */
  prompt: string;
  /** Model tier (haiku/sonnet/opus) or a provider-specific model ID. */
  model: string;
  /** Optional system prompt. */
  system?: string;
  /**
   * When set, the model is asked to return output conforming to this JSON
   * schema. The returned string is the JSON text of that structured output.
   */
  jsonSchema?: {
    name: string;
    schema: Record<string, unknown>;
  };
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
}

/**
 * A pluggable inference backend. `complete` returns the model's text response.
 * When {@link InferenceRequest.jsonSchema} is provided, that text is JSON
 * conforming to the schema, ready for the caller to parse and validate.
 */
export interface InferenceProvider {
  readonly name: string;
  complete(req: InferenceRequest): Promise<string>;
}
