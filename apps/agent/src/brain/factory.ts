import { AnthropicBrain } from "./anthropic";
import { OllamaBrain } from "./ollama";
import { OpenRouterBrain } from "./openrouter";
import type { Brain } from "./types";

export interface BrainFactoryEnv {
  BRAIN_PROVIDER?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  OLLAMA_BASE_URL?: string;
}

/**
 * Build the configured brain. Defaults to OpenRouter when nothing is set.
 * Throws an Error with a clear message if a non-default provider is selected
 * but its required env is missing.
 */
export function buildBrain(env: BrainFactoryEnv): Brain {
  const provider = env.BRAIN_PROVIDER ?? "openrouter";
  switch (provider) {
    case "openrouter": {
      const apiKey = env.OPENROUTER_API_KEY;
      if (!apiKey) throw new Error("BRAIN_PROVIDER=openrouter but OPENROUTER_API_KEY is not set");
      return new OpenRouterBrain({ apiKey });
    }
    case "anthropic": {
      const apiKey = env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error("BRAIN_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set");
      return new AnthropicBrain({ apiKey });
    }
    case "ollama": {
      return new OllamaBrain({ baseUrl: env.OLLAMA_BASE_URL });
    }
    default:
      throw new Error(`unknown BRAIN_PROVIDER: ${provider}`);
  }
}
