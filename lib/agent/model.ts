/**
 * lib/agent/model.ts — Task 2.1: provider-agnostic model selector
 *
 * WHY provider-agnostic: the design brief requires that the agent can flip from
 * Anthropic to OpenAI with a single env-var change (LLM_PROVIDER=openai), with
 * no code edits. This function is the single chokepoint that applies that decision
 * at call time. Both providers are installed (@ai-sdk/anthropic, @ai-sdk/openai);
 * only the selected one is instantiated per request, so there is zero cold-path
 * overhead from the unused provider.
 *
 * Env vars (read at CALL TIME so tests can swap them per-test):
 *   LLM_PROVIDER  "anthropic" (default) | "openai"
 *   LLM_MODEL     model id override — defaults to the canonical model for the provider
 *
 * KEYLESS: calling getModel() returns a LanguageModel descriptor object. It makes
 * NO network calls; the orchestrator/route handler calls the model.
 */

import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";

// Both @ai-sdk/anthropic and @ai-sdk/openai return an object with
// `.provider: string` and `.modelId: string` (this is LanguageModelV3 from
// @ai-sdk/provider, re-exported internally by the ai package but not importable
// as a top-level path in this project).  We derive the return type structurally
// from the actual provider call so TypeScript knows the shape — no phantom
// import needed.
type AnthropicModel = ReturnType<typeof anthropic>;
type OpenAIModel = ReturnType<typeof openai>;

/** Union of the concrete model types both providers return. */
export type AgentModel = AnthropicModel | OpenAIModel;

/** Default model ids — kept here so tests can assert on the exact strings. */
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";
export const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";

/**
 * Return a LanguageModel object for the configured provider.
 *
 * Provider resolution is case-insensitive so "Anthropic" == "anthropic".
 * An unknown provider string falls through to Anthropic (fail-safe default).
 *
 * Env vars (read at CALL TIME so tests can swap them per-test):
 *   LLM_PROVIDER  "anthropic" (default) | "openai"
 *   LLM_MODEL     model id override — defaults to the canonical model for the provider
 */
export function getModel(): AgentModel {
  const provider = (process.env.LLM_PROVIDER ?? "anthropic").toLowerCase();
  const modelOverride = process.env.LLM_MODEL;

  if (provider === "openai") {
    return openai(modelOverride ?? DEFAULT_OPENAI_MODEL);
  }

  // Default branch: "anthropic" or any unrecognised value → Anthropic.
  return anthropic(modelOverride ?? DEFAULT_ANTHROPIC_MODEL);
}
