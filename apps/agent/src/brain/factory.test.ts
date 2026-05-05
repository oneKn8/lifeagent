import { describe, expect, it } from "bun:test";
import { AnthropicBrain } from "./anthropic";
import { buildBrain } from "./factory";
import { OllamaBrain } from "./ollama";
import { OpenRouterBrain } from "./openrouter";

describe("buildBrain", () => {
  it("defaults to OpenRouter when BRAIN_PROVIDER is unset", () => {
    const brain = buildBrain({ OPENROUTER_API_KEY: "k" });
    expect(brain).toBeInstanceOf(OpenRouterBrain);
  });

  it("throws when openrouter is selected but the api key is missing", () => {
    expect(() => buildBrain({ BRAIN_PROVIDER: "openrouter" })).toThrow(/OPENROUTER_API_KEY/);
  });

  it("constructs AnthropicBrain when explicitly selected with key", () => {
    const brain = buildBrain({ BRAIN_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" });
    expect(brain).toBeInstanceOf(AnthropicBrain);
  });

  it("throws when anthropic is selected but the api key is missing", () => {
    expect(() => buildBrain({ BRAIN_PROVIDER: "anthropic" })).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("constructs OllamaBrain when explicitly selected", () => {
    const brain = buildBrain({ BRAIN_PROVIDER: "ollama" });
    expect(brain).toBeInstanceOf(OllamaBrain);
  });

  it("throws on unknown provider", () => {
    expect(() => buildBrain({ BRAIN_PROVIDER: "made-up" })).toThrow(/unknown BRAIN_PROVIDER/);
  });
});
