import { verbose } from "../utils/logger.ts";
import { claudeCliProvider } from "./claude-cli.ts";
import { openRouterApiKey, openRouterProvider } from "./openrouter.ts";
import type { InferenceProvider, InferenceRequest } from "./types.ts";

/**
 * Select the inference backend.
 *
 * `INFERENCE_PROVIDER` forces a choice (`openrouter` or `claude-cli`). Without
 * it, we auto-detect: if `OPENROUTER_API_KEY` is set we use OpenRouter,
 * otherwise we fall back to the local `claude` binary.
 */
function selectProvider(): InferenceProvider {
  const forced = process.env.INFERENCE_PROVIDER?.trim().toLowerCase();

  if (forced === "openrouter") {
    return openRouterProvider;
  }
  if (forced === "claude-cli" || forced === "claude") {
    return claudeCliProvider;
  }
  if (forced) {
    throw new Error(
      `Unknown INFERENCE_PROVIDER "${forced}". Expected "openrouter" or "claude-cli".`,
    );
  }

  return openRouterApiKey() ? openRouterProvider : claudeCliProvider;
}

/**
 * Run a single completion against the selected backend. Callers that request a
 * JSON schema receive JSON text conforming to it, ready to parse and validate.
 */
export async function runInference(req: InferenceRequest): Promise<string> {
  const provider = selectProvider();
  verbose(`Inference via "${provider.name}" (model: ${req.model})`);
  return provider.complete(req);
}
