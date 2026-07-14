import { exec } from "../utils/exec.ts";
import type { InferenceProvider, InferenceRequest } from "./types.ts";

/**
 * Inference via the local `claude` binary on `$PATH`. This is the original
 * backend: it shells out with `--print` and parses the JSON envelope claude
 * writes to stdout. Authentication is whatever the binary is already configured
 * to use, so no API key is read here.
 */
export const claudeCliProvider: InferenceProvider = {
  name: "claude-cli",

  async complete(req: InferenceRequest): Promise<string> {
    const args = ["--print", req.prompt, "--output-format", "json"];

    if (req.jsonSchema) {
      args.push("--json-schema", JSON.stringify(req.jsonSchema.schema));
    }
    if (req.system) {
      args.push("--append-system-prompt", req.system);
    }
    args.push("--model", req.model);

    const { stdout } = await exec("claude", args, { timeout: req.timeoutMs ?? 120_000 });

    const response = JSON.parse(stdout);
    // With --json-schema, claude puts the parsed object in `structured_output`;
    // otherwise the raw model text is in `result`. Normalize both to a string.
    if (req.jsonSchema) {
      const structured = response.structured_output ?? JSON.parse(response.result);
      return JSON.stringify(structured);
    }
    return (response.result ?? stdout).trim();
  },
};
