/**
 * The repo config and CLI use a small enum of model tiers (haiku/sonnet/opus).
 * The claude CLI understands these names directly; OpenRouter needs fully
 * qualified model IDs. This module maps a tier to the OpenRouter ID, allowing
 * per-tier overrides via env vars so callers aren't pinned to specific versions.
 */

type ModelTier = "haiku" | "sonnet" | "opus";

const DEFAULT_OPENROUTER_MODELS: Record<ModelTier, string> = {
  haiku: "~anthropic/claude-haiku-latest",
  sonnet: "~anthropic/claude-sonnet-latest",
  opus: "~anthropic/claude-opus-latest",
};

/**
 * Resolve a tier (or an already-qualified model ID) to an OpenRouter model ID.
 *
 * If `model` already looks like an OpenRouter ID (contains a `/`), it is passed
 * through untouched so advanced users can request any model. Otherwise it is
 * treated as a tier, resolved from `OPENROUTER_MODEL_<TIER>` env overrides, then
 * the built-in defaults.
 */
export function resolveOpenRouterModel(model: string): string {
  if (model.includes("/")) {
    return model;
  }

  const tier = model as ModelTier;
  const override = process.env[`OPENROUTER_MODEL_${tier.toUpperCase()}`];
  if (override) {
    return override;
  }

  const mapped = DEFAULT_OPENROUTER_MODELS[tier];
  if (!mapped) {
    throw new Error(
      `Unknown model tier "${model}". Expected one of haiku/sonnet/opus, or a fully qualified OpenRouter model ID (e.g. "anthropic/claude-opus-4").`,
    );
  }
  return mapped;
}
